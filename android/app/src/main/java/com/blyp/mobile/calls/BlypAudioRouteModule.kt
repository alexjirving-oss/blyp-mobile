package com.blyp.mobile.calls

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import android.media.MediaPlayer

/**
 * Call-only audio route. For You must never import this for playback.
 * After hangup / For You reclaim: MODE_NORMAL is not enough — Samsung keeps
 * TYPE_BUILTIN_EARPIECE as communicationDevice after clearCommunicationDevice().
 * Media reclaim must displace USAGE_VOICE_COMMUNICATION focus and pin
 * setCommunicationDevice to builtin SPEAKER.
 */
class BlypAudioRouteModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "BlypAudioRoute"

  /**
   * Play cinema-gift MP4 soundtrack under live without yanking MODE_NORMAL.
   * Video stays on muted expo-av; this MediaPlayer mixes on VOICE_COMMUNICATION
   * (same stream as IVS) with transient duck only. Never plays blyp_notify.
   */
  @ReactMethod
  fun playGiftCinemaUri(uri: String, volume: Double, promise: Promise) {
    try {
      val trimmed = uri.trim()
      if (trimmed.isEmpty()) {
        promise.resolve(false)
        return
      }
      val ctx = reactApplicationContext.applicationContext
      val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      stopGiftCinemaInternal(am)

      val inComm =
        am.mode == AudioManager.MODE_IN_COMMUNICATION || am.mode == AudioManager.MODE_IN_CALL
      val attrs =
        if (inComm) {
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
            .build()
        } else {
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
            .build()
        }

      val player = MediaPlayer()
      player.setAudioAttributes(attrs)
      val vol = volume.toFloat().coerceIn(0.05f, 1f)
      player.setVolume(vol, vol)

      if (inComm) {
        try {
          val max = am.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL)
          val cur = am.getStreamVolume(AudioManager.STREAM_VOICE_CALL)
          if (max > 0 && cur <= 0) {
            am.setStreamVolume(
              AudioManager.STREAM_VOICE_CALL,
              (max * 0.55f).toInt().coerceAtLeast(1),
              0,
            )
          }
        } catch (_: Exception) {
        }
      }

      var focusReq: AudioFocusRequest? = null
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        try {
          focusReq =
            AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
              .setAudioAttributes(attrs)
              .setOnAudioFocusChangeListener { }
              .build()
          am.requestAudioFocus(focusReq!!)
          giftCinemaFocusRequest = focusReq
        } catch (_: Exception) {
          focusReq = null
          giftCinemaFocusRequest = null
        }
      }

      player.setDataSource(ctx, android.net.Uri.parse(trimmed))
      player.setOnCompletionListener { mp ->
        abandonGiftCinemaFocus(am)
        try {
          mp.release()
        } catch (_: Exception) {
        }
        if (giftCinemaPlayer === mp) giftCinemaPlayer = null
      }
      player.setOnErrorListener { mp, what, extra ->
        Log.w(TAG, "playGiftCinemaUri error what=$what extra=$extra")
        abandonGiftCinemaFocus(am)
        try {
          mp.release()
        } catch (_: Exception) {
        }
        if (giftCinemaPlayer === mp) giftCinemaPlayer = null
        true
      }
      player.prepare()
      giftCinemaPlayer = player
      player.start()
      promise.resolve(true)
    } catch (e: Exception) {
      Log.w(TAG, "playGiftCinemaUri failed ${e.message}")
      try {
        val am =
          reactApplicationContext.applicationContext
            .getSystemService(Context.AUDIO_SERVICE) as AudioManager
        stopGiftCinemaInternal(am)
      } catch (_: Exception) {
      }
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun stopGiftCinema(promise: Promise) {
    try {
      val am =
        reactApplicationContext.applicationContext
          .getSystemService(Context.AUDIO_SERVICE) as AudioManager
      stopGiftCinemaInternal(am)
      promise.resolve(true)
    } catch (e: Exception) {
      Log.w(TAG, "stopGiftCinema failed ${e.message}")
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun applyMediaSpeaker(promise: Promise) {
    promise.resolve(apply(reactApplicationContext, callMode = false, speaker = false))
  }

  @ReactMethod
  fun applyCallSpeaker(promise: Promise) {
    promise.resolve(apply(reactApplicationContext, callMode = true, speaker = true))
  }

  @ReactMethod
  fun applyCallEarpiece(promise: Promise) {
    promise.resolve(apply(reactApplicationContext, callMode = true, speaker = false))
  }

  @ReactMethod
  fun snapshot(promise: Promise) {
    promise.resolve(snapshotMap(reactApplicationContext))
  }

  companion object {
    private const val TAG = "BlypAudio"
    private const val TYPE_BUILTIN_SPEAKER_SAFE = 24
    private const val TYPE_BLE_HEADSET = 26

    @Volatile
    private var mediaFocusRequest: AudioFocusRequest? = null

    @Volatile
    private var giftCinemaPlayer: MediaPlayer? = null

    @Volatile
    private var giftCinemaFocusRequest: AudioFocusRequest? = null

    private fun abandonGiftCinemaFocus(am: AudioManager) {
      val req = giftCinemaFocusRequest
      giftCinemaFocusRequest = null
      if (req != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        try {
          am.abandonAudioFocusRequest(req)
        } catch (_: Exception) {
        }
      }
    }

    private fun stopGiftCinemaInternal(am: AudioManager) {
      val player = giftCinemaPlayer
      giftCinemaPlayer = null
      if (player != null) {
        try {
          player.stop()
        } catch (_: Exception) {
        }
        try {
          player.release()
        } catch (_: Exception) {
        }
      }
      abandonGiftCinemaFocus(am)
    }

    fun apply(context: Context, callMode: Boolean, speaker: Boolean): com.facebook.react.bridge.WritableMap {
      val am = context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      try {
        if (callMode) {
          abandonMediaFocus(am)
          am.mode = AudioManager.MODE_IN_COMMUNICATION
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val devices = commDevices(am)
            Log.i(TAG, "commDevices=" + devices.joinToString { "${it.type}:${it.productName}" })
            val target = if (speaker) {
              findBuiltinSpeaker(devices)
            } else {
              devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }
            }
            if (target != null) {
              val ok = am.setCommunicationDevice(target)
              Log.i(TAG, "setCommunicationDevice type=${target.type} ok=$ok")
            } else if (speaker) {
              try {
                am.clearCommunicationDevice()
              } catch (_: Exception) {
              }
            }
          }
          @Suppress("DEPRECATION")
          am.isSpeakerphoneOn = speaker
          if (speaker) {
            @Suppress("DEPRECATION")
            if (!am.isSpeakerphoneOn) {
              am.isSpeakerphoneOn = true
            }
          }
        } else {
          forceMediaSpeakerRoute(am)
        }
      } catch (e: Exception) {
        Log.e(TAG, "apply failed ${e.message}")
      }
      val snap = snapshotMap(context)
      Log.i(
        TAG,
        "route=${if (callMode) "call" else "idle"} wantSpeaker=$speaker " +
          "mode=${snap.getString("modeName")} speakerphone=${snap.getBoolean("speakerphone")} " +
          "comm=${snap.getString("commDevice")}",
      )
      return snap
    }

    /**
     * clearCommunicationDevice() on Samsung leaves TYPE_BUILTIN_EARPIECE (1).
     * Kick leftover VOICE_COMMUNICATION focus, then pin builtin SPEAKER.
     */
    private fun forceMediaSpeakerRoute(am: AudioManager) {
      displaceVoiceCommunicationFocus(am)
      stopLeftoverSco(am)

      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        @Suppress("DEPRECATION")
        am.isSpeakerphoneOn = true
        am.mode = AudioManager.MODE_NORMAL
        return
      }

      Log.i(TAG, "mediaCommDevices=" + commDevices(am).joinToString { "${it.type}:${it.productName}" })

      val headset = findHeadset(commDevices(am))
      if (headset != null) {
        // Wired / BT output is the user's choice — never force the builtin speaker.
        try {
          am.clearCommunicationDevice()
        } catch (_: Exception) {
        }
        am.mode = AudioManager.MODE_NORMAL
        @Suppress("DEPRECATION")
        am.isSpeakerphoneOn = false
        Log.i(TAG, "media route keeps headset type=${headset.type}")
        return
      }

      // A LiveKit call leaves an explicit earpiece communication device behind.
      // Pin the speaker from MODE_IN_COMMUNICATION first (OEMs ignore
      // setCommunicationDevice while mode is MODE_NORMAL), then drop back to
      // MODE_NORMAL and pin again — the mode change itself reverts the
      // selection on Samsung.
      pinBuiltinSpeaker(am, sandwich = true)
      am.mode = AudioManager.MODE_NORMAL
      pinBuiltinSpeaker(am, sandwich = false)

      // Media must never be left in a communication mode: MODE_IN_COMMUNICATION
      // is what routes ExoPlayer to the earpiece even when a speaker device is
      // selected, so MODE_NORMAL is always the last mode write.
      am.mode = AudioManager.MODE_NORMAL
      @Suppress("DEPRECATION")
      am.isSpeakerphoneOn = true
    }

    /**
     * clearCommunicationDevice() then explicitly select the builtin speaker.
     * @param sandwich allow a temporary MODE_IN_COMMUNICATION so the selection sticks.
     * @return true when the communication device is no longer the builtin earpiece.
     */
    private fun pinBuiltinSpeaker(am: AudioManager, sandwich: Boolean): Boolean {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false
      val speakerDev = findBuiltinSpeaker(commDevices(am))
      if (speakerDev == null) {
        Log.w(TAG, "no builtin speaker communication device")
        return false
      }
      try {
        am.clearCommunicationDevice()
      } catch (_: Exception) {
      }
      val ok = try {
        am.setCommunicationDevice(speakerDev)
      } catch (_: Exception) {
        false
      }
      @Suppress("DEPRECATION")
      am.isSpeakerphoneOn = true
      if (!isEarpieceSelected(am)) {
        Log.i(TAG, "media pin speaker ok=$ok comm=${commType(am)}")
        return true
      }
      if (!sandwich) {
        Log.w(TAG, "media pin speaker still earpiece ok=$ok comm=${commType(am)}")
        return false
      }
      val restore = am.mode
      am.mode = AudioManager.MODE_IN_COMMUNICATION
      val sandwiched = try {
        am.setCommunicationDevice(speakerDev)
      } catch (_: Exception) {
        false
      }
      @Suppress("DEPRECATION")
      am.isSpeakerphoneOn = true
      Log.i(TAG, "media sandwich pin ok=$sandwiched comm=${commType(am)}")
      am.mode = restore
      return !isEarpieceSelected(am)
    }

    private fun commType(am: AudioManager): String {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return "na"
      return try {
        am.communicationDevice?.type?.toString() ?: "none"
      } catch (_: Exception) {
        "err"
      }
    }

    /**
     * Request USAGE_MEDIA focus so leftover LiveKit/call USAGE_VOICE_COMMUNICATION
     * focus is displaced. The request is held until a call takes the session back:
     * abandoning it here hands focus straight back to the voice owner, which
     * re-selects the earpiece.
     */
    private fun displaceVoiceCommunicationFocus(am: AudioManager) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        @Suppress("DEPRECATION")
        try {
          am.abandonAudioFocus(null)
        } catch (_: Exception) {
        }
        return
      }
      abandonMediaFocus(am)
      try {
        val attrs = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
          .build()
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
          .setAudioAttributes(attrs)
          .setAcceptsDelayedFocusGain(false)
          .setOnAudioFocusChangeListener { }
          .build()
        val result = am.requestAudioFocus(req)
        mediaFocusRequest = req
        Log.i(TAG, "mediaFocus displace result=$result")
      } catch (e: Exception) {
        Log.w(TAG, "mediaFocus displace failed ${e.message}")
      }
    }

    private fun abandonMediaFocus(am: AudioManager) {
      val req = mediaFocusRequest
      mediaFocusRequest = null
      if (req != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        try {
          am.abandonAudioFocusRequest(req)
        } catch (_: Exception) {
        }
      }
    }

    private fun stopLeftoverSco(am: AudioManager) {
      try {
        @Suppress("DEPRECATION")
        if (am.isBluetoothScoOn) {
          @Suppress("DEPRECATION")
          am.stopBluetoothSco()
          @Suppress("DEPRECATION")
          am.isBluetoothScoOn = false
        }
      } catch (_: Exception) {
      }
    }

    private fun commDevices(am: AudioManager): List<AudioDeviceInfo> {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return emptyList()
      return try {
        am.availableCommunicationDevices
      } catch (_: Exception) {
        emptyList()
      }
    }

    private fun findBuiltinSpeaker(devices: List<AudioDeviceInfo>): AudioDeviceInfo? {
      return devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
        ?: devices.firstOrNull { it.type == TYPE_BUILTIN_SPEAKER_SAFE }
    }

    private fun findHeadset(devices: List<AudioDeviceInfo>): AudioDeviceInfo? {
      return devices.firstOrNull { isHeadsetType(it.type) }
    }

    private fun isHeadsetType(type: Int): Boolean {
      if (type == AudioDeviceInfo.TYPE_WIRED_HEADSET) return true
      if (type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES) return true
      if (type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) return true
      if (type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) return true
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && type == AudioDeviceInfo.TYPE_USB_HEADSET) {
        return true
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && type == TYPE_BLE_HEADSET) {
        return true
      }
      return false
    }

    private fun isEarpieceSelected(am: AudioManager): Boolean {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false
      return try {
        am.communicationDevice?.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
      } catch (_: Exception) {
        false
      }
    }

    fun snapshotMap(context: Context): WritableNativeMap {
      val am = context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      val map = WritableNativeMap()
      val mode = try {
        am.mode
      } catch (_: Exception) {
        -1
      }
      val speaker = try {
        @Suppress("DEPRECATION")
        am.isSpeakerphoneOn
      } catch (_: Exception) {
        false
      }
      val comm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        try {
          am.communicationDevice?.type?.toString() ?: "none"
        } catch (_: Exception) {
          "err"
        }
      } else {
        "na"
      }
      map.putInt("mode", mode)
      map.putString(
        "modeName",
        when (mode) {
          AudioManager.MODE_NORMAL -> "MODE_NORMAL"
          AudioManager.MODE_RINGTONE -> "MODE_RINGTONE"
          AudioManager.MODE_IN_CALL -> "MODE_IN_CALL"
          AudioManager.MODE_IN_COMMUNICATION -> "MODE_IN_COMMUNICATION"
          else -> "MODE_$mode"
        },
      )
      map.putBoolean("speakerphone", speaker)
      map.putString("commDevice", comm)
      return map
    }
  }
}
