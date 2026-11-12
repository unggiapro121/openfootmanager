// Adapted from tauri-plugin-mobile-push 0.1.4 (android/src/main/java/app/tauri/mobilepush/
// FCMService.kt; https://github.com/yanqianglu/tauri-plugin-mobile-push, commit
// fd23baefd2778f5828f4ca50d8fd7611d92cd081), MIT OR Apache-2.0, Copyright the
// tauri-plugin-mobile-push authors. Changes for OpenFoot Manager (phase 5 M3c2) are GPLv3.
package app.ofm.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Firebase's messages to the app. A push while the app is in the background is shown by the
 * system from its `notification` part; this runs for one that comes while the app is open, and
 * shows it the same way, so the coach sees it either way.
 */
class PushMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val notification = message.notification ?: return
        PushIntents.show(
            this,
            message.messageId ?: message.data["outboxId"] ?: System.currentTimeMillis().toString(),
            notification.title.orEmpty(),
            notification.body.orEmpty(),
            message.data,
        )
    }

    override fun onNewToken(token: String) {
        PushPlugin.instance?.tokenChanged()
    }
}
