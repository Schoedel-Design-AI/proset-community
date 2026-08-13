package ms.aifor.app.upload;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.work.Data;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkInfo;
import androidx.work.WorkManager;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class UploadWorkerFailureTest {
    @Test
    public void missingAudioPublishesTerminalWorkInfoFailure() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        WorkManager workManager = WorkManager.getInstance(context);
        String recordingId = "instrumentation-missing-audio";
        workManager.cancelUniqueWork(
            UploadWorker.Companion.uniqueWorkName(recordingId)
        ).getResult().get(
            10,
            TimeUnit.SECONDS
        );

        Data input = new Data.Builder()
            .putString(
                UploadWorker.KEY_FILE_URI,
                "file:///data/user/0/ms.aifor.app/files/definitely-missing-recording.m4a"
            )
            .putString(
                UploadWorker.KEY_UPLOAD_URL,
                "http://127.0.0.1:9/api/upload-audio"
            )
            .putString(UploadWorker.KEY_AUTH_TOKEN, "")
            .putString(UploadWorker.KEY_RECORDING_ID, recordingId)
            .putBoolean(UploadWorker.KEY_AUTO_TRANSCRIBE, true)
            .putString(UploadWorker.KEY_LANGUAGE, "es")
            .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(UploadWorker.class)
            .setInputData(input)
            .build();

        workManager.enqueueUniqueWork(
            UploadWorker.Companion.uniqueWorkName(recordingId),
            androidx.work.ExistingWorkPolicy.REPLACE,
            request
        ).getResult().get(10, TimeUnit.SECONDS);

        WorkInfo info = waitForTerminalState(workManager, request);
        assertNotNull(info);
        assertEquals(WorkInfo.State.FAILED, info.getState());
        assertEquals(
            "failed",
            info.getOutputData().getString(UploadWorker.KEY_UPLOAD_STATUS)
        );
        assertEquals(
            "upload_file_missing",
            info.getOutputData().getString(UploadWorker.KEY_ERROR_CODE)
        );
        assertFalse(info.getOutputData().getBoolean(UploadWorker.KEY_RETRYABLE, true));
    }

    private static WorkInfo waitForTerminalState(
        WorkManager workManager,
        OneTimeWorkRequest request
    ) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
        WorkInfo info = null;
        while (System.nanoTime() < deadline) {
            info = workManager.getWorkInfoById(request.getId()).get(5, TimeUnit.SECONDS);
            if (info != null && info.getState().isFinished()) return info;
            Thread.sleep(100);
        }
        return info;
    }
}
