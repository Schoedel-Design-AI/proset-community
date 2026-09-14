package ms.aifor.app.whisper

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.floor
import kotlin.math.roundToInt

/**
 * Decodes any MediaExtractor-readable audio file into the 16 kHz mono 16-bit PCM
 * WAV that whisper.cpp requires.
 *
 * Extracted from WhisperModule so the decode path is directly unit-testable on an
 * emulator: a @ReactMethod needs a live ReactApplicationContext, but this object
 * needs nothing but the Android framework.
 *
 * The decode is STREAMING (fixed carry buffer, incremental file writes) rather
 * than decode-then-convert: 15 minutes at 48 kHz would need ~170 MB as in-memory
 * floats, which is not safe on a phone.
 *
 * Linear interpolation is deliberate. This is the low-quality fallback path, and
 * a polyphase filter would cost more than it buys for speech resampled to 16 kHz.
 */
object AudioToWavDecoder {

    const val DEFAULT_TARGET_RATE = 16_000
    const val WAV_HEADER_BYTES = 44
    private const val TIMEOUT_US = 10_000L

    /**
     * Decode [inputPath] to a WAV at [outputPath].
     * @return the number of PCM samples written.
     * @throws IllegalArgumentException when the input is missing or has no audio track.
     */
    @JvmStatic
    @Throws(Exception::class)
    fun decode(
        inputPath: String,
        outputPath: String,
        targetRate: Int = DEFAULT_TARGET_RATE,
    ): Int {
        val source = File(inputPath.removePrefix("file://"))
        if (!source.exists()) throw IllegalArgumentException("input not found: $inputPath")
        val outFile = File(outputPath.removePrefix("file://"))
        outFile.parentFile?.mkdirs()

        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        var raf: RandomAccessFile? = null
        try {
            extractor.setDataSource(source.absolutePath)

            var trackIndex = -1
            var format: MediaFormat? = null
            for (i in 0 until extractor.trackCount) {
                val f = extractor.getTrackFormat(i)
                val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
                if (mime.startsWith("audio/")) {
                    trackIndex = i
                    format = f
                    break
                }
            }
            val track = format
                ?: throw IllegalArgumentException("no audio track in $inputPath")
            extractor.selectTrack(trackIndex)

            val mime = track.getString(MediaFormat.KEY_MIME)
                ?: throw IllegalArgumentException("audio track has no MIME type")
            val sourceRate = if (track.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
                track.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            } else {
                targetRate
            }
            val channels = if (track.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
                track.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            } else {
                1
            }
            val pcmEncoding = if (track.containsKey(MediaFormat.KEY_PCM_ENCODING)) {
                track.getInteger(MediaFormat.KEY_PCM_ENCODING)
            } else {
                AudioFormat.ENCODING_PCM_16BIT
            }

            codec = MediaCodec.createDecoderByType(mime)
            codec.configure(track, null, null, 0)
            codec.start()

            raf = RandomAccessFile(outFile, "rw")
            raf.setLength(0)
            raf.write(ByteArray(WAV_HEADER_BYTES)) // placeholder, patched at the end

            val ratio = sourceRate.toDouble() / targetRate.toDouble()
            val info = MediaCodec.BufferInfo()
            var carry = FloatArray(0)   // tail kept so interpolation spans chunk edges
            var pos = 0.0               // fractional read position within carry + chunk
            var samplesWritten = 0
            var inputDone = false
            var outputDone = false

            while (!outputDone) {
                if (!inputDone) {
                    val inIndex = codec.dequeueInputBuffer(TIMEOUT_US)
                    if (inIndex >= 0) {
                        val inBuf = codec.getInputBuffer(inIndex)
                        val size = if (inBuf == null) -1 else extractor.readSampleData(inBuf, 0)
                        if (size < 0) {
                            codec.queueInputBuffer(
                                inIndex, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM,
                            )
                            inputDone = true
                        } else {
                            codec.queueInputBuffer(inIndex, 0, size, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }

                val outIndex = codec.dequeueOutputBuffer(info, TIMEOUT_US)
                if (outIndex >= 0) {
                    val outBuf = codec.getOutputBuffer(outIndex)
                    if (outBuf != null && info.size > 0) {
                        outBuf.position(info.offset)
                        outBuf.limit(info.offset + info.size)
                        val mono = toMonoFloats(outBuf, channels, pcmEncoding)
                        val combined = if (carry.isEmpty()) mono else carry + mono
                        val (chunk, produced, nextPos) = resampleLinear(combined, pos, ratio)
                        if (produced > 0) {
                            writeSamples(raf, chunk)
                            samplesWritten += produced
                        }
                        pos = nextPos
                        val keepFrom = floor(pos).toInt().coerceIn(0, combined.size)
                        carry = combined.copyOfRange(keepFrom, combined.size)
                        pos -= keepFrom
                    }
                    codec.releaseOutputBuffer(outIndex, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                        outputDone = true
                    }
                }
            }

            patchWavHeader(raf, samplesWritten, targetRate)
            raf.close()
            raf = null
            return samplesWritten
        } finally {
            try { codec?.stop() } catch (_: Exception) {}
            try { codec?.release() } catch (_: Exception) {}
            try { raf?.close() } catch (_: Exception) {}
            try { extractor.release() } catch (_: Exception) {}
        }
    }

    /** One MediaCodec output buffer to mono floats in [-1, 1]. */
    private fun toMonoFloats(buf: ByteBuffer, channels: Int, pcmEncoding: Int): FloatArray {
        val ch = channels.coerceAtLeast(1)
        if (pcmEncoding == AudioFormat.ENCODING_PCM_FLOAT) {
            val fb = buf.order(ByteOrder.nativeOrder()).asFloatBuffer()
            val frames = fb.remaining() / ch
            val out = FloatArray(frames)
            for (f in 0 until frames) {
                var acc = 0f
                for (c in 0 until ch) acc += fb.get(f * ch + c)
                out[f] = acc / ch
            }
            return out
        }
        val sb = buf.order(ByteOrder.nativeOrder()).asShortBuffer()
        val frames = sb.remaining() / ch
        val out = FloatArray(frames)
        for (f in 0 until frames) {
            var acc = 0f
            for (c in 0 until ch) acc += sb.get(f * ch + c).toFloat() / 32768f
            out[f] = acc / ch
        }
        return out
    }

    /**
     * Linear-interpolation resample of [input] from fractional [startPos],
     * advancing [ratio] per output sample.
     * @return samples to write, how many, and the new fractional position.
     */
    private fun resampleLinear(
        input: FloatArray,
        startPos: Double,
        ratio: Double,
    ): Triple<FloatArray, Int, Double> {
        if (input.size < 2) return Triple(FloatArray(0), 0, startPos)
        val maxOut = (input.size / ratio).toInt() + 2
        val out = FloatArray(maxOut)
        var pos = startPos
        var n = 0
        while (pos + 1.0 < input.size && n < maxOut) {
            val i = floor(pos).toInt()
            val frac = (pos - i).toFloat()
            out[n] = input[i] * (1f - frac) + input[i + 1] * frac
            n++
            pos += ratio
        }
        return Triple(out.copyOf(n), n, pos)
    }

    private fun writeSamples(raf: RandomAccessFile, samples: FloatArray) {
        val bytes = ByteArray(samples.size * 2)
        var b = 0
        for (s in samples) {
            val v = (s.coerceIn(-1f, 1f) * 32767f).roundToInt()
            bytes[b++] = (v and 0xFF).toByte()
            bytes[b++] = ((v shr 8) and 0xFF).toByte()
        }
        raf.write(bytes)
    }

    /** Write a canonical 44-byte PCM WAV header carrying the real sizes. */
    private fun patchWavHeader(raf: RandomAccessFile, samples: Int, rate: Int) {
        val dataBytes = samples * 2
        val header = ByteBuffer.allocate(WAV_HEADER_BYTES).order(ByteOrder.LITTLE_ENDIAN)
        header.put("RIFF".toByteArray(Charsets.US_ASCII))
        header.putInt(36 + dataBytes)
        header.put("WAVE".toByteArray(Charsets.US_ASCII))
        header.put("fmt ".toByteArray(Charsets.US_ASCII))
        header.putInt(16)      // PCM fmt chunk size
        header.putShort(1)     // PCM
        header.putShort(1)     // mono
        header.putInt(rate)
        header.putInt(rate * 2) // byte rate = rate * channels * 2
        header.putShort(2)     // block align
        header.putShort(16)    // bits per sample
        header.put("data".toByteArray(Charsets.US_ASCII))
        header.putInt(dataBytes)
        raf.seek(0)
        raf.write(header.array())
    }
}
