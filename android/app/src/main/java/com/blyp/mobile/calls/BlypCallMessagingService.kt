package com.blyp.mobile.calls

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
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
 *
 * Message pushes:
 *  - Stable tag/id per conversationId so later messages collapse and can be cleared.
 *  - Skip tray entirely when JS reports that conversation is already open (avoids
 *    double-playing blyp_notify with the in-chat sting).
 */
class BlypCallMessagingService : FirebaseMessagingService() {
  override fun onNewToken(token: String) {
    // Token refresh is written by JS PushService on next foreground register.
    android.util.Log.i("BlypCallFCM", "onNewToken len=${token.length}")
  }

  override fun onMessageReceived(message: RemoteMessage) {
    val data = message.data ?: emptyMap()
    val type = (data["type"] ?: "").lowercase()
    if (type == "incoming_call" || type == "call") {
      val callId = (data["callId"] ?: "").trim()
      if (callId.isEmpty()) return
      val callerName = (data["callerName"] ?: data["title"] ?: "Incoming call").trim()
      android.util.Log.i("BlypCallFCM", "incoming_call callId=$callId")
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

    val conversationId = (data["conversationId"] ?: "").trim()
    val isMessage = type == "message" || type == "conversation"
    if (isMessage && conversationId.isNotEmpty() && isActiveConversation(applicationContext, conversationId)) {
      android.util.Log.i("BlypCallFCM", "skip tray; active chat=$conversationId")
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
      val requestCode = if (conversationId.isNotEmpty()) {
        conversationNotifId(conversationId)
      } else {
        (System.currentTimeMillis() % Int.MAX_VALUE).toInt()
      }
      val pi = PendingIntent.getActivity(
        applicationContext,
        requestCode,
        open,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      val builder = NotificationCompat.Builder(applicationContext, DEFAULT_CHANNEL)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle(title)
        .setContentText(body)
        .setAutoCancel(true)
        .setContentIntent(pi)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setOnlyAlertOnce(true)

      if (conversationId.isNotEmpty()) {
        builder.setGroup(GROUP_MESSAGES)
        NotificationManagerCompat.from(applicationContext)
          .notify(TAG_DM, conversationNotifId(conversationId), builder.build())
      } else {
        NotificationManagerCompat.from(applicationContext)
          .notify((System.currentTimeMillis() % 100000).toInt() + 50000, builder.build())
      }
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
    private const val PREFS = "blyp_push"
    private const val KEY_ACTIVE_CONV = "active_conversation_id"
    const val TAG_DM = "blyp_dm"
    private const val GROUP_MESSAGES = "blyp_messages"
    private const val DM_NOTIF_BASE = 82000

    fun setActiveConversation(context: Context, conversationId: String?) {
      context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(KEY_ACTIVE_CONV, conversationId?.trim().orEmpty())
        .apply()
    }

    fun isActiveConversation(context: Context, conversationId: String): Boolean {
      val active = context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getString(KEY_ACTIVE_CONV, "")
        .orEmpty()
      return active.isNotEmpty() && active == conversationId
    }

    fun conversationNotifId(conversationId: String): Int {
      return DM_NOTIF_BASE + (conversationId.hashCode() and 0x0FFF)
    }

    fun clearConversationNotifications(context: Context, conversationId: String?) {
      val id = conversationId?.trim().orEmpty()
      if (id.isEmpty()) return
      try {
        NotificationManagerCompat.from(context.applicationContext)
          .cancel(TAG_DM, conversationNotifId(id))
      } catch (_: Exception) {
        // ignore
      }
    }
  }
}
