package ms.aifor.app.whisper

import com.facebook.react.bridge.*

/**
 * React Native bridge for on-device Whisper.
 *
 * The `native*` declarations live in the companion object as @JvmStatic, which
 * compiles them to STATIC methods on WhisperModule. That matters for two reasons:
 *
 *  1. The JNI symbol name is Java_ms_aifor_app_whisper_WhisperModule_nativeX for
 *     static and instance methods alike, so whisper-jni.cpp keeps resolving.
 *  2. The C++ side takes an unused `jobject` handle and never dereferences it, so
 *     a static call is safe — and it means the engine can be driven with NO React
 *     bridge and NO ReactApplicationContext (which is abstract and cannot be
 *     instantiated in an instrumented test).
 *
 * Transcription is always user-initiated; this class never starts work on its own.
 */
class WhisperModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "Whisper"

    // ---- React bridge surface ----

    @ReactMethod
    fun loadModel(modelPath: String, promise: Promise) {
        if (!requireLibrary(promise)) return
        try {
            promise.resolve(loadModelBlocking(modelPath))
        } catch (e: Exception) {
            promise.reject("LOAD_ERROR", e.message)
        }
    }

    @ReactMethod
    fun transcribe(wavPath: String, maxDurationSec: Int, promise: Promise) {
        if (!requireLibrary(promise)) return
        try {
            promise.resolve(transcribeBlocking(wavPath, maxDurationSec))
        } catch (e: Exception) {
            promise.reject("TRANSCRIBE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun cancel(promise: Promise) {
        if (!requireLibrary(promise)) return
        try {
            nativeCancel()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CANCEL_ERROR", e.message)
        }
    }

    @ReactMethod
    fun unload(promise: Promise) {
        if (!requireLibrary(promise)) return
        try {
            promise.resolve(unloadBlocking())
        } catch (e: Exception) {
            promise.reject("UNLOAD_ERROR", e.message)
        }
    }

    /**
     * Whether libwhisper-jni.so loaded, so the client can ask at runtime instead
     * of inferring capability from the module's existence (the library ships for
     * arm64-v8a only).
     */
    @ReactMethod
    fun isAvailable(promise: Promise) {
        promise.resolve(isLibraryAvailable())
    }

    /**
     * Decode any MediaExtractor-readable audio file to 16 kHz mono 16-bit WAV.
     * Resolves with the PCM sample count. Does NOT require the whisper library —
     * decoding works even where the model cannot run, so the two capabilities
     * are reported separately.
     */
    @ReactMethod
    fun decodeToWav(inputPath: String, outputPath: String, promise: Promise) {
        try {
            promise.resolve(AudioToWavDecoder.decode(inputPath, outputPath))
        } catch (e: Exception) {
            promise.reject("DECODE_ERROR", e.message ?: "decode failed", e)
        }
    }

    private fun requireLibrary(promise: Promise): Boolean {
        if (!isLibraryAvailable()) {
            promise.reject("UNAVAILABLE", "On-device transcription is not available on this device")
            return false
        }
        return true
    }

    companion object {
        @Volatile
        private var libraryLoaded = false

        @JvmStatic
        private external fun nativeLoadModel(modelPath: String): Boolean

        @JvmStatic
        private external fun nativeTranscribe(wavPath: String, maxDurationSec: Int): String

        @JvmStatic
        private external fun nativeCancel()

        @JvmStatic
        private external fun nativeUnload()

        init {
            try {
                System.loadLibrary("whisper-jni")
                libraryLoaded = true
            } catch (e: UnsatisfiedLinkError) {
                android.util.Log.w(
                    "WhisperModule",
                    "whisper-jni not available — on-device transcription disabled",
                    e,
                )
                libraryLoaded = false
            }
        }

        /** True when the native library loaded (arm64-v8a only). */
        @JvmStatic
        fun isLibraryAvailable(): Boolean = libraryLoaded

        /** Load a GGUF model. False when the native library is unavailable. */
        @JvmStatic
        fun loadModelBlocking(modelPath: String): Boolean {
            if (!libraryLoaded) return false
            return nativeLoadModel(modelPath)
        }

        /** Transcribe a 16 kHz mono PCM WAV. Returns text (may be empty). */
        @JvmStatic
        fun transcribeBlocking(wavPath: String, maxDurationSec: Int): String {
            if (!libraryLoaded) return ""
            return nativeTranscribe(wavPath, maxDurationSec)
        }

        @JvmStatic
        fun unloadBlocking(): Boolean {
            if (!libraryLoaded) return false
            nativeUnload()
            return true
        }
    }
}
