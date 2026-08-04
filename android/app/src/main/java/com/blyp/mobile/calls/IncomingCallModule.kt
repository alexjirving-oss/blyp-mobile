package com.blyp.mobile.calls

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.blyp.mobile.MainActivity
import com.blyp.mobile.R
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Full-screen + looping ringtone for incoming Blyp calls when the app may be
 * backgrounded / screen locked. JS and FCM both call into this module.
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

  companion object {
    const val CHANNEL_ID = "blyp_calls"
    private const val NOTIF_BASE = 71001
    private var mediaPlayer: MediaPlayer? = null

    fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val existing = mgr.getNotificationChannel(CHANNEL_ID)
      if (existing != null) return
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
        setSound(android.provider.Settings.System.DEFAULT_RINGTONE_URI, attrs)
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 500, 200, 500, 200, 500)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        setBypassDnd(true)
      }
      // Prefer custom Blyp sting when present in res/raw.
      try {
        val soundUri = android.net.Uri.parse(
          "android.resource://${context.packageName}/${R.raw.blyp_notify}",
        )
        ch.setSound(soundUri, attrs)
      } catch (_: Exception) {
        // keep default ringtone
      }
      mgr.createNotificationChannel(ch)
    }

    fun show(context: Context, callId: String, callerName: String) {
      ensureChannel(context)
      val appCtx = context.applicationContext

      val openIntent = Intent(appCtx, MainActivity::class.java).apply {
        action = Intent.ACTION_VIEW
        data = android.net.Uri.parse("blyp://call/$callId")
        putExtra("callId", callId)
        putExtra("role", "callee")
        putExtra("peerName", callerName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      }
      val fullScreenPi = PendingIntent.getActivity(
        appCtx,
        callId.hashCode(),
        openIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

      val notif = NotificationCompat.Builder(appCtx, CHANNEL_ID)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle("Incoming call")
        .setContentText("$callerName is calling…")
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setOngoing(true)
        .setAutoCancel(false)
        .setContentIntent(fullScreenPi)
        .setFullScreenIntent(fullScreenPi, true)
        .setSound(null) // looping handled by MediaPlayer below
        .setVibrate(longArrayOf(0, 500, 200, 500, 200, 500))
        .build()

      NotificationManagerCompat.from(appCtx).notify(notifId(callId), notif)
      startLoopingRing(appCtx)
      vibrate(appCtx)
    }

    fun cancel(context: Context, callId: String) {
      NotificationManagerCompat.from(context.applicationContext).cancel(notifId(callId))
      stopLoopingRing()
    }

    fun cancelAll(context: Context) {
      NotificationManagerCompat.from(context.applicationContext).cancelAll()
      stopLoopingRing()
    }

    private fun notifId(callId: String): Int = NOTIF_BASE + (callId.hashCode() and 0x0FFF)

    private fun startLoopingRing(context: Context) {
      stopLoopingRing()
      try {
        val player = MediaPlayer.create(context, R.raw.blyp_notify) ?: return
        player.isLooping = true
        player.setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build(),
        )
        player.start()
        mediaPlayer = player
      } catch (_: Exception) {
        // ignore
      }
    }

    private fun stopLoopingRing() {
      try {
        mediaPlayer?.stop()
      } catch (_: Exception) {
      }
      try {
        mediaPlayer?.release()
      } catch (_: Exception) {
      }
      mediaPlayer = null
    }

    private fun vibrate(context: Context) {
      try {
        val pattern = longArrayOf(0, 500, 200, 500, 200, 500, 200, 500)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          val vm = context.getSystemService(VibratorManager::class.java)
          vm?.defaultVibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
        } else {
          @Suppress("DEPRECATION")
          val vib = context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vib.vibrate(VibrationEffect.createWaveform(pattern, 0))
          } else {
            @Suppress("DEPRECATION")
            vib.vibrate(pattern, 0)
          }
        }
      } catch (_: Exception) {
      }
    }
  }
}
