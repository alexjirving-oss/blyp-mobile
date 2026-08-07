package com.blyp.mobile.ivs

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Owns the operating-system audio route while an IVS live session is active.
 *
 * IVS audio attributes alone do not force an output device. In particular, creating or
 * publishing a Stage can put AudioManager back into MODE_IN_COMMUNICATION with the receiver
 * selected. This guard keeps the built-in speaker selected for the full session and repairs
 * later route/mode changes made by IVS, expo-av, LiveKit, or an OEM audio policy.
 */
internal class LiveLoudspeakerController(
    context: Context,
    private val logTag: String,
) {
    enum class Profile {
        PUBLISHING,
        PLAYBACK,
    }

    private val audioManager =
        context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
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
                Log.i(logTag, "[IVS_AUDIO_ROUTE] owner released reason=$reason mode=${audioManager.mode}")
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

            @Suppress("DEPRECATION")
            val speakerOn = audioManager.isSpeakerphoneOn
            val signature =
                "profile=$profile mode=${audioManager.mode} speakerphoneOn=$speakerOn communicationDevice=$communicationDevice"
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

    private companion object {
        const val INITIAL_REASSERT_DELAY_MS = 250L
        const val WATCHDOG_INTERVAL_MS = 2_000L
    }
}
