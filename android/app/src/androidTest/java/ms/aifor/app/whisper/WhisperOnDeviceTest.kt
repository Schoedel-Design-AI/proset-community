package ms.aifor.app.whisper

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Hardware verification of the on-device transcription path: model download,
 * model load, and actual inference.
 *
 * This CANNOT run on an x86_64 emulator — libwhisper-jni.so is built for
 * arm64-v8a only (see jni/CMakeLists.txt) — so the test skips itself where the
 * library is absent and is meaningful only on a 64-bit physical device.
 *
 * Fixture: whisper.cpp's own jfk.wav (11.0 s of speech) re-encoded to the app's
 * recorder profile, decoded to 16 kHz WAV by AudioToWavDecoder. The transcript is
 * printed so quality can be judged rather than merely asserted non-empty: the
 * tiny model is the deliberate low-quality fallback, so "does it produce a
 * usable transcript" is a human call.
 */
@RunWith(AndroidJUnit4::class)
class WhisperOnDeviceTest {

    private val modelUrl =
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin"
    private val fixtureAsset = "jfk-44k1-mono-64k.m4a"
    private val minPlausibleModelBytes = 50L * 1024 * 1024

    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val targetContext = instrumentation.targetContext

    /** Same path lib/whisper.ts uses, so a real app run reuses this download. */
    private fun modelFile() = File(targetContext.cacheDir, "whisper-tiny.bin")

    private fun writeFixtureToCache(): File {
        val out = File(targetContext.cacheDir, fixtureAsset)
        instrumentation.context.assets.open(fixtureAsset).use { input ->
            out.outputStream().use { input.copyTo(it) }
        }
        return out
    }

    private fun ensureModelDownloaded(): Boolean {
        val model = modelFile()
        if (model.isFile && model.length() > minPlausibleModelBytes) return true
        println("Downloading whisper model to ${model.absolutePath} ...")
        return try {
            val connection = (URL(modelUrl).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = true
                connectTimeout = 30_000
                readTimeout = 120_000
            }
            connection.inputStream.use { input ->
                model.outputStream().use { output -> input.copyTo(output) }
            }
            val ok = model.isFile && model.length() > minPlausibleModelBytes
            println("Model download finished: ${model.length()} bytes (ok=$ok)")
            ok
        } catch (e: Exception) {
            println("Model download FAILED: ${e.javaClass.simpleName}: ${e.message}")
            model.delete()
            false
        }
    }

    @Test
    fun loadsTinyModelAndTranscribesARecordingOnDevice() {
        assumeTrue(
            "libwhisper-jni.so is not available on this ABI — run on an arm64 device",
            WhisperModule.isLibraryAvailable(),
        )

        // 1. audio path: m4a -> 16 kHz mono PCM WAV
        val source = writeFixtureToCache()
        val wav = File(targetContext.cacheDir, "ondevice-${System.currentTimeMillis()}.wav")
        val samples = AudioToWavDecoder.decode(source.absolutePath, wav.absolutePath)
        assertTrue("decode produced no samples", samples > 0)
        println("Decoded $samples samples -> ${wav.length()} bytes WAV")

        // 2. model: download once (~74 MB), then load
        assumeTrue("whisper model unavailable (offline?)", ensureModelDownloaded())
        val loaded = WhisperModule.loadModelBlocking(modelFile().absolutePath)
        assertTrue("nativeLoadModel returned false", loaded)
        println("Model loaded from ${modelFile().absolutePath}")

        // 3. inference
        val started = System.currentTimeMillis()
        val text = WhisperModule.transcribeBlocking(wav.absolutePath, 0)
        val elapsed = System.currentTimeMillis() - started
        val trimmed = text.trim()
        println("ON-DEVICE TRANSCRIPT (${elapsed}ms): $trimmed")
        // Also to logcat: instrumentation stdout is captured by AGP and does not
        // reach the device log buffer or the JUnit XML, so this is the only
        // channel a human/agent can read the actual transcript through.
        android.util.Log.i("WhisperOnDevice", "TRANSCRIPT(${elapsed}ms) len=${trimmed.length}: $trimmed")

        assertTrue("on-device transcription returned nothing", trimmed.length >= 10)

        wav.delete()
        WhisperModule.unloadBlocking()
    }
}
