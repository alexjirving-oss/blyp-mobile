package com.blyp.mobile.calls

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.blyp.mobile.MainActivity
import com.blyp.mobile.R
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Sole FCM entry when Expo's messaging service is removed from the merge.
 * Incoming calls → full-screen IncomingCallModule. Other pushes → tray notification.
 */
class BlypCallMessagingService : FirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    val data = message.data ?: emptyMap()
    val type = (data["type"] ?: "").lowercase()
    if (type == "incoming_call" || type == "call") {
      val callId = (data["callId"] ?: "").trim()
      if (callId.isEmpty()) return
      val callerName = (data["callerName"] ?: data["title"] ?: "Incoming call").trim()
      try {
        IncomingCallModule.show(
          applicationContext,
          callId,
          callerName.ifBlank { "Incoming call" },
        )
      } catch (_: Exception) {
        // never crash messaging process
      }
      return
    }

    // Non-call: show a standard tray notification so chat/live pushes still work
    // after we replace Expo's FirebaseMessagingService in the manifest merge.
    try {
      val title = message.notification?.title
        ?: data["title"]
        ?: "Blyp"
      val body = message.notification?.body
        ?: data["body"]
        ?: ""
      if (body.isBlank() && message.notification == null && data.isEmpty()) return
      ensureDefaultChannel()
      val open = Intent(applicationContext, MainActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        data.forEach { (k, v) -> putExtra(k, v) }
      }
      val pi = PendingIntent.getActivity(
        applicationContext,
        (System.currentTimeMillis() % Int.MAX_VALUE).toInt(),
        open,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      val notif = NotificationCompat.Builder(applicationContext, DEFAULT_CHANNEL)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle(title)
        .setContentText(body)
        .setAutoCancel(true)
        .setContentIntent(pi)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .build()
      NotificationManagerCompat.from(applicationContext)
        .notify((System.currentTimeMillis() % 100000).toInt() + 50000, notif)
    } catch (_: Exception) {
      // ignore
    }
  }

  private fun ensureDefaultChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = getSystemService(NotificationManager::class.java) ?: return
    if (mgr.getNotificationChannel(DEFAULT_CHANNEL) != null) return
    mgr.createNotificationChannel(
      NotificationChannel(DEFAULT_CHANNEL, "Blyp", NotificationManager.IMPORTANCE_HIGH),
    )
  }

  companion object {
    private const val DEFAULT_CHANNEL = "blyp"
  }
}
