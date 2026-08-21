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
import java.util.concurrent.Executor

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
 * - Listens for communication-device changes (API 31+) so Fold OEM earpiece snaps are
 *   repaired immediately, not only on the next watchdog tick.
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
    private val mainExecutor = Executor { mainHandler.post(it) }

    @Volatile
    private var activeProfile: Profile? = null
    private var lastSignature: String? = null
    private var publishFocusRequest: AudioFocusRequest? = null
    private var publishFocusHeld: Boolean = false
    private var playbackFocusRequest: AudioFocusRequest? = null
    private var playbackFocusHeld: Boolean = false
    private var burstToken: Long = 0L
    private var deviceListenerRegistered: Boolean = false

    private val communicationDeviceListener =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AudioManager.OnCommunicationDeviceChangedListener { device ->
                val profile = activeProfile ?: return@OnCommunicationDeviceChangedListener
                val type = device?.type
                if (type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) {
                    Log.w(
                        logTag,
                        "[IVS_AUDIO_ROUTE] OEM selected earpiece while live; re-pinning speaker",
                    )
                    applyRoute(profile, "comm-device-earpiece")
                    scheduleBurstReassert("comm-device-earpiece")
                } else if (type != null &&
                    type != AudioDeviceInfo.TYPE_BUILTIN_SPEAKER &&
                    type != TYPE_BUILTIN_SPEAKER_SAFE &&
                    !isBluetoothCommDevice(type) &&
                    !isWiredCommDevice(type)
                ) {
                    // Unknown non-speaker device while publishing — force speaker unless headset.
                    Log.w(logTag, "[IVS_AUDIO_ROUTE] unexpected comm device type=$type; reassert")
                    applyRoute(profile, "comm-device-unexpected-$type")
                }
            }
        } else {
            null
        }

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
                    scheduleBurstReassert("audio-focus-loss")
                }
            }
        }
    }

    private val watchdog = object : Runnable {
        override fun run() {
            val profile = activeProfile ?: return
            if (profile == Profile.PLAYBACK && playbackRouteAlreadyGood()) {
                mainHandler.postDelayed(this, WATCHDOG_PLAYBACK_INTERVAL_MS)
                return
            }
            applyRoute(profile, "watchdog")
            if (activeProfile == profile) {
                val interval = when {
                    profile == Profile.PUBLISHING && isEarpieceSelected() ->
                        WATCHDOG_EARPIECE_INTERVAL_MS
                    profile == Profile.PLAYBACK && isEarpieceSelected() ->
                        WATCHDOG_PLAYBACK_EARPIECE_INTERVAL_MS
                    profile == Profile.PLAYBACK -> WATCHDOG_PLAYBACK_INTERVAL_MS
                    else -> WATCHDOG_INTERVAL_MS
                }
                mainHandler.postDelayed(this, interval)
            }
        }
    }

    fun start(profile: Profile, reason: String) {
        runOnMain {
            activeProfile = profile
            registerCommunicationDeviceListener()
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
            // Watch leftover JS pins must not yank guest/host off MODE_IN_COMMUNICATION
            // (Samsung then keeps VIDEO_CHAT on the earpiece).
            val resolved =
                if (activeProfile == Profile.PUBLISHING && profile == Profile.PLAYBACK) {
                    Log.w(
                        logTag,
                        "[IVS_AUDIO_ROUTE] ignore playback force while publishing reason=$reason",
                    )
                    Profile.PUBLISHING
                } else {
                    profile
                }
            // Keep owner profile aligned with JS force calls (guest join path).
            if (activeProfile == null) {
                activeProfile = resolved
                registerCommunicationDeviceListener()
                mainHandler.removeCallbacks(watchdog)
                mainHandler.postDelayed(watchdog, INITIAL_REASSERT_DELAY_MS)
            } else if (activeProfile != resolved) {
                activeProfile = resolved
            }
            if (resolved == Profile.PLAYBACK && playbackRouteAlreadyGood() && !isEarpieceSelected()) {
                return@runOnMain
            }
            applyRoute(resolved, reason)
            if (shouldBurstReassert(reason) || isEarpieceSelected()) {
                scheduleBurstReassert(reason)
            }
        }
    }

    fun forceActive(reason: String) {
        runOnMain {
            activeProfile?.let { profile ->
                val r = reason.lowercase()
                val viewerSubscribeNoise =
                    profile == Profile.PLAYBACK &&
                        (r.contains("subscribe-state") ||
                            r.contains("publish-state") ||
                            r.contains("remote-media") ||
                            r.contains("remote-audio") ||
                            r.contains("participant-joined") ||
                            r.contains("participant-left"))
                if (viewerSubscribeNoise && !isEarpieceSelected()) {
                    return@let
                }
                applyRoute(profile, reason)
                if (shouldBurstReassert(reason) || isEarpieceSelected()) {
                    if (profile == Profile.PLAYBACK && viewerSubscribeNoise) return@let
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
            unregisterCommunicationDeviceListener()
            try {
                abandonPublishAudioFocus()
                abandonPlaybackAudioFocus()
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
            r.contains("local-published") ||
            r.contains("stage-join") ||
            r.contains("stage-state") ||
            r.contains("streams-added") ||
            r.contains("guest-") ||
            r.contains("host-") ||
            r.contains("join-flow") ||
            r.contains("comm-device") ||
            r.contains("audio-focus") ||
            r.contains("broadcast-state") ||
            r.contains("earpiece")
    }

    /**
     * IVS / Samsung often flip communicationDevice back to EARPIECE *after* the join
     * callback returns (WebRTC peer connect). Re-pin across a longer window — Fold 7
     * has been observed to snap back past the previous 3s burst.
     */
    private fun scheduleBurstReassert(reason: String) {
        val token = ++burstToken
        val profile = activeProfile ?: return
        // Watch-only: 8 AudioManager mutations on the UI thread is what froze likes/leave.
        val delays =
            if (profile == Profile.PLAYBACK) longArrayOf(250L, 1200L)
            else longArrayOf(80L, 200L, 450L, 900L, 1600L, 3200L, 5500L, 9000L)
        for (delay in delays) {
            mainHandler.postDelayed(
                {
                    if (token != burstToken) return@postDelayed
                    val active = activeProfile ?: return@postDelayed
                    if (active == Profile.PLAYBACK && playbackRouteAlreadyGood()) return@postDelayed
                    applyRoute(active, "burst-$delay-$reason")
                },
                delay,
            )
        }
    }

    private fun registerCommunicationDeviceListener() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        val listener = communicationDeviceListener ?: return
        if (deviceListenerRegistered) return
        try {
            audioManager.addOnCommunicationDeviceChangedListener(mainExecutor, listener)
            deviceListenerRegistered = true
            Log.i(logTag, "[IVS_AUDIO_ROUTE] communication-device listener registered")
        } catch (error: Throwable) {
            Log.w(logTag, "[IVS_AUDIO_ROUTE] failed to register communication-device listener", error)
        }
    }

    private fun unregisterCommunicationDeviceListener() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        val listener = communicationDeviceListener ?: return
        if (!deviceListenerRegistered) return
        try {
            audioManager.removeOnCommunicationDeviceChangedListener(listener)
        } catch (error: Throwable) {
            Log.w(logTag, "[IVS_AUDIO_ROUTE] failed to unregister communication-device listener", error)
        } finally {
            deviceListenerRegistered = false
        }
    }

    private fun applyRoute(profile: Profile, reason: String) {
        try {
            if (profile == Profile.PLAYBACK && reason == "watchdog" && playbackRouteAlreadyGood()) {
                return
            }

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
                abandonPlaybackAudioFocus()
                ensurePublishAudioFocus()
                val selection = selectPublishingCommunicationDevice()
                routeChoice = selection.label
                communicationDevice = selection.deviceLabel
            } else {
                abandonPublishAudioFocus()
                stopBluetoothScoIfNeeded()
                ensurePlaybackAudioFocus()
                val pinned = pinWatchLoudspeaker()
                communicationDevice = currentCommDeviceLabel()
                routeChoice = if (pinned) "media-loudspeaker" else "media-loudspeaker-unverified"
            }

            // Watchdog/route churn can leave StageAudioManager without AEC after a prior
            // SUBSCRIBE_ONLY session or OEM/expo-av audio-policy reset. Re-assert on every
            // publishing force so loudspeaker output cannot re-enter the open mic.
            var aec = "n/a"
            var usage = "n/a"
            if (profile == Profile.PUBLISHING && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                try {
                    val stageAudio = StageAudioManager.getInstance(appContext)
                    // VIDEO_CHAT / WebRTC publish re-enables SDK mode ownership and
                    // selects the receiver. Keep mode+device on this controller.
                    stageAudio.setAudioModeManagementEnabled(false)
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
            } else if (profile == Profile.PLAYBACK && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                try {
                    val stageAudio = StageAudioManager.getInstance(appContext)
                    usage = stageAudio.usage.name
                } catch (_: Throwable) {
                }
            }

            // Last-chance sandwich is host/guest only. Watch-only sandwich
            // flips MODE_IN_COMMUNICATION, OEM treats it as a call, earpiece
            // snaps, and the 500ms watchdog froze likes/leave.
            if (profile == Profile.PUBLISHING &&
                isEarpieceSelected() &&
                findConnectedHeadset() == null
            ) {
                Log.w(logTag, "[IVS_AUDIO_ROUTE] earpiece still selected after route; sandwich pin")
                pinBuiltinSpeaker(sandwich = true)
                if (audioManager.mode != AudioManager.MODE_IN_COMMUNICATION) {
                    audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
                }
                @Suppress("DEPRECATION")
                run { audioManager.isSpeakerphoneOn = true }
                communicationDevice = currentCommDeviceLabel()
                routeChoice = "$routeChoice+sandwich"
            } else if (profile == Profile.PLAYBACK && isEarpieceSelected()) {
                val pinned = pinWatchLoudspeaker()
                communicationDevice = currentCommDeviceLabel()
                routeChoice = if (pinned) "$routeChoice+watch-repin" else "$routeChoice+watch-repin-fail"
            }

            val volumeControlStream = bindVolumeControlStream(profile)

            // Last write: WebRTC publish often clears speakerphone after we pin.
            if (profile == Profile.PUBLISHING && findConnectedHeadset() == null) {
                if (audioManager.mode != AudioManager.MODE_IN_COMMUNICATION) {
                    audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
                }
                @Suppress("DEPRECATION")
                run { audioManager.isSpeakerphoneOn = true }
            }

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
            // availableCommunicationDevices lists *possible* BT/wired on Fold even when
            // nothing is plugged in. Selecting those turns speakerphone off and Samsung
            // falls back to the earpiece for MODE_IN_COMMUNICATION.
            val headset = findConnectedHeadset()
            if (headset != null) {
                try {
                    audioManager.setCommunicationDevice(headset)
                } catch (_: Exception) {
                }
                @Suppress("DEPRECATION")
                run { audioManager.isSpeakerphoneOn = false }
                val deviceLabel = currentCommDeviceLabel()
                val label =
                    if (isBluetoothCommDevice(headset.type)) "bt-headset" else "wired-headset"
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

    /**
     * Watch-only loudspeaker. Media audio (SUBSCRIBE_ONLY) must not stay on
     * setCommunicationDevice(SPEAKER) — Samsung then treats watch as a call
     * and the earpiece wins. Clear the communication device, MODE_NORMAL,
     * speakerphone on. If the OEM already snapped to earpiece, pin speaker
     * once, then keep speakerphone.
     */
    private fun pinWatchLoudspeaker(): Boolean {
        if (audioManager.mode != AudioManager.MODE_NORMAL) {
            audioManager.mode = AudioManager.MODE_NORMAL
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                audioManager.clearCommunicationDevice()
            } catch (_: Exception) {
            }
        }
        @Suppress("DEPRECATION")
        run { audioManager.isSpeakerphoneOn = true }
        if (!isEarpieceSelected()) {
            Log.i(
                logTag,
                "[IVS_AUDIO_ROUTE] watch loudspeaker mode=${audioManager.mode} comm=${currentCommDeviceLabel()}",
            )
            return true
        }
        Log.w(logTag, "[IVS_AUDIO_ROUTE] watch still earpiece after media pin; speaker device")
        pinBuiltinSpeaker(sandwich = true)
        if (audioManager.mode != AudioManager.MODE_NORMAL) {
            audioManager.mode = AudioManager.MODE_NORMAL
        }
        @Suppress("DEPRECATION")
        run { audioManager.isSpeakerphoneOn = true }
        if (!isEarpieceSelected()) return true
        Log.w(logTag, "[IVS_AUDIO_ROUTE] watch media path lost; communication speaker")
        pinBuiltinSpeaker(sandwich = true)
        if (audioManager.mode != AudioManager.MODE_IN_COMMUNICATION) {
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
        }
        @Suppress("DEPRECATION")
        run { audioManager.isSpeakerphoneOn = true }
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

    private fun ensurePlaybackAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val existing = playbackFocusRequest
            if (existing != null && playbackFocusHeld) return
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build()
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setAcceptsDelayedFocusGain(true)
                .build()
            val result = audioManager.requestAudioFocus(request)
            playbackFocusRequest = request
            playbackFocusHeld = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        } else if (!playbackFocusHeld) {
            @Suppress("DEPRECATION")
            val result = audioManager.requestAudioFocus(
                null,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN,
            )
            playbackFocusHeld = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        }
    }

    private fun abandonPlaybackAudioFocus() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                playbackFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
            } else if (playbackFocusHeld) {
                @Suppress("DEPRECATION")
                audioManager.abandonAudioFocus(null)
            }
        } catch (error: Throwable) {
            Log.w(logTag, "[IVS_AUDIO_ROUTE] abandon playback focus failed", error)
        } finally {
            playbackFocusRequest = null
            playbackFocusHeld = false
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
        val fromList =
            devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
                ?: devices.firstOrNull { it.type == TYPE_BUILTIN_SPEAKER_SAFE }
        if (fromList != null) return fromList
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return null
        return try {
            audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).firstOrNull {
                it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER || it.type == TYPE_BUILTIN_SPEAKER_SAFE
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun findConnectedHeadset(): AudioDeviceInfo? {
        // Fold lists paired BT/BLE in getDevices() even when nothing is in the ear.
        // Selecting those turns speakerphone off and MODE_IN_COMMUNICATION uses the
        // receiver. Only a physically plugged jack or active SCO is a headset.
        @Suppress("DEPRECATION")
        if (audioManager.isWiredHeadsetOn) {
            commDevices().firstOrNull { isWiredCommDevice(it.type) }?.let { return it }
        }
        @Suppress("DEPRECATION")
        if (audioManager.isBluetoothScoOn) {
            commDevices().firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }?.let { return it }
        }
        return null
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

    /**
     * True when watch-only audio is already on the media speaker path.
     * Mutating AudioManager in that state (clear/set communication device)
     * retriggers OEM earpiece snaps and UI-thread stalls.
     */
    private fun playbackRouteAlreadyGood(): Boolean {
        if (isEarpieceSelected()) return false
        val comm = currentCommDeviceLabel().lowercase()
        if (comm.contains("earpiece")) return false
        @Suppress("DEPRECATION")
        if (audioManager.isSpeakerphoneOn) return true
        return comm.contains("speaker")
    }

    private companion object {
        const val INITIAL_REASSERT_DELAY_MS = 250L
        const val WATCHDOG_INTERVAL_MS = 2_000L
        /** Watch-only: cheap check, do not hammer AudioManager. */
        const val WATCHDOG_PLAYBACK_INTERVAL_MS = 5_000L
        /** Watch-only while earpiece is stuck — slower than publish so likes/leave stay alive. */
        const val WATCHDOG_PLAYBACK_EARPIECE_INTERVAL_MS = 2_000L
        /** While earpiece is stuck on a publish session, hammer the route harder. */
        const val WATCHDOG_EARPIECE_INTERVAL_MS = 500L
        const val VOLUME_CONTROL_UNAVAILABLE = Int.MIN_VALUE
        /** Some OEM builds report speaker as type 24. */
        const val TYPE_BUILTIN_SPEAKER_SAFE = 24
    }
}
