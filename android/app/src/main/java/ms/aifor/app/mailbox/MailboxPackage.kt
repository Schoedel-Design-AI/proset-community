package ms.aifor.app.mailbox

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

private const val MODULE_NAME = "Mailbox"

class MailboxPackage : BaseReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        if (name == MODULE_NAME) MailboxModule(reactContext) else null

    override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
        mapOf(
            MODULE_NAME to ReactModuleInfo(
                name = MODULE_NAME,
                className = MailboxModule::class.java.name,
                canOverrideExistingModule = false,
                needsEagerInit = false,
                isCxxModule = false,
                isTurboModule = false,
            ),
        )
    }
}
