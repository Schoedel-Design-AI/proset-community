package ms.aifor.app

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import ms.aifor.app.recording.RecordingForegroundPackage
import ms.aifor.app.upload.UploadWorkerPackage
import ms.aifor.app.whisper.WhisperPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(RecordingForegroundPackage())
          add(UploadWorkerPackage())
          add(WhisperPackage())
        },
      jsMainModulePath = "index",
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
