package ms.aifor.app.parakeet

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.mediapipe.tasks.audio.audiotranscriber.AudioTranscriber
import com.google.mediapipe.tasks.audio.audiotranscriber.AudioTranscriberResult
import com.google.mediapipe.tasks.core.BaseOptions
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.TreeMap
import java.util.concurrent.Executors
import ms.aifor.app.audio.AudioToWavDecoder

/**
 * On-device transcription via MediaPipe Audio Transcriber (NVIDIA Parakeet TDT
 * 0.6B v3 `.litertlm`, INT8, ~615 MB). Replaces the whisper.cpp engine as
 * Proset's last-resort on-device path.
 *
 * Contract with lib/parakeet.ts:
 *   - transcribe(inputPath, modelPath) resolves the transcript text, or "" (or
 *     whitespace-only) on ANY ordinary failure — never throws to JS.
 *   - cancel() flips a flag honored between windows; an aborted run resolves "".
 *   - close() releases the model so memory can be reclaimed after use.
 *
 * API verified against com.google.mediapipe:tasks-audio:1.2.3 (javap audit,
 * 2026-11-17): createFromOptions(Context, Options), transcribe(float[]),
 * transcribe(float[], boolean) + finishStream(), prewarm(), close(),
 * ModelArchitecture.AUTO, AudioTranscriberResult.getText()/segments().
 *
 * The graph's own AsrAudioChunker/AsrTranscriptMerger calculators chunk and
 * merge internally, so windows are fed straight through transcribe(float[]),
 * and segments are MERGED BY TIMESTAMP instead of blindly concatenated: that is
 * robust whether a call's result is cumulative or per-window (Segment carries
 * fromTimestampMs/toTimestampMs in stream time).
 */
class ParakeetModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    /** 30-second windows (16 kHz mono): a 20-minute note must never materialize
     *  as one ~160 MB JVM float[] allocation on a low-RAM device.
     *  Compiled fresh: see tests/parakeet-ondevice-transcription-contract.test.mjs. */
    private const val CHUNK_SAMPLES = 16000 * 30
    private const val SAMPLE_RATE_HZ = 16000
    private const val TAG = "Parakeet"
  }

  private val executor = Executors.newSingleThreadExecutor()
  private var transcriber: AudioTranscriber? = null
  private var loadedModelPath: String? = null

  @Volatile private var cancelled = false

  override fun getName() = "Parakeet"

  @ReactMethod
  fun isAvailable(promise: Promise) {
    // The tasks-audio AAR ships JS+native for all standard ABIs; true means the
    // JS gate may start the flow. Real failures surface as "" from transcribe(),
    // which the caller already treats as failure (never as success).
    promise.resolve(true)
  }

  /** Load (or reuse) the transcriber for the given .litertlm path. Throws on failure. */
  private fun getTranscriber(modelPath: String): AudioTranscriber {
    val existing = transcriber
    if (existing != null && loadedModelPath == modelPath) return existing
    existing?.close()
    transcriber = null
    val baseOptions = BaseOptions.builder()
        .setModelAssetPath(modelPath)
        .build()
    val options =
        AudioTranscriber.AudioTranscriberOptions.builder()
            .setBaseOptions(baseOptions)
            .setSampleRateHz(SAMPLE_RATE_HZ)
            // Compiled-model caching for faster subsequent startups (audited setter).
            .setCacheDir(reactApplicationContext.cacheDir.absolutePath)
            .build()
    val created = AudioTranscriber.createFromOptions(reactApplicationContext, options)
    try {
      created.prewarm()
    } catch (e: Throwable) {
      android.util.Log.w(TAG, "prewarm failed (continuing)", e)
    }
    transcriber = created
    loadedModelPath = modelPath
    return created
  }

  /**
   * Decode any supported recording to 16 kHz mono PCM WAV with the proven
   * AudioToWavDecoder (same class WhisperModule.kt uses), then hand the file to
   * the window reader below. No cross-module call into the Whisper native
   * module: this keeps `ms.aifor.app.whisper` deletable as a whole later.
   */
  private fun decodeToWav16kMono(inputPath: String, wavPath: String) {
    val samples = AudioToWavDecoder.decode(inputPath, wavPath)
    if (samples <= 0) throw IllegalArgumentException("decode produced $samples samples")
  }

  /**
   * Read a 16 kHz mono 16-bit PCM WAV in bounded windows, converting each one
   * to normalized float samples [-1, 1]. The header chunk scan survives
   * non-44-byte headers; chunk alignment is word-rounded like the spec's.
   */
  private class WavWindowReader(raf: RandomAccessFile) {
    private val dataStart: Long
    private val dataLength: Long

    init {
      raf.seek(12)
      var start = -1L
      var length = 0L
      while (raf.filePointer < raf.length() - 8) {
        val id = ByteArray(4)
        raf.readFully(id)
        val size = readLeInt(raf)
        if (String(id, Charsets.US_ASCII) == "data") {
          start = raf.filePointer
          length = size.toLong()
          break
        }
        raf.seek(raf.filePointer + (size + 1L) / 2L * 2L)
      }
      if (start < 0L) throw IllegalArgumentException("WAV has no data chunk")
      dataStart = start
      dataLength = minOf(length, raf.length() - start)
    }

    fun sampleCount(): Long = dataLength / 2

    /** Reads up to [count] samples starting at [offset]; returns null at EOF. */
    fun readWindow(raf: RandomAccessFile, offset: Long, count: Int): FloatArray? {
      if (offset >= sampleCount()) return null
      val samples = minOf(count.toLong(), sampleCount() - offset).toInt()
      val buf = ByteArray(samples * 2)
      raf.seek(dataStart + offset * 2)
      raf.readFully(buf)
      val shorts = ShortArray(samples)
      ByteBuffer.wrap(buf).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(shorts)
      return FloatArray(samples) { shorts[it] / 32768f }
    }

    private fun readLeInt(raf: RandomAccessFile): Int {
      val b = ByteArray(4)
      raf.readFully(b)
      return ByteBuffer.wrap(b).order(ByteOrder.LITTLE_ENDIAN).int
    }
  }

  /** Accumulate segments by stream-relative start timestamp; later (final) calls win. */
  private fun mergeSegments(result: AudioTranscriberResult?, merged: TreeMap<Long, AudioTranscriberResult.Segment>) {
    if (result == null) return
    for (segment in result.segments()) {
      try {
        merged[segment.fromTimestampMs()] = segment
      } catch (_: Throwable) {
        // A malformed segment is skipped, not fatal: the caller treats gaps fine.
      }
    }
  }

  @ReactMethod
  fun transcribe(inputPath: String, modelPath: String, promise: Promise) {
    executor.execute {
      try {
        cancelled = false
        val transcriber = getTranscriber(modelPath)

        val wavPath =
            "${reactApplicationContext.cacheDir}/parakeet-${System.currentTimeMillis()}.wav"
        decodeToWav16kMono(inputPath, wavPath)

        val segments = TreeMap<Long, AudioTranscriberResult.Segment>()
        RandomAccessFile(wavPath, "r").use { raf ->
          val reader = WavWindowReader(raf)
          var offset = 0L
          while (true) {
            if (cancelled) {
              // Aborted runs resolve ""; lib/parakeet.ts and the detail screen
              // already treat "" as failure and keep the cloud error state.
              promise.resolve("")
              return@execute
            }
            val window = reader.readWindow(raf, offset, CHUNK_SAMPLES) ?: break
            offset += window.size
            mergeSegments(transcriber.transcribe(window), segments)
          }
          // Finalize the stateful stream so the tail window's speech is merged.
          if (!segments.isEmpty() || offset > 0) {
            mergeSegments(transcriber.finishStream(), segments)
          }
        }

        val sb = StringBuilder()
        for (segment in segments.values) {
          if (sb.isNotEmpty()) sb.append(' ')
          sb.append(segment.transcript())
        }
        promise.resolve(sb.toString().trim())
      } catch (e: Throwable) {
        android.util.Log.w(TAG, "transcribe failed", e)
        promise.resolve("")
      }
    }
  }

  @ReactMethod
  fun cancel(promise: Promise) {
    cancelled = true
    promise.resolve(true)
  }

  @ReactMethod
  fun close(promise: Promise) {
    executor.execute {
      try {
        transcriber?.close()
      } catch (_: Throwable) {}
      transcriber = null
      loadedModelPath = null
      promise.resolve(true)
    }
  }

  override fun invalidate() {
    super.invalidate()
    executor.execute {
      try {
        transcriber?.close()
      } catch (_: Throwable) {}
      transcriber = null
      loadedModelPath = null
    }
  }
}
