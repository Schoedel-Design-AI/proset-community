package ms.aifor.app.upload

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.io.DataOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject

class UploadWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    companion object {
        const val TAG = "UploadWorker"
        const val KEY_FILE_URI = "file_uri"
        const val KEY_UPLOAD_URL = "upload_url"
        const val KEY_AUTH_TOKEN = "auth_token"
        const val KEY_RECORDING_ID = "recording_id"
        const val KEY_AUTO_TRANSCRIBE = "auto_transcribe"
        const val KEY_LANGUAGE = "language"
        const val KEY_UPLOAD_STATUS = "upload_status"
        const val KEY_ERROR_CODE = "error_code"
        const val KEY_RETRYABLE = "retryable"
        const val MAX_RUN_ATTEMPTS = 4
        // Transcribe retry: transient statuses (409 read-after-write lag, 429,
        // 5xx) are retried up to MAX_TRANSCRIBE_ATTEMPTS times with a linear
        // 1s..4s backoff before the worker surfaces a retryable failure.
        const val MAX_TRANSCRIBE_ATTEMPTS = 4
        const val TRANSCRIBE_RETRY_DELAY_MS = 1000L

        fun uniqueWorkName(recordingId: String): String = "upload-$recordingId"

        fun enqueue(
            context: Context,
            fileUri: String,
            uploadUrl: String,
            authToken: String,
            recordingId: String,
            autoTranscribe: Boolean,
            language: String
        ) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val inputData = Data.Builder()
                .putString(KEY_FILE_URI, fileUri)
                .putString(KEY_UPLOAD_URL, uploadUrl)
                // Retained only as a legacy-auth fallback during Firebase cutover.
                // Firebase users receive a current token inside doWork().
                .putString(KEY_AUTH_TOKEN, authToken)
                .putString(KEY_RECORDING_ID, recordingId)
                .putBoolean(KEY_AUTO_TRANSCRIBE, autoTranscribe)
                .putString(KEY_LANGUAGE, language)
                .build()

            val request = OneTimeWorkRequestBuilder<UploadWorker>()
                .setConstraints(constraints)
                .setInputData(inputData)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .addTag(uniqueWorkName(recordingId))
                .build()

            WorkManager.getInstance(context)
                .enqueueUniqueWork(
                    uniqueWorkName(recordingId),
                    ExistingWorkPolicy.KEEP,
                    request
                )

