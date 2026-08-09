package com.blyp.mobile.ivs

import android.app.Activity
import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.amazonaws.ivs.broadcast.StageAudioManager
import com.facebook.react.bridge.ReactContext

/**
 * Owns the operating-system audio route while an IVS live session is active.
 *
 * IVS audio attributes alone do not force an output device. In particular, creating or
 * publishing a Stage can put AudioManager back into MODE_IN_COMMUNICATION with the receiver
 * selected. This guard keeps the built-in speaker selected for the full session and repairs
 * later route/mode changes made by IVS, expo-av, LiveKit, or an OEM audio policy.
 *
 * For PUBLISHING profiles it also:
 * - Re-asserts StageAudioManager AEC on every force/watchdog tick (join-time configure can
 *   be cleared by SUBSCRIBE_ONLY / OEM / expo-av churn while the mic stays open).
 * - Binds Activity volume keys to STREAM_VOICE_CALL so OEMs (notably Samsung Fold) do not
 *   leave the rocker on STREAM_MUSIC while Stage plays on the communication path.
 *
 * PLAYBACK keeps media volume (viewer/HLS path).
 */
internal class LiveLoudspeakerController(
    context: Context,
    private val logTag: String,
) {
    enum class Profile {
        PUBLISHING,
        PLAYBACK,
    }

    private val appContext = context.applicationContext
    private val reactContext = context as? ReactContext
    private val audioManager =
        appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    private var activeProfile: Profile? = null
    private var lastSignature: String? = null

    private val watchdog = object : Runnable {
        override fun run() {
            val profile = activeProfile ?: return
            applyRoute(profile, "watchdog")
            if (activeProfile == profile) {
                mainHandler.postDelayed(this, WATCHDOG_INTERVAL_MS)
            }
        }
    }

    fun start(profile: Profile, reason: String) {
        runOnMain {
            activeProfile = profile
            mainHandler.removeCallbacks(watchdog)
            applyRoute(profile, reason)
            // IVS commonly updates AudioManager shortly after join/publish. The first
            // delayed check catches that race; the continuing watchdog catches any later
            // expo-av/LiveKit/OEM reset for the entire live session.
            mainHandler.postDelayed(watchdog, INITIAL_REASSERT_DELAY_MS)
        }
    }

    fun force(profile: Profile, reason: String) {
        runOnMain {
            applyRoute(profile, reason)
        }
    }

    fun forceActive(reason: String) {
        runOnMain {
            activeProfile?.let { applyRoute(it, reason) }
        }
    }

    fun stop(reason: String) {
        runOnMain {
            activeProfile = null
            mainHandler.removeCallbacks(watchdog)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    audioManager.clearCommunicationDevice()
                }
                @Suppress("DEPRECATION")
                if (audioManager.isBluetoothScoOn) {
                    @Suppress("DEPRECATION")
                    audioManager.stopBluetoothSco()
                    @Suppress("DEPRECATION")
                    run { audioManager.isBluetoothScoOn = false }
                }
                if (audioManager.mode != AudioManager.MODE_NORMAL) {
                    audioManager.mode = AudioManager.MODE_NORMAL
                }
                @Suppress("DEPRECATION")
                run { audioManager.isSpeakerphoneOn = false }
                val volumeControlStream = bindVolumeControlStream(null)
                Log.i(
                    logTag,
                    "[IVS_AUDIO_ROUTE] owner released reason=$reason mode=${audioManager.mode} " +
                        "volumeControlStream=${volumeControlStreamLabel(volumeControlStream)}",
                )
            } catch (error: Throwable) {
                Log.e(logTag, "[IVS_AUDIO_ROUTE] owner release failed reason=$reason", error)
            } finally {
                lastSignature = null
            }
        }
    }

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            block()
        } else {
            mainHandler.post(block)
        }
    }

    private fun applyRoute(profile: Profile, reason: String) {
        try {
            val desiredMode =
                if (profile == Profile.PUBLISHING) {
                    // Required for the voice-processed microphone/AEC path.
                    AudioManager.MODE_IN_COMMUNICATION
                } else {
                    // Subscribe-only/HLS viewers must stay on normal media routing.
                    AudioManager.MODE_NORMAL
                }

            if (audioManager.mode != desiredMode) {
                audioManager.mode = desiredMode
            }

            // A lingering Bluetooth SCO route wins over isSpeakerphoneOn on older Android.
            @Suppress("DEPRECATION")
            if (audioManager.isBluetoothScoOn) {
                @Suppress("DEPRECATION")
                audioManager.stopBluetoothSco()
                @Suppress("DEPRECATION")
                run { audioManager.isBluetoothScoOn = false }
            }

            var communicationDevice = "legacy"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (profile == Profile.PUBLISHING) {
                    val speaker = audioManager.availableCommunicationDevices.firstOrNull {
                        it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                    }
                    if (speaker != null && audioManager.communicationDevice?.id != speaker.id) {
                        audioManager.setCommunicationDevice(speaker)
                    }
                } else {
                    // MODE_NORMAL + no communication-device override ensures IVS Player/
                    // subscribe-only Stage audio follows the loud media path.
                    audioManager.clearCommunicationDevice()
                }
                communicationDevice =
                    audioManager.communicationDevice?.let { "${it.type}:${it.productName}" } ?: "none"
            }

            // Still required through API 30 and retained as an OEM fallback on API 31+.
            @Suppress("DEPRECATION")
            run { audioManager.isSpeakerphoneOn = true }

            // Watchdog/route churn can leave StageAudioManager without AEC after a prior
            // SUBSCRIBE_ONLY session or OEM/expo-av audio-policy reset. Re-assert on every
            // publishing force so loudspeaker output cannot re-enter the open mic.
            // Does not fix two phones in the same physical room (air-path coupling).
            var aec = "n/a"
            if (profile == Profile.PUBLISHING && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                try {
                    val stageAudio = StageAudioManager.getInstance(appContext)
                    stageAudio.enableEchoCancellation(true)
                    aec = "on"
                } catch (aecError: Throwable) {
                    aec = "failed:${aecError.message}"
                    Log.w(logTag, "[IVS_AUDIO_ROUTE] AEC reassert failed reason=$reason", aecError)
                }
            }

            val volumeControlStream = bindVolumeControlStream(profile)

            @Suppress("DEPRECATION")
            val speakerOn = audioManager.isSpeakerphoneOn
            val voiceVol = audioManager.getStreamVolume(AudioManager.STREAM_VOICE_CALL)
            val voiceMax = audioManager.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL)
            val mediaVol = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC)
            val mediaMax = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            val signature =
                "profile=$profile mode=${audioManager.mode} speakerphoneOn=$speakerOn " +
                    "communicationDevice=$communicationDevice aec=$aec " +
                    "volumeControlStream=${volumeControlStreamLabel(volumeControlStream)} " +
                    "voiceVol=$voiceVol/$voiceMax mediaVol=$mediaVol/$mediaMax"
            if (reason != "watchdog" || signature != lastSignature) {
                Log.i(logTag, "[IVS_AUDIO_ROUTE] forced reason=$reason $signature")
            }
            lastSignature = signature
        } catch (error: Throwable) {
            Log.e(
                logTag,
                "[IVS_AUDIO_ROUTE] force failed reason=$reason profile=$profile: ${error.message}",
                error,
            )
        }
    }

    /**
     * Samsung Fold (and some OEMs) key volume off AudioAttributes.Usage / the Activity
     * volume-control stream more strictly than MODE_IN_COMMUNICATION alone. Keep keys on
     * the same stream Stage is using for the active profile.
     */
    private fun bindVolumeControlStream(profile: Profile?): Int {
        val activity: Activity = reactContext?.currentActivity ?: return VOLUME_CONTROL_UNAVAILABLE
        val desired = when (profile) {
            Profile.PUBLISHING -> AudioManager.STREAM_VOICE_CALL
            Profile.PLAYBACK -> AudioManager.STREAM_MUSIC
            null -> AudioManager.USE_DEFAULT_STREAM_TYPE
        }
        if (activity.volumeControlStream != desired) {
            activity.volumeControlStream = desired
        }
        return activity.volumeControlStream
    }

    private fun volumeControlStreamLabel(stream: Int): String {
        return when (stream) {
            AudioManager.STREAM_VOICE_CALL -> "STREAM_VOICE_CALL"
            AudioManager.STREAM_MUSIC -> "STREAM_MUSIC"
            AudioManager.USE_DEFAULT_STREAM_TYPE -> "USE_DEFAULT"
            VOLUME_CONTROL_UNAVAILABLE -> "unavailable(no-activity)"
            else -> "stream:$stream"
        }
    }

    private companion object {
        const val INITIAL_REASSERT_DELAY_MS = 250L
        const val WATCHDOG_INTERVAL_MS = 2_000L
        const val VOLUME_CONTROL_UNAVAILABLE = Int.MIN_VALUE
    }
}
