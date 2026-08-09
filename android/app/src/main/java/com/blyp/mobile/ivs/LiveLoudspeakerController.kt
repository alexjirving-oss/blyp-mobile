package com.blyp.mobile.ivs

import android.app.Activity
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
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
 * selected. This guard keeps the correct communication device selected for the full session
 * and repairs later route/mode changes made by IVS, expo-av, LiveKit, or an OEM audio policy.
 *
 * For PUBLISHING profiles it also:
 * - Prefers BT SCO / wired headset when present (IVS VIDEO_CHAT "any output should work");
 *   only forces the built-in speaker when no headset route exists.
 * - Holds voice-communication audio focus so expo-av media stings cannot steal the call path.
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
    private var publishFocusRequest: AudioFocusRequest? = null
    private var publishFocusHeld: Boolean = false

    private val focusChangeListener = AudioManager.OnAudioFocusChangeListener { change ->
        // expo-av / OEM focus loss is repaired on the next watchdog tick; log only.
        if (activeProfile == Profile.PUBLISHING &&
            (change == AudioManager.AUDIOFOCUS_LOSS ||
                change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT ||
                change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK)
        ) {
            Log.w(logTag, "[IVS_AUDIO_ROUTE] publish audio focus lost change=$change")
            mainHandler.post {
                if (activeProfile == Profile.PUBLISHING) {
                    applyRoute(Profile.PUBLISHING, "audio-focus-loss-$change")
                }
            }
        }
    }

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
                abandonPublishAudioFocus()
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

            var communicationDevice = "legacy"
            var routeChoice = "legacy"
            if (profile == Profile.PUBLISHING) {
                ensurePublishAudioFocus()
                val selection = selectPublishingCommunicationDevice()
                routeChoice = selection.label
                communicationDevice = selection.deviceLabel
            } else {
                abandonPublishAudioFocus()
                // A lingering Bluetooth SCO route wins over isSpeakerphoneOn on older Android.
                stopBluetoothScoIfNeeded()
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    // MODE_NORMAL + no communication-device override ensures IVS Player/
                    // subscribe-only Stage audio follows the loud media path.
                    audioManager.clearCommunicationDevice()
                    communicationDevice =
                        audioManager.communicationDevice?.let { "${it.type}:${it.productName}" }
                            ?: "none"
                }
                @Suppress("DEPRECATION")
                run { audioManager.isSpeakerphoneOn = true }
                routeChoice = "media-speaker"
            }

            // Watchdog/route churn can leave StageAudioManager without AEC after a prior
            // SUBSCRIBE_ONLY session or OEM/expo-av audio-policy reset. Re-assert on every
            // publishing force so loudspeaker output cannot re-enter the open mic.
            // Does not fix two phones in the same physical room (air-path coupling).
            // Note: setPreset cannot run while Stage/DeviceDiscovery are alive — AEC only.
            var aec = "n/a"
            var usage = "n/a"
            if (profile == Profile.PUBLISHING && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                try {
                    val stageAudio = StageAudioManager.getInstance(appContext)
                    stageAudio.enableEchoCancellation(true)
                    aec = if (stageAudio.isEchoCancellationEnabled) "on" else "off-after-enable"
                    usage = stageAudio.usage.name
                    if (stageAudio.usage != StageAudioManager.Usage.VOICE_COMMUNICATION) {
                        Log.w(
                            logTag,
                            "[IVS_AUDIO_ROUTE] publish usage drifted to $usage " +
                                "(expected VOICE_COMMUNICATION); cannot setPreset while Stage lives",
                        )
                    }
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
                    "route=$routeChoice communicationDevice=$communicationDevice " +
                    "aec=$aec usage=$usage focus=${if (publishFocusHeld) "held" else "none"} " +
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
     * VIDEO_CHAT expects headset routes to work. Only force the built-in speaker when no
     * BT SCO / BLE headset / wired headset is available as a communication device.
     */
    private data class CommSelection(val label: String, val deviceLabel: String)

    private fun selectPublishingCommunicationDevice(): CommSelection {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val devices = audioManager.availableCommunicationDevices
            val bt = devices.firstOrNull { isBluetoothCommDevice(it.type) }
            val wired = devices.firstOrNull { isWiredCommDevice(it.type) }
            val speaker = devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
            val chosen = bt ?: wired ?: speaker
            if (chosen != null && audioManager.communicationDevice?.id != chosen.id) {
                audioManager.setCommunicationDevice(chosen)
            }
            val usingSpeaker =
                chosen == null || chosen.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
            if (usingSpeaker) {
                stopBluetoothScoIfNeeded()
                @Suppress("DEPRECATION")
                run { audioManager.isSpeakerphoneOn = true }
            } else {
                // Headset owns both ends — forcing speakerphone fights SCO/AEC.
                @Suppress("DEPRECATION")
                run { audioManager.isSpeakerphoneOn = false }
            }
            val deviceLabel =
                audioManager.communicationDevice?.let { "${it.type}:${it.productName}" } ?: "none"
            val label = when {
                bt != null && chosen?.id == bt.id -> "bt-headset"
                wired != null && chosen?.id == wired.id -> "wired-headset"
                else -> "builtin-speaker"
            }
            return CommSelection(label, deviceLabel)
        }

        // Pre-S: prefer an already-active SCO headset; otherwise speakerphone.
        @Suppress("DEPRECATION")
        val scoOn = audioManager.isBluetoothScoOn
        if (scoOn) {
            @Suppress("DEPRECATION")
            run { audioManager.isSpeakerphoneOn = false }
            return CommSelection("bt-sco-legacy", "sco")
        }
        @Suppress("DEPRECATION")
        run { audioManager.isSpeakerphoneOn = true }
        return CommSelection("builtin-speaker-legacy", "legacy")
    }

    private fun isBluetoothCommDevice(type: Int): Boolean {
        if (type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) return true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (type == AudioDeviceInfo.TYPE_BLE_HEADSET) return true
        }
        return false
    }

    private fun isWiredCommDevice(type: Int): Boolean {
        if (type == AudioDeviceInfo.TYPE_WIRED_HEADSET) return true
        if (type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES) return true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (type == AudioDeviceInfo.TYPE_USB_HEADSET) return true
        }
        return false
    }

    private fun stopBluetoothScoIfNeeded() {
        @Suppress("DEPRECATION")
        if (audioManager.isBluetoothScoOn) {
            @Suppress("DEPRECATION")
            audioManager.stopBluetoothSco()
            @Suppress("DEPRECATION")
            run { audioManager.isBluetoothScoOn = false }
        }
    }

    private fun ensurePublishAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val existing = publishFocusRequest
            if (existing != null && publishFocusHeld) return
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setAcceptsDelayedFocusGain(true)
                .setOnAudioFocusChangeListener(focusChangeListener, mainHandler)
                .build()
            val result = audioManager.requestAudioFocus(request)
            publishFocusRequest = request
            publishFocusHeld = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        } else if (!publishFocusHeld) {
            @Suppress("DEPRECATION")
            val result = audioManager.requestAudioFocus(
                focusChangeListener,
                AudioManager.STREAM_VOICE_CALL,
                AudioManager.AUDIOFOCUS_GAIN,
            )
            publishFocusHeld = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        }
    }

    private fun abandonPublishAudioFocus() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                publishFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
            } else if (publishFocusHeld) {
                @Suppress("DEPRECATION")
                audioManager.abandonAudioFocus(focusChangeListener)
            }
        } catch (error: Throwable) {
            Log.w(logTag, "[IVS_AUDIO_ROUTE] abandon publish focus failed", error)
        } finally {
            publishFocusRequest = null
            publishFocusHeld = false
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
