package ms.aifor.app.mailbox

import android.content.ActivityNotFoundException
import android.content.Intent
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Hands the user to their email app's INBOX.
 *
 * Why this exists: `mailto:` is the standard interop URL for email, and on
 * Android it resolves to a COMPOSE activity — verified on device with
 * `adb shell cmd package query-activities -a android.intent.action.VIEW -d mailto:`
 * -> com.google.android.gm/.ComposeActivityGmailExternal. A user told "we sent
 * you a link, check your inbox" was landing in a blank new-message screen.
 * The launcher intent ACTION_MAIN + CATEGORY_APP_EMAIL resolves to the mailbox
 * itself (com.google.android.gm/.ConversationListActivityGmail), and React
 * Native's JS surface cannot set an intent category, hence this module.
 *
 * Rejects when nothing handles it, so the caller can fall back to `mailto:`.
 */
class MailboxModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "Mailbox"

    @ReactMethod
    fun openEmailApp(promise: Promise) {
        val intent =
            Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_APP_EMAIL)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            reactApplicationContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: ActivityNotFoundException) {
            promise.reject("NO_EMAIL_APP", "No app handles the email category.", e)
        } catch (e: Exception) {
            promise.reject("MAILBOX_OPEN_FAILED", e.message, e)
        }
    }
}
