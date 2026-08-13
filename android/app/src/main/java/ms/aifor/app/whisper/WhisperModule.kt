package ms.aifor.app.whisper

import com.facebook.react.bridge.*

class WhisperModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "Whisper"

    private external fun nativeLoadModel(modelPath: String): Boolean
    private external fun nativeTranscribe(wavPath: String, maxDurationSec: Int): String
    private external fun nativeCancel()
    private external fun nativeUnload()

    @ReactMethod
    fun loadModel(modelPath: String, promise: Promise) {
        if (!requireLibrary(promise)) return
        try {
            val ok = nativeLoadModel(modelPath)
            promise.resolve(ok)
        } catch (e: Exception) {
            promise.reject("LOAD_ERROR", e.message)
        }
    }

    @ReactMethod
    fun transcribe(wavPath: String, maxDurationSec: Int, promise: Promise) {
        if (!requireLibrary(promise)) return
        try {
            val text = nativeTranscribe(wavPath, maxDurationSec)
            promise.resolve(text)
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
            nativeUnload()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("UNLOAD_ERROR", e.message)
        }
    }

    companion object {
        private var libraryLoaded = false
        val isAvailable: Boolean get() = libraryLoaded

        init {
            try {
                System.loadLibrary("whisper-jni")
                libraryLoaded = true
            } catch (e: UnsatisfiedLinkError) {
                android.util.Log.w("WhisperModule", "whisper-jni not available — on-device transcription disabled", e)
                libraryLoaded = false
            }
        }
    }

    private fun requireLibrary(promise: Promise): Boolean {
        if (!libraryLoaded) {
            promise.reject("UNAVAILABLE", "On-device transcription is not available on this device")
            return false
        }
        return true
    }
}
