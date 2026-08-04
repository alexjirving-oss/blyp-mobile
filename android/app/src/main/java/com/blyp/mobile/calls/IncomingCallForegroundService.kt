package com.blyp.mobile.calls

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.ServiceCompat
import com.blyp.mobile.R

/**
 * Keeps the incoming-call ringtone alive after FCM wakes a killed process.
 * Without a foreground service, Android kills MediaPlayer as soon as
 * onMessageReceived returns.
 */
class IncomingCallForegroundService : Service() {
  private var mediaPlayer: MediaPlayer? = null
  private val handler = Handler(Looper.getMainLooper())
  private var replay: Runnable? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val action = intent?.action ?: ACTION_START
    if (action == ACTION_STOP) {
      stopSelfSafe()
      return START_NOT_STICKY
    }

    val callId = intent?.getStringExtra(EXTRA_CALL_ID)?.trim().orEmpty()
    val callerName = intent?.getStringExtra(EXTRA_CALLER_NAME)?.trim().orEmpty().ifBlank { "Incoming call" }
    if (callId.isEmpty()) {
      stopSelfSafe()
      return START_NOT_STICKY
    }

    IncomingCallModule.ensureChannel(this)
    val notif = IncomingCallModule.buildCallNotification(this, callId, callerName)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        // mediaPlayback: ringtone only. microphone-typed FGS is killed on API 34+
        // when the mic is not actively captured.
        ServiceCompat.startForeground(
          this,
          IncomingCallModule.notifIdPublic(callId),
          notif,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
        )
      } else {
        startForeground(IncomingCallModule.notifIdPublic(callId), notif)
      }
    } catch (_: Exception) {
      try {
        startForeground(IncomingCallModule.notifIdPublic(callId), notif)
      } catch (_: Exception) {
        stopSelfSafe()
        return START_NOT_STICKY
      }
    }

    startRing()
    vibrateOnce()
    return START_STICKY
  }

  override fun onDestroy() {
    stopRing()
    super.onDestroy()
  }

  private fun startRing() {
    stopRing()
    try {
      val player = MediaPlayer.create(this, R.raw.blyp_notify) ?: return
      player.isLooping = false
      player.setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build(),
      )
      player.setOnCompletionListener {
        val next = Runnable {
          try {
            val p = mediaPlayer ?: return@Runnable
            p.seekTo(0)
            p.start()
          } catch (_: Exception) {
          }
        }
        replay = next
        handler.postDelayed(next, RING_GAP_MS)
      }
      player.start()
      mediaPlayer = player
    } catch (_: Exception) {
    }
  }

  private fun stopRing() {
    replay?.let { handler.removeCallbacks(it) }
    replay = null
    try {
      mediaPlayer?.setOnCompletionListener(null)
    } catch (_: Exception) {
    }
    try {
      mediaPlayer?.stop()
    } catch (_: Exception) {
    }
    try {
      mediaPlayer?.release()
    } catch (_: Exception) {
    }
    mediaPlayer = null
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        getSystemService(VibratorManager::class.java)?.defaultVibrator?.cancel()
      } else {
        @Suppress("DEPRECATION")
        (getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator)?.cancel()
      }
    } catch (_: Exception) {
    }
  }

  private fun vibrateOnce() {
    try {
      val pattern = longArrayOf(0, 400, 1600, 400, 1600, 400, 1600)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        getSystemService(VibratorManager::class.java)
          ?.defaultVibrator
          ?.vibrate(VibrationEffect.createWaveform(pattern, -1))
      } else {
        @Suppress("DEPRECATION")
        val vib = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          vib.vibrate(VibrationEffect.createWaveform(pattern, -1))
        } else {
          @Suppress("DEPRECATION")
          vib.vibrate(pattern, -1)
        }
      }
    } catch (_: Exception) {
    }
  }

  private fun stopSelfSafe() {
    stopRing()
    try {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } catch (_: Exception) {
    }
    stopSelf()
  }

  companion object {
    const val ACTION_START = "com.blyp.mobile.calls.START_RING"
    const val ACTION_STOP = "com.blyp.mobile.calls.STOP_RING"
    const val EXTRA_CALL_ID = "callId"
    const val EXTRA_CALLER_NAME = "callerName"
    private const val RING_GAP_MS = 2000L

    fun start(context: Context, callId: String, callerName: String) {
      val i = Intent(context, IncomingCallForegroundService::class.java).apply {
        action = ACTION_START
        putExtra(EXTRA_CALL_ID, callId)
        putExtra(EXTRA_CALLER_NAME, callerName)
      }
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(i)
        } else {
          context.startService(i)
        }
      } catch (_: Exception) {
      }
    }

    fun stop(context: Context) {
      val i = Intent(context, IncomingCallForegroundService::class.java).apply {
        action = ACTION_STOP
      }
      try {
        context.startService(i)
      } catch (_: Exception) {
        try {
          context.stopService(Intent(context, IncomingCallForegroundService::class.java))
        } catch (_: Exception) {
        }
      }
    }
  }
}