            Log.d(TAG, "Enqueued upload for $recordingId")
        }

        fun cancel(context: Context, recordingId: String) {
            WorkManager.getInstance(context).cancelUniqueWork(uniqueWorkName(recordingId))
        }
    }

    private data class HttpResult(
        val responseCode: Int,
        val responseBody: String
    )

    override suspend fun doWork(): Result {
        val fileUri = inputData.getString(KEY_FILE_URI) ?: return permanentFailure(
            "upload_rejected",
            false
        )
        val uploadUrl = inputData.getString(KEY_UPLOAD_URL) ?: return permanentFailure(
            "upload_rejected",
            false
        )
        val fallbackAuthToken = inputData.getString(KEY_AUTH_TOKEN).orEmpty()
        val recordingId = inputData.getString(KEY_RECORDING_ID) ?: return permanentFailure(
            "upload_rejected",
            false
        )
        val autoTranscribe = inputData.getBoolean(KEY_AUTO_TRANSCRIBE, true)
        val language = inputData.getString(KEY_LANGUAGE).orEmpty()
        val file = File(fileUri.removePrefix("file://"))

        if (!file.exists()) {
            Log.w(TAG, "File not found: $fileUri")
            val token = resolveAuthToken(forceRefresh = false, fallbackAuthToken)
            reportUploadState(
                uploadUrl,
                token,
                recordingId,
                status = "failed",
                errorCode = "upload_file_missing",
                retryable = false
            )
            return permanentFailure("upload_file_missing", false)
        }

        var authToken = resolveAuthToken(
            forceRefresh = false,
            fallbackToken = fallbackAuthToken
        )
        if (authToken.isNullOrBlank()) {
            return retryOrFail(
                uploadUrl,
                fallbackAuthToken,
                recordingId,
                "upload_auth_failed"
            )
        }

        return try {
            setProgress(uploadData("uploading"))
            reportUploadState(
                uploadUrl,
                authToken,
                recordingId,
                status = "uploading",
                errorCode = null,
                retryable = null
            )

            var uploadResult = uploadFile(
                file,
                uploadUrl,
                authToken,
                recordingId
            )
            if (uploadResult.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
                val refreshedToken = resolveAuthToken(
                    forceRefresh = true,
                    fallbackToken = ""
                )
                if (!refreshedToken.isNullOrBlank()) {
                    authToken = refreshedToken
                    uploadResult = uploadFile(
                        file,
                        uploadUrl,
                        authToken,
                        recordingId
                    )
                }
            }

            when {
                uploadResult.responseCode in 200..299 -> {
                    setProgress(uploadData("uploaded"))
                    Log.d(TAG, "Upload succeeded for $recordingId")
                    if (autoTranscribe) {
                        reportTranscriptionState(
                            uploadUrl,
                            authToken,
                            recordingId,
                            status = "queued",
                            errorCode = null,
                            retryable = null
                        )
                        requestStoredTranscriptionWithRefresh(
                            uploadUrl,
                            authToken,
                            recordingId,
                            language
                        )
                    }
                    Result.success(
                        Data.Builder()
                            .putString("response", uploadResult.responseBody)
                            .putString(KEY_UPLOAD_STATUS, "uploaded")
                            .build()
                    )
                }
                isRetryableHttpStatus(uploadResult.responseCode) -> retryOrFail(
                    uploadUrl,
                    authToken,
                    recordingId,
                    "upload_retry_exhausted"
                )
                else -> {
                    val errorCode = if (
                        uploadResult.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED
                        || uploadResult.responseCode == HttpURLConnection.HTTP_FORBIDDEN
                    ) {
                        "upload_auth_failed"
                    } else {
                        "upload_rejected"
                    }
                    val retryable = errorCode == "upload_auth_failed"
                    reportUploadState(
                        uploadUrl,
                        authToken,
                        recordingId,
                        status = "failed",
                        errorCode = errorCode,
                        retryable = retryable
                    )
                    permanentFailure(errorCode, retryable)
                }
            }
        } catch (error: Exception) {
            Log.e(TAG, "Upload error for $recordingId", error)
            retryOrFail(
                uploadUrl,
                authToken,
                recordingId,
                "upload_retry_exhausted"
            )
        }
    }

    private suspend fun resolveAuthToken(
        forceRefresh: Boolean,
        fallbackToken: String
    ): String? {
        return suspendCancellableCoroutine { continuation ->
            val future = FirebaseTokenProvider.getToken(
                forceRefresh,
                fallbackToken
            )
            future.whenComplete { token, error ->
                if (!continuation.isActive) return@whenComplete
                if (error == null) {
                    continuation.resume(token)
                } else {
                    Log.w(TAG, "Firebase token refresh failed", error)
                    continuation.resume(if (forceRefresh) null else fallbackToken.ifBlank { null })
                }
            }
            continuation.invokeOnCancellation { future.cancel(true) }
        }
    }

    private fun uploadFile(
        file: File,
        uploadUrl: String,
        authToken: String,
        recordingId: String
    ): HttpResult {
        val boundary = "Boundary-${System.currentTimeMillis()}"
        val (uploadName, uploadType) = when (file.extension.lowercase()) {
            "wav" -> "recording.wav" to "audio/wav"
            "webm" -> "recording.webm" to "audio/webm"
            "mp3" -> "recording.mp3" to "audio/mpeg"
            "ogg", "oga" -> "recording.ogg" to "audio/ogg"
            "aac" -> "recording.aac" to "audio/aac"
            else -> "recording.m4a" to "audio/mp4"
        }
        val connection = URL(uploadUrl).openConnection() as HttpURLConnection
        return try {
            connection.apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 30000
                readTimeout = 120000
                setRequestProperty("Authorization", "Bearer $authToken")
                setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
            }
            DataOutputStream(connection.outputStream).use { output ->
                output.writeBytes("--$boundary\r\n")
                output.writeBytes("Content-Disposition: form-data; name=\"recordingId\"\r\n\r\n")
                output.writeBytes(recordingId)
                output.writeBytes("\r\n")
                output.writeBytes("--$boundary\r\n")
                output.writeBytes(
                    "Content-Disposition: form-data; name=\"audio\"; filename=\"$uploadName\"\r\n"
                )
                output.writeBytes("Content-Type: $uploadType\r\n\r\n")
                file.inputStream().use { it.copyTo(output) }
                output.writeBytes("\r\n--$boundary--\r\n")
                output.flush()
            }
            readHttpResult(connection)
        } finally {
            connection.disconnect()
        }
    }

    private suspend fun requestStoredTranscriptionWithRefresh(
        uploadUrl: String,
        currentAuthToken: String,
        recordingId: String,
        language: String
    ) {
        var authToken = resolveAuthToken(
            forceRefresh = false,
            fallbackToken = currentAuthToken
        ) ?: currentAuthToken
        var result = requestStoredTranscription(
            uploadUrl,
            authToken,
            recordingId,
            language
        )
        if (result.responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
            val refreshedToken = resolveAuthToken(
                forceRefresh = true,
                fallbackToken = ""
            )
            if (!refreshedToken.isNullOrBlank()) {
                authToken = refreshedToken
                result = requestStoredTranscription(
                    uploadUrl,
                    authToken,
                    recordingId,
                    language
                )
            }
        }

        // The upload just completed, so the transcribe route may briefly not
        // see the bucket URI (Firestore read-after-write lag) and answer 409.
        // Retry transient statuses with short backoff — a single 409 used to
        // strand the recording in "queued" forever with no retry affordance.
        var attempt = 0
        var lastResult = result
        while (
            attempt < MAX_TRANSCRIBE_ATTEMPTS
            && lastResult.responseCode !in 200..299
            && isTransientTranscribeStatus(lastResult.responseCode)
        ) {
            attempt += 1
            delay(TRANSCRIBE_RETRY_DELAY_MS * attempt) // 1s, 2s, 3s, 4s
            lastResult = requestStoredTranscription(
                uploadUrl,
                authToken,
                recordingId,
                language
            )
        }

        if (lastResult.responseCode in 200..299) {
            Log.d(TAG, "Transcription succeeded for $recordingId")
        } else {
            Log.w(
                TAG,
                "Transcription request failed with ${lastResult.responseCode} for $recordingId"
            )
            // Surface a retryable failure so the UI shows the retry button
            // instead of an infinite "transcribing" spinner.
            reportTranscriptionState(
                uploadUrl,
                authToken,
                recordingId,
                status = "failed",
                errorCode = "transcription_failed",
                retryable = true
            )
        }
    }

    private fun isTransientTranscribeStatus(responseCode: Int): Boolean =
        responseCode == HttpURLConnection.HTTP_CLIENT_TIMEOUT // 408
            || responseCode == HttpURLConnection.HTTP_CONFLICT // 409
            || responseCode == 425 // Too Early
            || responseCode == 429 // Too Many Requests
            || responseCode in 500..599

    private fun requestStoredTranscription(
        uploadUrl: String,
        authToken: String,
        recordingId: String,
        language: String
    ): HttpResult {
        val transcriptionUrl = uploadUrl.removeSuffix("/upload-audio") +
            "/recordings/$recordingId/transcribe"
        val connection = URL(transcriptionUrl).openConnection() as HttpURLConnection
        return try {
            connection.apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 30000
                readTimeout = 10 * 60 * 1000
                setRequestProperty("Authorization", "Bearer $authToken")
                setRequestProperty("Content-Type", "application/json")
            }
            connection.outputStream.bufferedWriter().use { output ->
                output.write(JSONObject().put("language", language).toString())
            }
            readHttpResult(connection)
        } finally {
            connection.disconnect()
        }
    }

    private fun retryOrFail(
        uploadUrl: String,
        authToken: String?,
        recordingId: String,
        terminalErrorCode: String
    ): Result {
        if (runAttemptCount + 1 < MAX_RUN_ATTEMPTS) {
            Log.w(
                TAG,
                "Retrying upload for $recordingId after attempt ${runAttemptCount + 1}"
            )
            return Result.retry()
        }
        reportUploadState(
            uploadUrl,
            authToken,
            recordingId,
            status = "failed",
            errorCode = terminalErrorCode,
            retryable = true
        )
        return permanentFailure(terminalErrorCode, true)
    }

    private fun permanentFailure(errorCode: String, retryable: Boolean): Result =
        Result.failure(
            Data.Builder()
                .putString(KEY_UPLOAD_STATUS, "failed")
                .putString(KEY_ERROR_CODE, errorCode)
                .putBoolean(KEY_RETRYABLE, retryable)
                .build()
        )

    private fun uploadData(status: String): Data =
        Data.Builder().putString(KEY_UPLOAD_STATUS, status).build()

    private fun isRetryableHttpStatus(responseCode: Int): Boolean =
        responseCode == HttpURLConnection.HTTP_CLIENT_TIMEOUT
            || responseCode == 425
            || responseCode == HttpURLConnection.HTTP_CONFLICT
            || responseCode == 429
            || responseCode in 500..599

    private fun reportUploadState(
        uploadUrl: String,
        authToken: String?,
        recordingId: String,
        status: String,
        errorCode: String?,
        retryable: Boolean?
    ) {
        if (authToken.isNullOrBlank()) return
        val body = JSONObject()
            .put("needsUpload", status != "uploaded")
            .put("uploadStatus", status)
            .put("uploadErrorCode", errorCode ?: JSONObject.NULL)
            .put("uploadRetryable", retryable ?: JSONObject.NULL)
        updateRecordingState(uploadUrl, authToken, recordingId, body)
    }

    private fun reportTranscriptionState(
        uploadUrl: String,
        authToken: String,
        recordingId: String,
        status: String,
        errorCode: String?,
        retryable: Boolean?
    ) {
        val body = JSONObject()
            .put("isTranscribing", status == "queued" || status == "transcribing")
            .put("transcriptionStatus", status)
            .put("transcriptionErrorCode", errorCode ?: JSONObject.NULL)
            .put("transcriptionError", JSONObject.NULL)
            .put("transcriptionRetryable", retryable ?: JSONObject.NULL)
        updateRecordingState(uploadUrl, authToken, recordingId, body)
    }

    private fun updateRecordingState(
        uploadUrl: String,
        authToken: String,
        recordingId: String,
        body: JSONObject
    ) {
        val statusUrl = uploadUrl.removeSuffix("/upload-audio") +
            "/recordings/$recordingId"
        val connection = URL(statusUrl).openConnection() as HttpURLConnection
        try {
            connection.apply {
                requestMethod = "PUT"
                doOutput = true
                connectTimeout = 15000
                readTimeout = 15000
                setRequestProperty("Authorization", "Bearer $authToken")
                setRequestProperty("Content-Type", "application/json")
            }
            connection.outputStream.bufferedWriter().use { output ->
                output.write(body.toString())
            }
            val result = readHttpResult(connection)
            Log.d(
                TAG,
                "Reported recording state for $recordingId (response: ${result.responseCode})"
            )
        } catch (error: Exception) {
            Log.e(TAG, "Failed to report recording state to server", error)
        } finally {
            connection.disconnect()
        }
    }

    private fun readHttpResult(connection: HttpURLConnection): HttpResult {
        val responseCode = connection.responseCode
        val stream = if (responseCode in 200..299) {
            connection.inputStream
        } else {
            connection.errorStream
        }
        val responseBody = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        return HttpResult(responseCode, responseBody)
    }
}
