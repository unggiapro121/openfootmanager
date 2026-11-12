// Adapted from tauri-plugin-mobile-push 0.1.4 (android/src/main/java/app/tauri/mobilepush/
// MobilePushPlugin.kt; https://github.com/yanqianglu/tauri-plugin-mobile-push, commit
// fd23baefd2778f5828f4ca50d8fd7611d92cd081), MIT OR Apache-2.0, Copyright the
// tauri-plugin-mobile-push authors. Changes for OpenFoot Manager (phase 5 M3c2) are GPLv3.
package app.ofm.push

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.webkit.WebView
import androidx.core.app.NotificationManagerCompat
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject

/**
 * The phone's half of the app's pushes (m3-tech-spec §5.3): the permission, the Firebase token
 * and the push the coach opened the app from. Every command answers once, with a value or a
 * rejection, so the Rust side never waits for ever (spike m3c2 B1).
 */
@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = PushPlugin.ALIAS)
    ]
)
class PushPlugin(private val activity: Activity) : Plugin(activity) {

    companion object {
        const val ALIAS = "notifications"

        @Volatile
        var instance: PushPlugin? = null

        /** The push the app was opened from and the webview has not taken yet. */
        @Volatile
        private var opened: Map<String, String>? = null

        /** Keep the push in `intent`, if the app was opened from one; true when it was. */
        fun remember(intent: Intent?): Boolean {
            val data = PushIntents.dataOf(intent) ?: return false
            opened = data
            return true
        }

        fun take(): Map<String, String>? {
            val data = opened
            opened = null
            return data
        }
    }

    override fun load(webView: WebView) {
        super.load(webView)
        instance = this
        PushIntents.ensureChannel(activity)
        // Opened from a push while the app was closed: kept until the webview asks, after the
        // coach's session is back (§5.7).
        remember(activity.intent)
    }

    override fun onNewIntent(intent: Intent) {
        if (remember(intent)) trigger("opened", JSObject())
    }

    @Command
    fun permissionState(invoke: Invoke) {
        invoke.resolve(JSObject().put("state", state()))
    }

    @Command
    fun requestPermission(invoke: Invoke) {
        // Below Android 13 there is nothing to ask: pushes are on unless turned off in settings.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            getPermissionState(ALIAS) == PermissionState.GRANTED
        ) {
            invoke.resolve(JSObject().put("state", state()))
            return
        }
        requestPermissionForAlias(ALIAS, invoke, "permissionAnswered")
    }

    @PermissionCallback
    fun permissionAnswered(invoke: Invoke) {
        invoke.resolve(JSObject().put("state", state()))
    }

    @Command
    fun getToken(invoke: Invoke) {
        val messaging = try {
            FirebaseMessaging.getInstance()
        } catch (error: IllegalStateException) {
            // No google-services.json in this build: Firebase was never set up.
            invoke.reject(error.message ?: "Firebase is not set up")
            return
        }
        messaging.token.addOnCompleteListener { task ->
            val token = if (task.isSuccessful) task.result else null
            if (token.isNullOrEmpty()) {
                invoke.reject(task.exception?.message ?: "Firebase gave no token", task.exception)
            } else {
                invoke.resolve(JSObject().put("token", token))
            }
        }
    }

    /** The phone's notification settings for this app, where a refusal can be undone (§5.6). */
    @Command
    fun openSettings(invoke: Invoke) {
        val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(intent)
        invoke.resolve(JSObject())
    }

    @Command
    fun takeOpened(invoke: Invoke) {
        val data = take()
        val reply = JSObject()
        if (data == null) {
            reply.put("data", JSONObject.NULL)
        } else {
            val fields = JSObject()
            for ((key, value) in data) fields.put(key, value)
            reply.put("data", fields)
        }
        invoke.resolve(reply)
    }

    /** A new token from Firebase: the webview registers the phone again. */
    fun tokenChanged() {
        trigger("token", JSObject())
    }

    private fun state(): String {
        val shown = NotificationManagerCompat.from(activity).areNotificationsEnabled()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return if (shown) "granted" else "denied"
        }
        return when (getPermissionState(ALIAS)) {
            PermissionState.GRANTED -> if (shown) "granted" else "denied"
            PermissionState.DENIED -> "denied"
            else -> "prompt"
        }
    }
}
