package ms.aifor.app.whisper

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.StandardCharsets
import kotlin.math.sqrt

/**
 * Instrumented verification of the on-device transcription decode path.
 *
 * Runs on an emulator because it needs real MediaCodec/MediaExtractor, but does
 * NOT need libwhisper-jni (that ships for arm64-v8a only, so the model/transcribe
 * half can only be exercised on a 64-bit device). What is verified here is the
 * part that was previously unverified: m4a -> 16 kHz mono PCM WAV.
 *
 * Fixture: whisper.cpp's own jfk.wav (11.0 s, 16 kHz mono PCM), re-encoded to
 * 44.1 kHz mono AAC at 64 kbps to match what the app's recorder produces.
 */
@RunWith(AndroidJUnit4::class)
class AudioToWavDecoderTest {

    private val fixtureAsset = "jfk-44k1-mono-64k.m4a"
    private val sourceSeconds = 11.0
    private val targetRate = 16_000

    /** Copy the asset out of the test APK into a real file the decoder can read. */
    private fun writeFixtureToCache(): File {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val out = File(instrumentation.targetContext.cacheDir, fixtureAsset)
        instrumentation.context.assets.open(fixtureAsset).use { input ->
            out.outputStream().use { input.copyTo(it) }
        }
        return out
    }

    private fun readAll(file: File): ByteArray = file.readBytes()

    private fun u32(b: ByteArray, off: Int): Long =
        ByteBuffer.wrap(b, off, 4).order(ByteOrder.LITTLE_ENDIAN).int.toLong() and 0xFFFFFFFFL

    private fun u16(b: ByteArray, off: Int): Int =
        ByteBuffer.wrap(b, off, 2).order(ByteOrder.LITTLE_ENDIAN).short.toInt() and 0xFFFF

    private fun tag(b: ByteArray, off: Int): String =
        String(b, off, 4, StandardCharsets.US_ASCII)

    @Test
    fun decodesM4aToSixteenKhzMonoWavWithExpectedLength() {
        val source = writeFixtureToCache()
        val target = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir,
            "decoded-${System.currentTimeMillis()}.wav")

        val samples = AudioToWavDecoder.decode(source.absolutePath, target.absolutePath)

        assertTrue("decoder returned no samples", samples > 0)
        assertTrue("output WAV was not written", target.exists() && target.length() > 44)

        val expected = (sourceSeconds * targetRate).toInt()
        val tolerance = (expected * 0.03).toInt()
        assertTrue(
            "sample count $samples differs from expected $expected by more than 3%",
            kotlin.math.abs(samples - expected) <= tolerance,
        )

        // header must be a canonical PCM WAV at the rate whisper.cpp requires
        val bytes = readAll(target)
        assertEquals("RIFF", tag(bytes, 0))
        assertEquals("WAVE", tag(bytes, 8))
        assertEquals("fmt ", tag(bytes, 12))
        assertEquals("data", tag(bytes, 36))
        assertEquals("fmt chunk size", 16, u32(bytes, 16).toInt())
        assertEquals("audio format must be PCM", 1, u16(bytes, 20))
        assertEquals("channels", 1, u16(bytes, 22))
        assertEquals("sample rate", targetRate, u32(bytes, 24).toInt())
        assertEquals("byte rate", targetRate * 2, u32(bytes, 28).toInt())
        assertEquals("block align", 2, u16(bytes, 32))
        assertEquals("bits per sample", 16, u16(bytes, 34))
        assertEquals("data chunk size must equal samples*2", samples * 2, u32(bytes, 40).toInt())
        assertEquals("RIFF size must be 36 + data", 36 + samples * 2, u32(bytes, 4).toInt())
        assertEquals("file length must be header + data", 44 + samples * 2, bytes.size)

        // the payload must be real audio, not silence: RMS of a speech sample is
        // far above zero, and a broken decode typically yields flat zeros
        var sumSquares = 0.0
        var n = 0
        var i = 44
        while (i + 1 < bytes.size) {
            val s = ByteBuffer.wrap(bytes, i, 2).order(ByteOrder.LITTLE_ENDIAN).short / 32768.0
            sumSquares += s * s
            n++
            i += 2
        }
        val rms = sqrt(sumSquares / n)
        assertTrue("decoded audio looks like silence (rms=$rms)", rms > 0.005)
    }

    @Test
    fun reportsFailureForMissingInput() {
        val target = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir,
            "should-not-exist.wav")
        try {
            AudioToWavDecoder.decode("/nonexistent/input.m4a", target.absolutePath)
            fail("expected an exception for a missing input file")
        } catch (e: IllegalArgumentException) {
            assertTrue("unexpected message: ${e.message}", e.message!!.contains("input not found"))
        }
    }
}
