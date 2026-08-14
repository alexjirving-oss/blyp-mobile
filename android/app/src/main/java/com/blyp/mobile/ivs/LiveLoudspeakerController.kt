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
 * publishing a Stage — and especially when a remote guest joins — puts AudioManager into
 * MODE_IN_COMMUNICATION with the **earpiece/receiver** selected (Samsung Fold default).
 * That is the "host/guests sound quiet" bug: call-volume path on the wrong transducer.
 *
 * This guard keeps the built-in loudspeaker selected for the full session and repairs
 * later route/mode changes made by IVS WebRTC peer connect, expo-av, LiveKit, or OEM policy.
 *
 * For PUBLISHING profiles it also:
 * - Prefers BT SCO / wired headset when present (IVS VIDEO_CHAT "any output should work");
 *   only forces the built-in speaker when no headset route exists.
 * - Holds voice-communication audio focus so expo-av media stings cannot steal the call path.
 * - Re-asserts StageAudioManager AEC on every force/watchdog tick.
 * - Binds Activity volume keys to STREAM_VOICE_CALL so OEMs (notably Samsung Fold) do not
 *   leave the rocker on STREAM_MUSIC while Stage plays on the communication path.
 * - Burst-reasserts after guest join / remote audio / subscribe churn (IVS flips earpiece
 *   *after* the participant-joined callback returns).
 *
 * PLAYBACK keeps media volume (viewer/HLS path) but still pins builtin SPEAKER —
 * Samsung clearCommunicationDevice() alone leaves TYPE_BUILTIN_EARPIECE.
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
    private var burstToken: Long = 0L

    private val focusChangeListener = AudioManager.OnAudioFocusChangeListener { change ->
        // expo-av / OEM focus loss is repaired on the next watchdog tick via ensurePublishAudioFocus.
        // Clear the held flag immediately so ensure cannot no-op on a stale grant.
        if (activeProfile == Profile.PUBLISHING &&
            (change == AudioManager.AUDIOFOCUS_LOSS ||
                change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT ||
                change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK)
        ) {
            publishFocusHeld = false
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
                // Faster tick while earpiece is still selected — guest-join OEM races.
                val interval =
                    if (isEarpieceSelected()) WATCHDOG_EARPIECE_INTERVAL_MS else WATCHDOG_INTERVAL_MS
                mainHandler.postDelayed(this, interval)
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
            scheduleBurstReassert(reason)
        }
    }

    fun force(profile: Profile, reason: String) {
        runOnMain {
            applyRoute(profile, reason)
            if (shouldBurstReassert(reason)) {
                scheduleBurstReassert(reason)
            }
        }
    }

    fun forceActive(reason: String) {
        runOnMain {
            activeProfile?.let { profile ->
                applyRoute(profile, reason)
                if (shouldBurstReassert(reason)) {
                    scheduleBurstReassert(reason)
                }
            }
        }
    }

    fun stop(reason: String) {
        runOnMain {
            activeProfile = null
            burstToken += 1
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

    private fun shouldBurstReassert(reason: String): Boolean {
        val r = reason.lowercase()
        return r.contains("participant-joined") ||
            r.contains("participant-left") ||
            r.contains("remote-audio") ||
            r.contains("remote-media") ||
            r.contains("subscribe-state") ||
            r.contains("publish-state") ||
            r.contains("stage-join") ||
            r.contains("streams-added") ||
            r.contains("guest-") ||
            r.contains("host-")
    }

    /**
     * IVS / Samsung often flip communicationDevice back to EARPIECE *after* the join
     * callback returns (WebRTC peer connect). Re-pin a few times on a short cadence.
     */
    private fun scheduleBurstReassert(reason: String) {
        val token = ++burstToken
        val delays = longArrayOf(120L, 350L, 750L, 1500L, 3000L)
        for (delay in delays) {
            mainHandler.postDelayed(
                {
                    if (token != burstToken) return@postDelayed
                    val profile = activeProfile ?: return@postDelayed
                    applyRoute(profile, "burst-$delay-$reason")
                },
                delay,
            )
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
                stopBluetoothScoIfNeeded()
                // Samsung: clearCommunicationDevice() alone leaves TYPE_BUILTIN_EARPIECE.
                // Pin builtin SPEAKER explicitly so Stage/HLS subscribe is not quiet.
                val pinned = pinBuiltinSpeaker(sandwich = false)
                communicationDevice = currentCommDeviceLabel()
                @Suppress("DEPRECATION")
                run { audioManager.isSpeakerphoneOn = true }
                routeChoice = if (pinned) "media-speaker-pinned" else "media-speaker"
            }

            // Watchdog/route churn can leave StageAudioManager without AEC after a prior
            // SUBSCRIBE_ONLY session or OEM/expo-av audio-policy reset. Re-assert on every
            // publishing force so loudspeaker output cannot re-enter the open mic.
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

            // Last-chance: if OEM still selected earpiece, sandwich-pin speaker.
            if (isEarpieceSelected() && findHeadset(commDevices()) == null) {
                Log.w(logTag, "[IVS_AUDIO_ROUTE] earpiece still selected after route; sandwich pin")
                pinBuiltinSpeaker(sandwich = true)
                if (profile == Profile.PUBLISHING && audioManager.mode != AudioManager.MODE_IN_COMMUNICATION) {
                    audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
                }
                @Suppress("DEPRECATION")
                run { audioManager.isSpeakerphoneOn = true }
                communicationDevice = currentCommDeviceLabel()
                routeChoice = "$routeChoice+sandwich"
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
            val devices = commDevices()
            val bt = devices.firstOrNull { isBluetoothCommDevice(it.type) }
            val wired = devices.firstOrNull { isWiredCommDevice(it.type) }
            if (bt != null || wired != null) {
                val chosen = bt ?: wired!!
                try {
                    audioManager.setCommunicationDevice(chosen)
                } catch (_: Exception) {
                }
                @Suppress("DEPRECATION")
                run { audioManager.isSpeakerphoneOn = false }
                val deviceLabel = currentCommDeviceLabel()
                val label = if (bt != null) "bt-headset" else "wired-headset"
                return CommSelection(label, deviceLabel)
            }

            // No headset: NEVER leave MODE_IN_COMMUNICATION on the earpiece (Fold quiet path).
            // clear → set SPEAKER → speakerphoneOn; sandwich if OEM snaps back to earpiece.
            val pinned = pinBuiltinSpeaker(sandwich = true)
            // Publishing must stay in communication mode after sandwich (pin may have
            // toggled mode temporarily on Samsung).
            if (audioManager.mode != AudioManager.MODE_IN_COMMUNICATION) {
                audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
                pinBuiltinSpeaker(sandwich = false)
            }
            @Suppress("DEPRECATION")
            run { audioManager.isSpeakerphoneOn = true }
            return CommSelection(
                if (pinned) "builtin-speaker" else "builtin-speaker-unverified",
                currentCommDeviceLabel(),
            )
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

    /**
     * clearCommunicationDevice() then explicitly select the builtin speaker.
     * Samsung Fold often ignores a bare setCommunicationDevice while mode is wrong, or
     * snaps back to TYPE_BUILTIN_EARPIECE after guest WebRTC connect — sandwich helps.
     */
    private fun pinBuiltinSpeaker(sandwich: Boolean): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            @Suppress("DEPRECATION")
            run { audioManager.isSpeakerphoneOn = true }
            return true
        }
        val speakerDev = findBuiltinSpeaker(commDevices())
        if (speakerDev == null) {
            Log.w(logTag, "[IVS_AUDIO_ROUTE] no builtin speaker communication device")
            @Suppress("DEPRECATION")
            run { audioManager.isSpeakerphoneOn = true }
            return false
        }
        try {
            audioManager.clearCommunicationDevice()
        } catch (_: Exception) {
        }
        val ok = try {
            audioManager.setCommunicationDevice(speakerDev)
        } catch (_: Exception) {
            false
        }
        @Suppress("DEPRECATION")
        run { audioManager.isSpeakerphoneOn = true }
        if (!isEarpieceSelected()) {
            Log.i(logTag, "[IVS_AUDIO_ROUTE] pin speaker ok=$ok comm=${currentCommDeviceLabel()}")
            return true
        }
        if (!sandwich) {
            Log.w(logTag, "[IVS_AUDIO_ROUTE] pin speaker still earpiece ok=$ok comm=${currentCommDeviceLabel()}")
            return false
        }
        val restore = audioManager.mode
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
        val sandwiched = try {
            audioManager.setCommunicationDevice(speakerDev)
        } catch (_: Exception) {
            false
        }
        @Suppress("DEPRECATION")
        run { audioManager.isSpeakerphoneOn = true }
        Log.i(
            logTag,
            "[IVS_AUDIO_ROUTE] sandwich pin ok=$sandwiched comm=${currentCommDeviceLabel()}",
        )
        // Keep MODE_IN_COMMUNICATION when publishing; restore only for playback callers.
        if (activeProfile != Profile.PUBLISHING) {
            audioManager.mode = restore
            try {
                audioManager.setCommunicationDevice(speakerDev)
            } catch (_: Exception) {
            }
            @Suppress("DEPRECATION")
            run { audioManager.isSpeakerphoneOn = true }
        }
        return !isEarpieceSelected()
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

    private fun commDevices(): List<AudioDeviceInfo> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return emptyList()
        return try {
            audioManager.availableCommunicationDevices
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun findBuiltinSpeaker(devices: List<AudioDeviceInfo>): AudioDeviceInfo? {
        return devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
            ?: devices.firstOrNull { it.type == TYPE_BUILTIN_SPEAKER_SAFE }
    }

    private fun findHeadset(devices: List<AudioDeviceInfo>): AudioDeviceInfo? {
        return devices.firstOrNull {
            isBluetoothCommDevice(it.type) || isWiredCommDevice(it.type)
        }
    }

    private fun isEarpieceSelected(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false
        return try {
            audioManager.communicationDevice?.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
        } catch (_: Exception) {
            false
        }
    }

    private fun currentCommDeviceLabel(): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return "legacy"
        return try {
            audioManager.communicationDevice?.let { "${it.type}:${it.productName}" } ?: "none"
        } catch (_: Exception) {
            "err"
        }
    }

    private companion object {
        const val INITIAL_REASSERT_DELAY_MS = 250L
        const val WATCHDOG_INTERVAL_MS = 2_000L
        /** While earpiece is stuck, hammer the route harder (Fold guest-join race). */
        const val WATCHDOG_EARPIECE_INTERVAL_MS = 500L
        const val VOLUME_CONTROL_UNAVAILABLE = Int.MIN_VALUE
        /** Some OEM builds report speaker as type 24. */
        const val TYPE_BUILTIN_SPEAKER_SAFE = 24
    }
}
