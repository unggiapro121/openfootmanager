// OpenFoot Manager (phase 5 M3c2), GPLv3.
package app.ofm.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * A push as the app shows it and as it comes back when tapped. The server's data (`kind`,
 * `outboxId`, `route`, m3-tech-spec §4.6) rides on the intent that opens the app, as the system
 * puts it there for a push shown in the background.
 */
object PushIntents {
    const val CHANNEL_ID = "ofm_push"
    private const val CHANNEL_NAME = "Eleven Saga"
    private const val OUTBOX_ID = "outboxId"
    // `fixtureId` and `auctionId` come with M3b2 (P5-42); the app reads them before `route`.
    private val FIELDS = listOf("kind", OUTBOX_ID, "route", "fixtureId", "auctionId")

    /** The push's data on `intent`, or null when the app was not opened from one of ours. */
    fun dataOf(intent: Intent?): Map<String, String>? {
        val extras = intent?.extras ?: return null
        if (extras.getString(OUTBOX_ID).isNullOrEmpty()) return null
        return FIELDS.mapNotNull { key -> extras.getString(key)?.let { key to it } }.toMap()
    }

    /** The app's one channel, which the system also uses for a push shown in the background. */
    fun ensureChannel(context: Context) {
        NotificationManagerCompat.from(context).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH),
        )
    }

    fun show(context: Context, tag: String, title: String, body: String, data: Map<String, String>) {
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return
        ensureChannel(context)
        val open = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        for (key in FIELDS) data[key]?.let { open.putExtra(key, it) }
        val tap = PendingIntent.getActivity(
            context,
            tag.hashCode(),
            open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ofm_push_icon)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(tap)
            .build()
        try {
            manager.notify(tag, 0, notification)
        } catch (_: SecurityException) {
            // The permission was taken back between the check and the post: nothing to show.
        }
    }
}
