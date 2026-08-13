package ms.aifor.app.upload

import androidx.core.content.ContextCompat
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.facebook.react.bridge.*

class UploadWorkerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "UploadWorker"

    @ReactMethod
    fun enqueue(
        fileUri: String,
        uploadUrl: String,
        authToken: String,
        recordingId: String,
        autoTranscribe: Boolean,
        language: String,
        promise: Promise
    ) {
        try {
            UploadWorker.enqueue(
                reactApplicationContext,
                fileUri,
                uploadUrl,
                authToken,
                recordingId,
                autoTranscribe,
                language
            )
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ENQUEUE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun cancel(recordingId: String, promise: Promise) {
        try {
            UploadWorker.cancel(reactApplicationContext, recordingId)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CANCEL_ERROR", e.message)
        }
    }

    @ReactMethod
    fun getStatus(recordingId: String, promise: Promise) {
        try {
            val future = WorkManager.getInstance(reactApplicationContext)
                .getWorkInfosForUniqueWork(UploadWorker.uniqueWorkName(recordingId))
            future.addListener({
                try {
                    val infos = future.get()
                    val info = infos.firstOrNull { !it.state.isFinished } ?: infos.lastOrNull()
                    if (info == null) {
                        promise.resolve(null)
                        return@addListener
                    }
                    val data = if (info.state.isFinished) info.outputData else info.progress
                    val result = Arguments.createMap().apply {
                        putString("state", info.state.name.lowercase())
                        putInt("runAttemptCount", info.runAttemptCount)
                        data.getString(UploadWorker.KEY_UPLOAD_STATUS)?.let {
                            putString("uploadStatus", it)
                        }
                        data.getString(UploadWorker.KEY_ERROR_CODE)?.let {
                            putString("errorCode", it)
                        }
                        if (data.keyValueMap.containsKey(UploadWorker.KEY_RETRYABLE)) {
                            putBoolean(
                                "retryable",
                                data.getBoolean(UploadWorker.KEY_RETRYABLE, false)
                            )
                        }
                    }
                    promise.resolve(result)
                } catch (error: Exception) {
                    promise.reject("STATUS_ERROR", error.message, error)
                }
            }, ContextCompat.getMainExecutor(reactApplicationContext))
        } catch (error: Exception) {
            promise.reject("STATUS_ERROR", error.message, error)
        }
    }
}
