package com.blyp.mobile.calls

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import com.blyp.mobile.MainActivity
import com.blyp.mobile.R
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Messenger-style incoming call: full-screen intent + Answer/Decline actions.
 * Ringtone lives in [IncomingCallForegroundService].
 */
class IncomingCallModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "IncomingCallModule"

  @ReactMethod
  fun showIncomingCall(callId: String, callerName: String, promise: Promise) {
    try {
      show(reactContext, callId, callerName.ifBlank { "Incoming call" })
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("show_failed", e.message, e)
    }
  }

  @ReactMethod
  fun cancelIncomingCall(callId: String, promise: Promise) {
    try {
      cancel(reactContext, callId)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("cancel_failed", e.message, e)
    }
  }

  /** Android 14+: if FSI is blocked, open the system settings page once. */
  @ReactMethod
  fun ensureFullScreenIntentPermission(promise: Promise) {
    try {
      val ctx = reactContext.applicationContext
      if (Build.VERSION.SDK_INT < 34) {
        promise.resolve(true)
        return
      }
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (nm.canUseFullScreenIntent()) {
        promise.resolve(true)
        return
      }
      val intent = Intent(
        Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
        Uri.parse("package:${ctx.packageName}"),
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      ctx.startActivity(intent)
      promise.resolve(false)
    } catch (e: Exception) {
      promise.reject("fsi_failed", e.message, e)
    }
  }

  companion object {
    const val CHANNEL_ID = "blyp_calls"
    private const val NOTIF_BASE = 71001

    fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val existing = mgr.getNotificationChannel(CHANNEL_ID)
      if (existing != null && existing.sound != null) {
        mgr.deleteNotificationChannel(CHANNEL_ID)
      } else if (existing != null) {
        return
      }
      val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
      val ch = NotificationChannel(
        CHANNEL_ID,
        "Incoming calls",
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = "Ringing for Blyp audio calls"
        setSound(null, attrs)
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 500, 200, 500, 200, 500)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        setBypassDnd(true)
      }
      mgr.createNotificationChannel(ch)
    }

    fun notifIdPublic(callId: String): Int = NOTIF_BASE + (callId.hashCode() and 0x0FFF)

    fun buildCallNotification(context: Context, callId: String, callerName: String): Notification {
      ensureChannel(context)
      val appCtx = context.applicationContext
      val name = callerName.ifBlank { "Incoming call" }

      val openUri = Uri.parse(
        "blyp://call/$callId?action=open&peerName=${Uri.encode(name)}",
      )
      val openIntent = Intent(appCtx, MainActivity::class.java).apply {
        action = Intent.ACTION_VIEW
        data = openUri
        putExtra("callId", callId)
        putExtra("role", "callee")
        putExtra("peerName", name)
        addFlags(
          Intent.FLAG_ACTIVITY_NEW_TASK or
            Intent.FLAG_ACTIVITY_CLEAR_TOP or
            Intent.FLAG_ACTIVITY_SINGLE_TOP,
        )
      }
      val fullScreenPi = PendingIntent.getActivity(
        appCtx,
        callId.hashCode(),
        openIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

      val answerIntent = Intent(appCtx, IncomingCallActionReceiver::class.java).apply {
        action = IncomingCallActionReceiver.ACTION_ANSWER
        putExtra(IncomingCallActionReceiver.EXTRA_CALL_ID, callId)
        putExtra(IncomingCallActionReceiver.EXTRA_CALLER_NAME, name)
      }
      val answerPi = PendingIntent.getBroadcast(
        appCtx,
        callId.hashCode() + 11,
        answerIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

      val declineIntent = Intent(appCtx, IncomingCallActionReceiver::class.java).apply {
        action = IncomingCallActionReceiver.ACTION_DECLINE
        putExtra(IncomingCallActionReceiver.EXTRA_CALL_ID, callId)
        putExtra(IncomingCallActionReceiver.EXTRA_CALLER_NAME, name)
      }
      val declinePi = PendingIntent.getBroadcast(
        appCtx,
        callId.hashCode() + 17,
        declineIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

      val caller = Person.Builder()
        .setName(name)
        .setImportant(true)
        .build()

      val builder = NotificationCompat.Builder(appCtx, CHANNEL_ID)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle("Incoming call")
        .setContentText("$name is calling…")
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setOngoing(true)
        .setAutoCancel(false)
        .setContentIntent(fullScreenPi)
        .setFullScreenIntent(fullScreenPi, true)
        .setSound(null)
        .setVibrate(longArrayOf(0, 500, 200, 500, 200, 500))
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .setTimeoutAfter(60_000L)

      try {
        builder.setStyle(
          NotificationCompat.CallStyle.forIncomingCall(caller, declinePi, answerPi),
        )
      } catch (_: Exception) {
        builder
          .addAction(0, "Decline", declinePi)
          .addAction(0, "Answer", answerPi)
      }

      return builder.build()
    }

    fun show(context: Context, callId: String, callerName: String) {
      val name = callerName.ifBlank { "Incoming call" }
      IncomingCallForegroundService.start(context.applicationContext, callId, name)
      try {
        NotificationManagerCompat.from(context.applicationContext)
          .notify(notifIdPublic(callId), buildCallNotification(context, callId, name))
      } catch (_: Exception) {
      }
    }

    fun cancel(context: Context, callId: String) {
      IncomingCallForegroundService.stop(context.applicationContext)
      NotificationManagerCompat.from(context.applicationContext).cancel(notifIdPublic(callId))
    }

    fun cancelAll(context: Context) {
      IncomingCallForegroundService.stop(context.applicationContext)
      NotificationManagerCompat.from(context.applicationContext).cancelAll()
    }
  }
}
