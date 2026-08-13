package ms.aifor.app.recording

import android.content.Intent
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class RecordingForegroundModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "RecordingForeground"
    }

    @ReactMethod
    fun start(title: String, content: String) {
        val context = reactApplicationContext
        val intent = Intent(context, RecordingForegroundService::class.java).apply {
            action = RecordingForegroundService.ACTION_START
            putExtra(RecordingForegroundService.EXTRA_TITLE, title)
            putExtra(RecordingForegroundService.EXTRA_CONTENT, content)
        }
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }

    @ReactMethod
    fun update(title: String, content: String) {
        val context = reactApplicationContext
        val intent = Intent(context, RecordingForegroundService::class.java).apply {
            action = RecordingForegroundService.ACTION_UPDATE
            putExtra(RecordingForegroundService.EXTRA_TITLE, title)
            putExtra(RecordingForegroundService.EXTRA_CONTENT, content)
        }
        context.startService(intent)
    }

    @ReactMethod
    fun stop() {
        val context = reactApplicationContext
        val intent = Intent(context, RecordingForegroundService::class.java).apply {
            action = RecordingForegroundService.ACTION_STOP
        }
        context.startService(intent)
    }
}
