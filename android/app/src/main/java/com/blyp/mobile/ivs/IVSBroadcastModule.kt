package com.blyp.mobile.ivs

import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.util.Log
import android.net.TrafficStats
import android.view.Surface
import com.amazonaws.ivs.broadcast.AudioLocalStageStream
import com.amazonaws.ivs.broadcast.BroadcastException
import com.amazonaws.ivs.broadcast.BroadcastConfiguration
import com.amazonaws.ivs.broadcast.Device
import com.amazonaws.ivs.broadcast.Device.Descriptor
import com.amazonaws.ivs.broadcast.Device.Descriptor.DeviceType
import com.amazonaws.ivs.broadcast.DeviceDiscovery
import com.amazonaws.ivs.broadcast.ImageLocalStageStream
import com.amazonaws.ivs.broadcast.ImagePreviewSurfaceTarget
import com.amazonaws.ivs.broadcast.ImageStageStream
import com.amazonaws.ivs.broadcast.LocalStageStream
import com.amazonaws.ivs.broadcast.ParticipantInfo
import com.amazonaws.ivs.broadcast.QualityStats
import com.amazonaws.ivs.broadcast.RemoteStageStream
import com.amazonaws.ivs.broadcast.Stage
import com.amazonaws.ivs.broadcast.StageAudioConfiguration
import com.amazonaws.ivs.broadcast.StageAudioManager
import com.amazonaws.ivs.broadcast.StageRenderer
import com.amazonaws.ivs.broadcast.StageStream
import com.amazonaws.ivs.broadcast.StageStream.Type
import com.amazonaws.ivs.broadcast.StageVideoConfiguration
import com.amazonaws.ivs.broadcast.JitterBufferConfiguration
import com.amazonaws.ivs.broadcast.SubscribeConfiguration
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter
import com.blyp.mobile.BuildConfig

private const val IVS_TAG = "IVS_NATIVE"
private const val IVS_HOST_NATIVE_TAG = "IVS_HOST_NATIVE"
private const val NETRX_INTERVAL_MS = 1000L

// IVS_DNS_NOTE: Previously constructed endpoint as "rtmps://$region.contribute.live-video.net/app", 
// which produced invalid host "us-east-1.contribute.live-video.net" and DNS failures.
// Fixed by using stageArn + token directly (stage join, not channel ingest).

class IVSBroadcastModule(
    private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val loudspeakerController = LiveLoudspeakerController(reactContext, IVS_TAG)
    private enum class SessionMode { NONE, HOST, VIEWER, GUEST }
    private enum class RenderOwner { NONE, HOST_PREVIEW, VIEWER_REMOTE }

    private data class RenderSurfaceConfig(
        val surface: Surface?,
        val width: Int,
        val height: Int,
    )

    private data class RenderSlot(
        val slotId: Int,
        val streamKey: String,
        val participantId: String,
        val previewTarget: ImagePreviewSurfaceTarget,
        var surface: Surface? = null,
        var width: Int = 0,
        var height: Int = 0,
    )

    // UI supports 16 remote slots (2 pages of 8). Slot 1 is reserved by the JS UX.
    private val MAX_REMOTE_VIDEO_STREAMS = 16

    // Optional guest UX metadata (used for JS UI slot hints)
    private var guestSlotIndex: Int? = null

    private var stage: Stage? = null
    private var deviceDiscovery: DeviceDiscovery? = null
    private var currentCamera: Device? = null
    private var currentMic: Device? = null
    private var localVideoStream: ImageLocalStageStream? = null
    private var localAudioStream: AudioLocalStageStream? = null
    private var stageStrategy: Stage.Strategy? = null
    private var currentSessionId: String? = null
    private var currentViewerToken: String? = null
    private var lastStageConnectionState: Stage.ConnectionState? = null
    private var viewerReachedStableConnection: Boolean = false
    private var lastViewerAudioReassertMs: Long = 0L
    private var sessionMode: SessionMode = SessionMode.NONE
    private var renderOwner: RenderOwner = RenderOwner.NONE
    private var hostRenderSurface: RenderSurfaceConfig? = null
    private var viewerParticipantId: String? = null
    private val hostPreviewTargets: MutableMap<String, ImagePreviewSurfaceTarget> = mutableMapOf()
    private val hostPreviewTargetStreamTypes: MutableMap<String, String> = mutableMapOf()
    private val slotSurfaces: MutableMap<Int, RenderSurfaceConfig> = mutableMapOf()
    private val remoteRenderSlots: MutableMap<Int, RenderSlot> = mutableMapOf()
    private val lastSlotAttachSig: MutableMap<Int, String> = mutableMapOf()
    private val participantToSlot: MutableMap<String, Int> = mutableMapOf()
    private val slotToStreamKey: MutableMap<Int, String> = mutableMapOf()
    private val firstFrameSignalKeys: MutableSet<String> = mutableSetOf()
    private val remoteVideoFlowKeys: MutableSet<String> = mutableSetOf()
    private var hostStartAssertion: Runnable? = null

    // While true, never attach the host SurfaceTexture to a preview target.
    // Fold freezes when we rebind a stale SurfaceTexture during camera open
    // (EGL_BAD_NATIVE_WINDOW / Failed to create input surface).
    private var cameraSwitchParked: Boolean = false
    private var pendingCameraSwitchCallback: Callback? = null
    private var pendingCameraSwitchOpen: Runnable? = null
    private var pendingCameraSwitchSettle: Runnable? = null

    private val netRxLock = Any()
    private var netRxTicker: Runnable? = null
    private var netRxLastRxBytes: Long = -1L
    private var netRxLastTxBytes: Long = -1L
    private var netRxRole: String = "unknown"
    private var netRxSlot: Int = -1
    private var netRxTicks: Int = 0
    private var netRxConsecutiveZero: Int = 0
    private var netRxStalled: Boolean = false
    private var netRxExpected: Boolean = false
    private var netRxAccumBytes: Long = 0L
    private var netTxAccumBytes: Long = 0L

    init {
        reactContext.addLifecycleEventListener(this)
        setInstance(this)
    }

    override fun getName(): String = "IVSBroadcastModule"

    @ReactMethod
    fun addListener(eventName: String) {
        Log.d(IVS_TAG, "[NATIVE] addListener called for event: $eventName")
        // Required for React Native NativeEventEmitter.
        // We already use RCTDeviceEventEmitter to send events to JS; this is a no-op hook for JS subscriptions.
    }

    @ReactMethod
    fun testBridge(callback: Callback) {
        Log.d(IVS_TAG, "[NATIVE] **TEST BRIDGE METHOD CALLED**")
        callback.invoke(null, "Bridge works!")
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for React Native NativeEventEmitter.
        // No-op: JS manages the actual subscription bookkeeping.
    }

    override fun onHostResume() {
        loudspeakerController.forceActive("host-resume")
    }

    override fun onHostPause() {
        // Intentionally do not stop CI proof ticker on pause.
        // The harness run expects deterministic ticks during a fixed wall-clock window,
        // and surface/background churn during startup should not mechanically truncate the counter.
    }

    override fun onHostDestroy() {
        // Ensure we fully tear down the broadcast session and cleanup resources.
        stopNetRxDeltaProof("module_destroy")
        stopSession()
        sessionMode = SessionMode.HOST
        firstFrameSignalKeys.clear()
        remoteVideoFlowKeys.clear()
        viewerParticipantId = null
        guestSlotIndex = null
    }

    private fun sessionRoleForProof(): String = when (sessionMode) {
        SessionMode.VIEWER -> "viewer"
        SessionMode.HOST -> "host"
        SessionMode.GUEST -> "guest"
        SessionMode.NONE -> "none"
    }

    private fun startNetRxDeltaProofIfNeeded(role: String, slot: Int, reason: String) {
        synchronized(netRxLock) {
            if (netRxTicker != null) return

            netRxRole = role
            netRxSlot = slot
            netRxTicks = 0
            netRxConsecutiveZero = 0
            netRxStalled = false
            netRxExpected = true
            netRxAccumBytes = 0L
            netTxAccumBytes = 0L
            val uid = Process.myUid()
            val initialRx = TrafficStats.getUidRxBytes(uid)
            val initialTx = TrafficStats.getUidTxBytes(uid)
            netRxLastRxBytes = if (initialRx >= 0) initialRx else 0L
            netRxLastTxBytes = if (initialTx >= 0) initialTx else 0L

            val tick = object : Runnable {
                override fun run() {
                    val uidNow = Process.myUid()
                    val nowRx = TrafficStats.getUidRxBytes(uidNow)
                    val nowTx = TrafficStats.getUidTxBytes(uidNow)
                    if (nowRx < 0 || nowTx < 0) {
                        mainHandler.postDelayed(this, NETRX_INTERVAL_MS)
                        return
                    }

                    val prevRx = netRxLastRxBytes
                    val prevTx = netRxLastTxBytes
                    val deltaRx = if (prevRx >= 0) (nowRx - prevRx) else 0L
                    val deltaTx = if (prevTx >= 0) (nowTx - prevTx) else 0L
                    netRxLastRxBytes = nowRx
                    netRxLastTxBytes = nowTx
                    netRxTicks += 1
                    if (deltaRx > 0L) netRxAccumBytes += deltaRx
                    if (deltaTx > 0L) netTxAccumBytes += deltaTx

                    if (netRxExpected) {
                        if (deltaRx <= 0L) netRxConsecutiveZero += 1 else netRxConsecutiveZero = 0
                        if (!netRxStalled && netRxConsecutiveZero > 5) {
                            netRxStalled = true
                            Log.w(
                                "IVS_PROOF",
                                "[IVS_PROOF][netRxStall] role=$netRxRole slot=$netRxSlot tick=$netRxTicks consecutiveZeroTicks=$netRxConsecutiveZero totalBytes=$netRxAccumBytes txTotalBytes=$netTxAccumBytes"
                            )
                        }
                    }

                    // Deterministic CI proof: traffic should be non-zero during active remote video windows.
                    if (BuildConfig.DEBUG) {
                        Log.i(
                            "IVS_PROOF",
                            "[IVS_PROOF][netRxTick] role=$netRxRole slot=$netRxSlot tick=$netRxTicks deltaBytes=$deltaRx totalBytes=$netRxAccumBytes txDeltaBytes=$deltaTx txTotalBytes=$netTxAccumBytes"
                        )
                    }

                    mainHandler.postDelayed(this, NETRX_INTERVAL_MS)
                }
            }

            netRxTicker = tick
            if (BuildConfig.DEBUG) {
                Log.i(
                    "IVS_PROOF",
                    "[IVS_PROOF][netRxStart] intervalMs=$NETRX_INTERVAL_MS role=$netRxRole slot=$netRxSlot reason=$reason startRxBytes=$netRxLastRxBytes startTxBytes=$netRxLastTxBytes"
                )
            }
            mainHandler.postDelayed(tick, NETRX_INTERVAL_MS)
        }
    }

    private fun stopNetRxDeltaProof(reason: String) {
        val tickerToStop: Runnable?
        val roleAtStop: String
        val slotAtStop: Int
        val ticksAtStop: Int
        val rxAtStop: Long
        val txAtStop: Long
        val stalledAtStop: Boolean
        synchronized(netRxLock) {
            tickerToStop = netRxTicker
            roleAtStop = netRxRole
            slotAtStop = netRxSlot
            ticksAtStop = netRxTicks
            rxAtStop = netRxAccumBytes
            txAtStop = netTxAccumBytes
            stalledAtStop = netRxStalled
            netRxTicker = null
            netRxLastRxBytes = -1L
            netRxLastTxBytes = -1L
            netRxRole = "unknown"
            netRxSlot = -1
            netRxTicks = 0
            netRxConsecutiveZero = 0
            netRxStalled = false
            netRxExpected = false
            netRxAccumBytes = 0L
            netTxAccumBytes = 0L
        }
        if (tickerToStop != null) {
            mainHandler.removeCallbacks(tickerToStop)
            if (BuildConfig.DEBUG) {
                Log.i(
                    "IVS_PROOF",
                    "[IVS_PROOF][netRxStop] role=$roleAtStop slot=$slotAtStop reason=$reason ticks=$ticksAtStop totalBytes=$rxAtStop txTotalBytes=$txAtStop stalled=$stalledAtStop"
                )
            }
        }
    }

    @ReactMethod
    fun startHostSession(
        stageArn: String,
        token: String,
        sessionId: String,
        callback: Callback
    ) {
        Log.i(IVS_HOST_NATIVE_TAG, "START_HOST_SESSION_ENTERED")
        hostStartAssertion?.let { mainHandler.removeCallbacks(it) }
        hostStartAssertion = null
        val cameraPosition = "front" // Default to front camera
        Log.d(IVS_TAG, "[NATIVE] startHostSession called: stageArn=$stageArn, tokenLength=${token.length}, sessionId=$sessionId, cameraPosition=$cameraPosition")
        mainHandler.post {
            try {
                // Validate inputs
                if (stageArn.isEmpty()) {
                    throw IllegalArgumentException("stageArn cannot be empty")
                }
                if (token.isEmpty()) {
                    throw IllegalArgumentException("token cannot be empty")
                }
                if (sessionId.isEmpty()) {
                    throw IllegalArgumentException("sessionId cannot be empty")
                }
                
                Log.d(IVS_TAG, "[NATIVE] Input validation passed")
                startSession(stageArn, token, sessionId, cameraPosition)
                Log.d(IVS_TAG, "[NATIVE] startSession completed successfully")
                                Log.i(IVS_HOST_NATIVE_TAG, "START_HOST_SESSION_EXIT_SUCCESS")
                callback.invoke()
            } catch (e: Exception) {
                                Log.i(IVS_HOST_NATIVE_TAG, "START_HOST_SESSION_ERROR: ${e.message}")
                Log.e(IVS_TAG, "[NATIVE] startSession failed with exception: ${e.message}", e)
                Log.e(IVS_TAG, "[NATIVE] Exception class: ${e::class.simpleName}")
                Log.e(IVS_TAG, "[NATIVE] Full stack trace:", e)
                try {
                    callback.invoke(errorMap("START_SESSION_FAILED", e.message ?: "Failed to start session"))
                } catch (callbackError: Exception) {
                    Log.e(IVS_TAG, "[NATIVE] CALLBACK_INVOKE_FAILED: ${callbackError.message}", callbackError)
                    // Try once more with simpler error
                    try {
                        callback.invoke(errorMap("START_SESSION_FAILED", "Exception during start"))
                    } catch (e2: Exception) {
                        Log.e(IVS_TAG, "[NATIVE] CALLBACK_INVOKE_FAILED_AGAIN: ${e2.message}", e2)
                    }
                }
            }
        }
    }

    @ReactMethod
    fun armHostStartAssertion(timeoutMs: Int = 3000) {
        val safeTimeout = timeoutMs.coerceAtLeast(1).toLong()
        hostStartAssertion?.let { mainHandler.removeCallbacks(it) }
        val runnable = Runnable {
            Log.i(IVS_HOST_NATIVE_TAG, "IVS HOST NATIVE NEVER CALLED")
            throw RuntimeException("IVS HOST NATIVE NEVER CALLED")
        }
        hostStartAssertion = runnable
        Log.i(IVS_HOST_NATIVE_TAG, "ARM_HOST_START_ASSERTION timeoutMs=$safeTimeout")
        mainHandler.postDelayed(runnable, safeTimeout)
    }

    @ReactMethod
    fun stopHostSession(callback: Callback) {
        mainHandler.post {
            try {
                stopNetRxDeltaProof("stopHostSession")
                stopSession()
                callback.invoke()
            } catch (e: Exception) {
                callback.invoke(errorMap("HOST_STOP_FAILED", e.message ?: "Failed to stop host session"))
            }
        }
    }

    @ReactMethod
    fun startGuestSession(
        stageArn: String,
        token: String,
        sessionId: String,
        slotIndex: Int,
        callback: Callback
    ) {
        val cameraPosition = "front" // Default to front camera
        Log.d(
            IVS_TAG,
            "[NATIVE] startGuestSession called: stageArn=$stageArn, tokenLength=${token.length}, sessionId=$sessionId, slotIndex=$slotIndex"
        )
        mainHandler.post {
            try {
                if (stageArn.isEmpty()) {
                    throw IllegalArgumentException("stageArn cannot be empty")
                }
                if (token.isEmpty()) {
                    throw IllegalArgumentException("token cannot be empty")
                }
                if (sessionId.isEmpty()) {
                    throw IllegalArgumentException("sessionId cannot be empty")
                }

                guestSlotIndex = slotIndex
                startGuestPublishingSession(stageArn, token, sessionId, cameraPosition)
                callback.invoke()
            } catch (e: Exception) {
                Log.e(IVS_TAG, "[NATIVE][GUEST] startGuestSession failed: ${e.message}", e)
                try {
                    callback.invoke(errorMap("GUEST_START_FAILED", e.message ?: "Failed to start guest session"))
                } catch (_: Exception) {
                    // ignore
                }
            }
        }
    }

    @ReactMethod
    fun stopGuestSession(callback: Callback) {
        guestSlotIndex = null
        stopHostSession(callback)
    }

    /**
     * Join as a read-only viewer on an IVS Real-Time stage.
     * Viewers can see and hear all participants but cannot publish audio/video.
     * This is the proper way to implement viewer mode for IVS Real-Time.
     */
    @ReactMethod
    fun joinAsViewerReadOnly(
        stageArn: String,
        token: String,
        sessionId: String,
        callback: Callback
    ) {
        Log.d(IVS_TAG, "[VIEWER] joinAsViewerReadOnly called: stageArn=$stageArn, sessionId=$sessionId")
        mainHandler.post {
            try {
                startViewerSession(stageArn, token, sessionId)
                Log.d(IVS_TAG, "[VIEWER] startViewerSession completed successfully")
                callback.invoke()
            } catch (e: Exception) {
                Log.e(IVS_TAG, "[VIEWER] startViewerSession failed with exception: ${e.message}", e)
                callback.invoke(errorMap("VIEWER_JOIN_FAILED", e.message ?: "Failed to join as viewer"))
            }
        }
    }

    /**
     * Leave viewer session (alias for stopHostSession since they use the same stage cleanup)
     */
    @ReactMethod
    fun leaveAsViewerReadOnly(callback: Callback) {
        Log.d(IVS_TAG, "[VIEWER] leaveAsViewerReadOnly called")
        stopHostSession(callback)
    }

    @ReactMethod
    fun setMicEnabled(enabled: Boolean, callback: Callback) {
        mainHandler.post {
            val audioStream = localAudioStream
            val activeStage = stage
            if (activeStage == null || audioStream == null) {
                callback.invoke(errorMap("SESSION_NOT_ACTIVE", "No active session"))
                return@post
            }
            try {
                audioStream.setMuted(!enabled)
                loudspeakerController.forceActive("mic-state-changed")
                callback.invoke()
            } catch (e: Exception) {
                callback.invoke(errorMap("MIC_SET_FAILED", e.message ?: "Failed to update mic state"))
            }
        }
    }

    @ReactMethod
    fun setCameraEnabled(enabled: Boolean, callback: Callback) {
        mainHandler.post {
            val videoStream = localVideoStream
            val activeStage = stage
            if (activeStage == null || videoStream == null) {
                callback.invoke(errorMap("SESSION_NOT_ACTIVE", "No active session"))
                return@post
            }
            try {
                videoStream.setMuted(!enabled)
                callback.invoke()
            } catch (e: Exception) {
                callback.invoke(errorMap("CAMERA_SET_FAILED", e.message ?: "Failed to update camera state"))
            }
        }
    }

    @ReactMethod
    fun switchCamera(callback: Callback) {
        mainHandler.post {
            val activeStage = stage
            if (activeStage == null) {
                callback.invoke(errorMap("SESSION_NOT_ACTIVE", "No active session"))
                return@post
            }
            if (cameraSwitchParked || pendingCameraSwitchCallback != null) {
                callback.invoke(errorMap("CAMERA_SWITCH_IN_PROGRESS", "Camera switch already in progress"))
                return@post
            }

            // Foldables expose many CAMERA devices (cover/UW/tele). Prefer true
            // facing cameras only so flip is front↔back, not a frozen aux lens.
            val allCameras = listCameras()
            val facingCameras = allCameras.filter {
                val p = it.descriptor.position
                p == Descriptor.Position.FRONT || p == Descriptor.Position.BACK
            }
            val cameras = if (facingCameras.isNotEmpty()) facingCameras else allCameras
            if (cameras.isEmpty()) {
                callback.invoke(errorMap("CAMERA_SWITCH_FAILED", "No cameras available"))
                return@post
            }

            cameras.forEach { cam ->
                Log.i(
                    IVS_TAG,
                    "[CAMERA] candidate position=${cam.descriptor.position} id=${cam.descriptor.deviceId}"
                )
            }

            val next = pickNextCamera(cameras)
            if (next == null) {
                callback.invoke(errorMap("CAMERA_SWITCH_FAILED", "No alternate camera found"))
                return@post
            }
            if (next.descriptor.deviceId != null &&
                next.descriptor.deviceId == currentCamera?.descriptor?.deviceId
            ) {
                callback.invoke(errorMap("CAMERA_SWITCH_FAILED", "No alternate camera found"))
                return@post
            }

            try {
                Log.i(
                    IVS_TAG,
                    "[CAMERA] switch begin from=${currentCamera?.descriptor?.position}/${currentCamera?.descriptor?.deviceId} " +
                        "to=${next.descriptor.position}/${next.descriptor.deviceId} facingCandidates=${facingCameras.size} all=${allCameras.size}"
                )

                // Cancel any prior delayed switch work.
                pendingCameraSwitchOpen?.let { mainHandler.removeCallbacks(it) }
                pendingCameraSwitchSettle?.let { mainHandler.removeCallbacks(it) }
                pendingCameraSwitchOpen = null
                pendingCameraSwitchSettle = null
                pendingCameraSwitchCallback = callback

                // Park preview attaches for the whole switch. Rebinding the live
                // SurfaceTexture while Camera2 opens is what produces
                // EGL_BAD_NATIVE_WINDOW + Failed to create input surface on Fold.
                cameraSwitchParked = true
                try {
                    clearHostPreviewTargets()
                } catch (e: Exception) {
                    Log.w(IVS_TAG, "[CAMERA] clearHostPreviewTargets failed: ${e.message}")
                }
                try {
                    hostPreviewTargets.values.forEach { target ->
                        try {
                            target.clearSurface()
                        } catch (_: Exception) {
                            // ignore
                        }
                    }
                } catch (_: Exception) {
                    // ignore
                }

                val previous = localVideoStream
                try {
                    previous?.setListener(null)
                } catch (_: Exception) {
                    // ignore
                }
                localVideoStream = null
                val previousCamera = currentCamera
                currentCamera = null
                try {
                    activeStage.refreshStrategy()
                } catch (e: Exception) {
                    Log.w(IVS_TAG, "[CAMERA] refreshStrategy(unpublish) failed: ${e.message}")
                }

                val sid = currentSessionId
                val nextCam = next

                // Phase 2: wait for previous HAL close, then open opposite camera
                // WITHOUT attaching any preview surface yet.
                val openRunnable = Runnable {
                    pendingCameraSwitchOpen = null
                    try {
                        currentCamera = nextCam
                        localVideoStream = ImageLocalStageStream(nextCam, buildSafeStageVideoConfiguration())
                        localVideoStream?.setListener(stageStreamListener)
                        activeStage.refreshStrategy()
                        // Register the preview *target* only — attach is gated by cameraSwitchParked.
                        if (!sid.isNullOrEmpty()) {
                            try {
                                registerLocalPreviewTarget(sid)
                            } catch (e: Exception) {
                                Log.w(IVS_TAG, "[CAMERA] registerLocalPreviewTarget (parked) failed: ${e.message}")
                            }
                        }

                        // Phase 3: let CameraSource reach OPEN before unparking.
                        // JS should remount the TextureView after this callback so a
                        // fresh SurfaceTexture attaches (stale one hits EGL_BAD_NATIVE_WINDOW).
                        val settleRunnable = Runnable {
                            pendingCameraSwitchSettle = null
                            try {
                                // Unpark only — do not reattach the stale SurfaceTexture.
                                // JS remounts the TextureView after this callback.
                                cameraSwitchParked = false
                                Log.i(
                                    IVS_TAG,
                                    "[CAMERA] switched to position=${nextCam.descriptor.position} id=${nextCam.descriptor.deviceId} " +
                                        "(was ${previousCamera?.descriptor?.position}/${previousCamera?.descriptor?.deviceId}) remount_recommended=true"
                                )
                                val cb = pendingCameraSwitchCallback
                                pendingCameraSwitchCallback = null
                                cb?.invoke()
                            } catch (e: Exception) {
                                Log.e(IVS_TAG, "[CAMERA] switch settle failed", e)
                                cameraSwitchParked = false
                                val cb = pendingCameraSwitchCallback
                                pendingCameraSwitchCallback = null
                                cb?.invoke(errorMap("CAMERA_SWITCH_FAILED", e.message ?: "Failed to settle camera switch"))
                            }
                        }
                        pendingCameraSwitchSettle = settleRunnable
                        // Camera reaches OPEN ~80–150ms after attach on Fold; keep a short
                        // buffer without the previous ~2s blackout.
                        mainHandler.postDelayed(settleRunnable, 350)
                    } catch (e: Exception) {
                        Log.e(IVS_TAG, "[CAMERA] switch open failed", e)
                        cameraSwitchParked = false
                        try {
                            if (previousCamera != null && localVideoStream == null) {
                                currentCamera = previousCamera
                                localVideoStream = ImageLocalStageStream(previousCamera, buildSafeStageVideoConfiguration())
                                localVideoStream?.setListener(stageStreamListener)
                                activeStage.refreshStrategy()
                                if (!sid.isNullOrEmpty()) registerLocalPreviewTarget(sid)
                            }
                        } catch (_: Exception) {
                            // ignore restore failure
                        }
                        val cb = pendingCameraSwitchCallback
                        pendingCameraSwitchCallback = null
                        cb?.invoke(errorMap("CAMERA_SWITCH_FAILED", e.message ?: "Failed to switch camera"))
                    }
                }
                pendingCameraSwitchOpen = openRunnable
                // HAL close was ~500–600ms in Fold logs; 700ms is enough with park+remount.
                mainHandler.postDelayed(openRunnable, 700)
            } catch (e: Exception) {
                Log.e(IVS_TAG, "[CAMERA] switch failed", e)
                cameraSwitchParked = false
                pendingCameraSwitchCallback = null
                callback.invoke(errorMap("CAMERA_SWITCH_FAILED", e.message ?: "Failed to switch camera"))
            }
        }
    }

    @ReactMethod
    fun forceReattach(reason: String, callback: Callback) {
        mainHandler.post {
            try {
                val r = "force:$reason"
                reattachHostPreviewSurfaceIfReady(r)
                configureStageForRendering(r)
                reattachViewerSurfaces(r)
                loudspeakerController.forceActive("render-reattach:$reason")
                callback.invoke()
            } catch (e: Exception) {
                callback.invoke(errorMap("FORCE_REATTACH_FAILED", e.message ?: "Failed to force reattach"))
            }
        }
    }

    /**
     * Explicit JS/native escape hatch used after connect, publish, participant join, and
     * any JS audio-mode churn. The native watchdog continues enforcing the route after
     * this callback returns.
     */
    @ReactMethod
    fun forceLiveLoudspeaker(reason: String, callback: Callback) {
        mainHandler.post {
            try {
                val profile = when (sessionMode) {
                    SessionMode.HOST, SessionMode.GUEST ->
                        LiveLoudspeakerController.Profile.PUBLISHING
                    SessionMode.VIEWER, SessionMode.NONE ->
                        LiveLoudspeakerController.Profile.PLAYBACK
                }
                loudspeakerController.force(profile, "js:$reason")
                callback.invoke()
            } catch (e: Exception) {
                callback.invoke(
                    errorMap(
                        "FORCE_LOUDSPEAKER_FAILED",
                        e.message ?: "Failed to force live loudspeaker",
                    )
                )
            }
        }
    }

    private fun startSession(stageArn: String, token: String, sessionId: String, cameraPosition: String?) {
        Log.d(IVS_TAG, "[NATIVE] startSession() called with stageArn=$stageArn, sessionId=$sessionId, cameraPosition=$cameraPosition")
        
        // CRITICAL FIX: Always destroy any previous session first
        // This prevents "token exchange" errors from trying to reuse/update existing session
        stopSession()
        configureStageAudio(publishing = true, role = "host")

        sessionMode = SessionMode.HOST
        loudspeakerController.start(
            LiveLoudspeakerController.Profile.PUBLISHING,
            "host-before-device-discovery",
        )
        renderOwner = RenderOwner.HOST_PREVIEW
        Log.d(IVS_TAG, "[IVS_RENDER][HOST] sessionMode=HOST set, renderOwner=HOST_PREVIEW (startSession)")

        val context = reactApplicationContext
        deviceDiscovery = deviceDiscovery ?: DeviceDiscovery(context)
        currentSessionId = sessionId
        Log.d(IVS_TAG, "[NATIVE_DEBUG] Set currentSessionId=$currentSessionId")

        selectDefaultDevices(cameraPosition)
        Log.d(IVS_TAG, "[NATIVE_DEBUG] Selected devices: camera=$currentCamera, mic=$currentMic")
        rebuildLocalStreams()
        Log.d(IVS_TAG, "[NATIVE_DEBUG] Local streams rebuilt: videoStream=$localVideoStream, audioStream=$localAudioStream")

        // Ensure the host sees their own camera preview.
        registerLocalPreviewTarget(sessionId)

        val strategy = buildStageStrategy()
        stageStrategy = strategy
        Log.d(IVS_TAG, "[NATIVE_DEBUG] Stage strategy built")

        // Create a brand new Stage instance for this session
        val stageInstance = Stage(context, token, strategy)
        Log.d(IVS_TAG, "[NATIVE_DEBUG] Stage instance created, renderer will be added")
        try {
            stageInstance.addRenderer(stageRenderer)
            Log.d(IVS_TAG, "[NATIVE_DEBUG] Renderer added to stage")
            
            // CRITICAL: join() takes no parameters - token is passed to Stage constructor
            // Do NOT use exchangeToken() which is for updating existing sessions
            // Each startSession should be a clean, new Stage with fresh token
            Log.i(IVS_HOST_NATIVE_TAG, "STAGE_JOIN_CALL")
            Log.d(IVS_TAG, "[NATIVE_DEBUG] About to call stage.join()...")
            stageInstance.join()
            Log.i(IVS_HOST_NATIVE_TAG, "STAGE_JOIN_RETURNED")
            Log.d(IVS_TAG, "[NATIVE_DEBUG] stage.join() returned without exception")
            loudspeakerController.forceActive("host-stage-join-returned")
            
            stage = stageInstance
            Log.d(IVS_TAG, "[NATIVE] Stage joined successfully with new token")

            // Attach the host render surface if it was set before join
            configureStageForRendering("host-joined-stage")
            
            // SAFETY: Emit localJoined event here in case the renderer callback is delayed or doesn't fire
            // This ensures the JS side knows we're joined even if the renderer callback hasn't fired yet
            Log.d(IVS_TAG, "[NATIVE_DEBUG] Emitting IVS_HOST_LOCAL_JOINED from startSession (safety emit)")
            emit("IVS_HOST_LOCAL_JOINED", Arguments.createMap().apply {
                putString("participantId", sessionId)
                putString("sessionId", sessionId)
                putString("role", "host")
            })
        } catch (e: Exception) {
            Log.e(IVS_TAG, "[NATIVE] Failed to join stage: ${e.message}", e)
            try {
                stageInstance.release()
            } catch (_: Exception) {
                // ignore release failure during error path
            }
            throw e
        }
    }

    /**
     * Guest publishing session:
     * - Publishes local audio/video (like host)
     * - Still renders remote participants using per-slot surfaces (like viewer)
     */
    private fun startGuestPublishingSession(stageArn: String, token: String, sessionId: String, cameraPosition: String?) {
        Log.d(IVS_TAG, "[GUEST] startGuestPublishingSession() stageArn=$stageArn sessionId=$sessionId")

        stopSession()
        configureStageAudio(publishing = true, role = "guest")

        sessionMode = SessionMode.GUEST
        loudspeakerController.start(
            LiveLoudspeakerController.Profile.PUBLISHING,
            "guest-before-device-discovery",
        )
        // Keep HOST_PREVIEW render owner so local preview can still bind via IVSBroadcastView,
        // while remote rendering uses per-slot surfaces.
        renderOwner = RenderOwner.HOST_PREVIEW
        firstFrameSignalKeys.clear()

        val context = reactApplicationContext
        deviceDiscovery = deviceDiscovery ?: DeviceDiscovery(context)
        currentSessionId = sessionId

        selectDefaultDevices(cameraPosition)
        rebuildLocalStreams()
        registerLocalPreviewTarget(sessionId)

        val strategy = buildStageStrategy()
        stageStrategy = strategy

        val stageInstance = Stage(context, token, strategy)
        try {
            stageInstance.addRenderer(stageRenderer)
            stageInstance.join()
            loudspeakerController.forceActive("guest-stage-join-returned")
            stage = stageInstance
            Log.d(IVS_TAG, "[GUEST] Guest stage joined successfully")

            // Host preview surface may already exist; slot surfaces will be provided by IVSRealTimeView.
            configureStageForRendering("guest-joined-stage")
            reattachViewerSurfaces("guest-joined-stage")

            // Safety emit for JS state machines
            emit("IVS_HOST_LOCAL_JOINED", Arguments.createMap().apply {
                putString("participantId", sessionId)
                putString("sessionId", sessionId)
                putString("role", "guest")
                guestSlotIndex?.let { putInt("slotIndex", it) }
            })
        } catch (e: Exception) {
            Log.e(IVS_TAG, "[GUEST] Failed to join guest stage: ${e.message}", e)
            try {
                stageInstance.release()
            } catch (_: Exception) {
                // ignore
            }
            throw e
        }
    }

    private fun stopSession() {
        bumpViewerRenderGeneration()
        lastSlotAttachSig.clear()
        loudspeakerController.stop("stage-session-stop")
        pendingCameraSwitchOpen?.let { mainHandler.removeCallbacks(it) }
        pendingCameraSwitchSettle?.let { mainHandler.removeCallbacks(it) }
        pendingCameraSwitchOpen = null
        pendingCameraSwitchSettle = null
        pendingCameraSwitchCallback = null
        cameraSwitchParked = false
        try {
            stage?.leave()
        } catch (_: Exception) {
            // swallow
        }
        try {
            stage?.release()
        } catch (_: Exception) {
            // swallow
        }
        stage = null
        stageStrategy = null
        localVideoStream = null
        localAudioStream = null
        currentSessionId = null
        currentViewerToken = null
        lastStageConnectionState = null
        viewerReachedStableConnection = false
        sessionMode = SessionMode.NONE
        viewerParticipantId = null
        firstFrameSignalKeys.clear()
        remoteVideoFlowKeys.clear()
        renderOwner = RenderOwner.NONE
        Log.d(IVS_TAG, "[IVS_RENDER] renderOwner reset to NONE before clearing preview targets")
        clearHostPreviewTargets()
        clearRemoteRenderSlots()
        participantToSlot.clear()
        slotToStreamKey.clear()
        slotSurfaces.clear()
        deviceDiscovery?.release()
        deviceDiscovery = null
        guestSlotIndex = null
        configureStageAudio(publishing = false, role = "idle")
    }

    /**
     * StageAudioManager must be configured before creating DeviceDiscovery or Stage.
     *
     * Publishers (host/guest) use VIDEO_CHAT so Stage playback attributes are
     * USAGE_VOICE_COMMUNICATION. That binds the hardware volume rocker to Call /
     * voice-call volume — required for AEC gain alignment. A prior MEDIA usage
     * hybrid left Fold OEMs on the Media slider while MODE_IN_COMMUNICATION +
     * speakerphone played on the call path (reverb/screech).
     *
     * StageAudioManager's attributes do not select a physical output device. Disable its
     * AudioManager-mode ownership while active, then let LiveLoudspeakerController own
     * MODE_IN_COMMUNICATION + the built-in speaker for publishers (MODE_NORMAL +
     * SUBSCRIBE_ONLY / media volume for viewers).
     */
    private fun configureStageAudio(publishing: Boolean, role: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            Log.w(
                IVS_TAG,
                "[IVS_AUDIO_ROUTE] StageAudioManager requires API 28; keeping SDK routing role=$role"
            )
            return
        }

        try {
            val audioManager = StageAudioManager.getInstance(reactApplicationContext)
            val isIdle = role == "idle"
            // If left enabled, IVS can re-apply MODE_IN_COMMUNICATION after join/publish
            // and silently select the receiver again. Active sessions own mode explicitly.
            audioManager.setAudioModeManagementEnabled(isIdle)

            if (publishing) {
                // Call-volume rocker + AEC/NS. Physical output is owned by
                // LiveLoudspeakerController (BT/wired preferred, else built-in speaker).
                audioManager.setPreset(StageAudioManager.UseCasePreset.VIDEO_CHAT)
                // Preset may follow a previous SUBSCRIBE_ONLY session, which disables AEC.
                // Explicitly restore AEC so speaker output does not feed the mic.
                audioManager.enableEchoCancellation(true)
            } else {
                audioManager.setPreset(StageAudioManager.UseCasePreset.SUBSCRIBE_ONLY)
            }

            Log.i(
                IVS_TAG,
                "[IVS_AUDIO_ROUTE] role=$role publishing=$publishing " +
                    "usage=${audioManager.usage} source=${audioManager.source} " +
                    "contentType=${audioManager.contentType} " +
                    "aec=${audioManager.isEchoCancellationEnabled} " +
                    "modeMgmt=${isIdle}",
            )
        } catch (e: Exception) {
            Log.e(
                IVS_TAG,
                "[IVS_AUDIO_ROUTE] Failed to configure stage audio role=$role: ${e.message}",
                e,
            )
        }
    }

    /**
     * Start a viewer-only session on an IVS Real-Time stage.
     * Unlike host/guest sessions, viewers:
     * - Do NOT publish any audio/video streams
     * - DO subscribe to all other participants' streams
     * - Can see and hear everything but remain silent/invisible
     */
    private fun startViewerSession(stageArn: String, token: String, sessionId: String) {
        Log.d(IVS_TAG, "[VIEWER] startViewerSession() called with stageArn=$stageArn, sessionId=$sessionId")

        val sameSession = sessionMode == SessionMode.VIEWER &&
            currentSessionId == sessionId &&
            stage != null
        val sameToken = currentViewerToken == token
        val stageLive = lastStageConnectionState == Stage.ConnectionState.CONNECTED ||
            lastStageConnectionState == Stage.ConnectionState.CONNECTING
        val stageDropped = lastStageConnectionState == Stage.ConnectionState.DISCONNECTED
        if (sameSession && sameToken && (stageLive || stageDropped)) {
            if (stageDropped) {
                try {
                    Log.i(IVS_TAG, "[VIEWER] rejoin existing Stage without destroy session=$sessionId")
                    stage?.join()
                } catch (e: Exception) {
                    Log.w(IVS_TAG, "[VIEWER] existing Stage rejoin failed; will recreate: ${e.message}")
                    stopSession()
                    // fall through to full create below after this block
                }
            }
            if (stage != null && sessionMode == SessionMode.VIEWER) {
                Log.d(
                    IVS_TAG,
                    "[VIEWER] skip destroy; already subscribed to this session state=$lastStageConnectionState",
                )
                emit("IVS_VIEWER_READONLY_JOINED", Arguments.createMap().apply {
                    putString("sessionId", sessionId)
                    putString("mode", "viewer")
                    putBoolean("skippedDestroy", true)
                })
                configureStageForRendering("viewer-rejoin-existing")
                reattachViewerSurfaces("viewer-rejoin-existing")
                return
            }
        }
        
        // Destroy previous stage when session/token actually changed or the
        // native connection is already dead. Same-token reconnects while still
        // CONNECTED / recoverable DISCONNECTED must not tear down TextureViews.
        stopSession()
        configureStageAudio(publishing = false, role = "viewer")

        sessionMode = SessionMode.VIEWER
        viewerReachedStableConnection = false
        loudspeakerController.start(
            LiveLoudspeakerController.Profile.PLAYBACK,
            "viewer-before-stage-create",
        )
        renderOwner = RenderOwner.VIEWER_REMOTE
        firstFrameSignalKeys.clear()

        val context = reactApplicationContext
        currentSessionId = sessionId

        // For viewers, we don't need to initialize local streams since we're not publishing
        // But we still need device discovery for potential future use
        deviceDiscovery = deviceDiscovery ?: DeviceDiscovery(context)

        // Build a read-only strategy for viewer mode
        val viewerStrategy = buildViewerStrategy()
        stageStrategy = viewerStrategy

        // Create a brand new Stage instance for viewer session
        val stageInstance = Stage(context, token, viewerStrategy)
        try {
            stageInstance.addRenderer(stageRenderer)
            
            // Join the stage as a read-only participant
            stageInstance.join()
            loudspeakerController.forceActive("viewer-stage-join-returned")
            
            stage = stageInstance
            currentViewerToken = token
            Log.d(IVS_TAG, "[VIEWER] Viewer stage joined successfully with new token")
            configureStageForRendering("viewer-joined-stage")
            reattachViewerSurfaces("viewer-joined-stage")
            
            // Emit viewer joined event
            emit("IVS_VIEWER_READONLY_JOINED", Arguments.createMap().apply {
                putString("sessionId", sessionId)
                putString("mode", "viewer")
            })
        } catch (e: Exception) {
            Log.e(IVS_TAG, "[VIEWER] Failed to join viewer stage: ${e.message}", e)
            try {
                stageInstance.release()
            } catch (_: Exception) {
                // ignore release failure during error path
            }
            throw e
        }
    }

    /**
     * Build a Stage strategy for read-only viewers.
     * Viewers never publish but subscribe to all other participants.
     */
    private fun buildViewerStrategy(): Stage.Strategy = object : Stage.Strategy {
        override fun stageStreamsToPublishForParticipant(stage: Stage, participantInfo: ParticipantInfo): List<LocalStageStream> {
            // Viewers never publish anything
            return emptyList()
        }

        override fun shouldPublishFromParticipant(stage: Stage, participantInfo: ParticipantInfo): Boolean {
            // Viewers never publish
            return false
        }

        override fun shouldSubscribeToParticipant(stage: Stage, participantInfo: ParticipantInfo): Stage.SubscribeType {
            // Subscribe to audio and video from all remote participants
            // Don't subscribe to local participant (viewer self) since they're not publishing
            return if (participantInfo.isLocal) Stage.SubscribeType.NONE else Stage.SubscribeType.AUDIO_VIDEO
        }

        override fun subscribeConfigrationForParticipant(stage: Stage, participantInfo: ParticipantInfo): SubscribeConfiguration {
            return viewerSubscribeConfiguration()
        }

    }

    /**
     * Web Studio publishes a single non-simulcast layer (~900kbps / 24fps).
     * Default SDK subscribe picks lowest simulcast layer then ramps (slideshow).
     * Do NOT set simulcast layer preference — there is only one layer. LOW jitter
     * keeps latency tight without waiting for layer adaptation.
     */
    private fun viewerSubscribeConfiguration(): SubscribeConfiguration {
        val config = SubscribeConfiguration()
        try {
            config.jitterBuffer.setMinDelay(JitterBufferConfiguration.JitterBufferDelay.LOW())
        } catch (e: Throwable) {
            Log.w(IVS_TAG, "[VIEWER] jitterBuffer LOW not set: ${e.message}")
        }
        return config
    }

    /** Re-pin media loudspeaker when viewer subscribe receives playable audio. */
    private fun reassertViewerPlaybackAudio(reason: String) {
        if (sessionMode != SessionMode.VIEWER) return
        val now = SystemClock.elapsedRealtime()
        if (now - lastViewerAudioReassertMs < 750L) return
        lastViewerAudioReassertMs = now
        loudspeakerController.force(LiveLoudspeakerController.Profile.PLAYBACK, reason)
    }

    private fun emitNetworkQuality(quality: QualityStats.NetworkQuality?, isLocal: Boolean) {
        val mapped = when (quality) {
            QualityStats.NetworkQuality.EXCELLENT -> "EXCELLENT"
            QualityStats.NetworkQuality.GOOD -> "GOOD"
            QualityStats.NetworkQuality.NORMAL -> "FAIR"
            QualityStats.NetworkQuality.POOR, QualityStats.NetworkQuality.DOWN -> "POOR"
            else -> "UNKNOWN"
        }
        emit("IVS_NETWORK_QUALITY_UPDATED", Arguments.createMap().apply {
            putString("quality", mapped)
            putBoolean("isLocal", isLocal)
        })
    }

    private fun listCameras(): List<Device> {
        val discovery = deviceDiscovery ?: return emptyList()
        return discovery.listLocalDevices().filter { it.descriptor.type == DeviceType.CAMERA }
    }

    private fun pickNextCamera(cameras: List<Device>): Device? {
        // Prefer true front/back toggle. Foldables expose many CAMERA devices
        // (ultra-wide, cover, etc.); picking "any other id" often freezes preview.
        val currentPos = currentCamera?.descriptor?.position
        val opposite = when (currentPos) {
            Descriptor.Position.FRONT -> Descriptor.Position.BACK
            Descriptor.Position.BACK -> Descriptor.Position.FRONT
            else -> null
        }
        if (opposite != null) {
            cameras.firstOrNull { it.descriptor.position == opposite }?.let { return it }
        }
        val currentId = currentCamera?.descriptor?.deviceId
        return cameras.firstOrNull { it.descriptor.deviceId != null && it.descriptor.deviceId != currentId }
            ?: cameras.firstOrNull()
    }

    private fun emit(event: String, params: WritableMap = Arguments.createMap()) {
        reactApplicationContext
            .getJSModule(RCTDeviceEventEmitter::class.java)
            .emit(event, params)
    }

    private fun errorMap(code: String, message: String): WritableMap =
        Arguments.createMap().apply {
            putString("code", code)
            putString("message", message)
        }

    private fun activeRenderSurface(): RenderSurfaceConfig? = when (renderOwner) {
        RenderOwner.HOST_PREVIEW -> hostRenderSurface
        RenderOwner.VIEWER_REMOTE -> null // viewer uses per-slot surfaces
        RenderOwner.NONE -> null
    }

    private fun surfaceHash(surface: Surface?): String = surface?.let {
        "0x${Integer.toHexString(System.identityHashCode(it))}"
    } ?: "null"

    private fun targetHash(target: Any?): String = target?.let {
        "0x${Integer.toHexString(System.identityHashCode(it))}"
    } ?: "null"

    // Some devices/SDK paths can crash if we clear a preview surface immediately while the
    // renderer thread is still consuming the underlying SurfaceTexture (e.g. during rapid
    // RN view remounts when switching VIEWER -> GUEST).
    // Debounce clearSurface() so quick re-attach can cancel the teardown.
    private val pendingSlotSurfaceClears: MutableMap<Int, Runnable> = mutableMapOf()
    private var pendingHostSurfaceClear: Runnable? = null

    private fun cancelPendingSlotClear(slotId: Int) {
        pendingSlotSurfaceClears.remove(slotId)?.let { runnable ->
            mainHandler.removeCallbacks(runnable)
        }
    }

    private fun scheduleSlotClearSurface(slotId: Int, slot: RenderSlot, reason: String) {
        cancelPendingSlotClear(slotId)
        val runnable = Runnable {
            // Only clear if we still have no surface staged for this slot.
            val stillMissing = slotSurfaces[slotId]?.surface == null
            if (!stillMissing) return@Runnable
            try {
                Log.i(
                    IVS_TAG,
                    "[IVS_SLOT][CLEAR_SURFACE_DEBOUNCED] slot=$slotId streamKey=${slot.streamKey} reason=$reason previewTargetHash=${targetHash(slot.previewTarget)}"
                )
                slot.previewTarget.clearSurface()
            } catch (_: Exception) {
                // ignore
            }
        }
        pendingSlotSurfaceClears[slotId] = runnable
        mainHandler.postDelayed(runnable, 350)
    }

    private fun clearSlotSurfaceImmediately(slotId: Int, reason: String) {
        cancelPendingSlotClear(slotId)
        slotSurfaces.remove(slotId)
        val slot = remoteRenderSlots[slotId]
        if (slot == null) {
            logBindingState("viewer-slot-$slotId-cleared-immediate")
            return
        }

        slot.surface = null
        slot.width = 0
        slot.height = 0

        // Clear immediately to avoid TextureView teardown crashes where the SurfaceTexture becomes
        // invalid while the IVS renderer thread is still running.
        mainHandler.post {
            try {
                Log.i(
                    IVS_TAG,
                    "[IVS_SLOT][CLEAR_SURFACE_IMMEDIATE] slot=$slotId streamKey=${slot.streamKey} reason=$reason previewTargetHash=${targetHash(slot.previewTarget)}"
                )
                slot.previewTarget.clearSurface()
            } catch (_: Exception) {
                // ignore
            }
        }
        logBindingState("viewer-slot-$slotId-cleared-immediate")
    }

    private fun cancelPendingHostClear() {
        pendingHostSurfaceClear?.let { runnable ->
            mainHandler.removeCallbacks(runnable)
        }
        pendingHostSurfaceClear = null
    }

    private fun scheduleHostClearSurfacesOnly(reason: String) {
        cancelPendingHostClear()
        val runnable = Runnable {
            // Only clear if we still have no host surface.
            if (hostRenderSurface?.surface != null) return@Runnable
            val targets = hostPreviewTargets.toMap()
            if (targets.isEmpty()) return@Runnable
            targets.forEach { (key, target) ->
                try {
                    Log.i(
                        IVS_TAG,
                        "[IVS_BIND][HOST][CLEAR_SURFACE_ONLY_DEBOUNCED] key=$key targetHash=${targetHash(target)} reason=$reason"
                    )
                    target.clearSurface()
                } catch (_: Exception) {
                    // ignore
                }
            }
        }
        pendingHostSurfaceClear = runnable
        mainHandler.postDelayed(runnable, 350)
    }

    private fun callerTrace(): String {
        val frames = Thread.currentThread().stackTrace
        return frames.drop(4).take(3).joinToString(" | ") { f -> "${f.className}.${f.methodName}:${f.lineNumber}" }
    }

    private fun logCallTrace(label: String, slot: Int? = null, surface: Surface? = null) {
        // Stack walks on the TextureView attach path stall the main thread.
        if (sessionMode == SessionMode.VIEWER &&
            (label == "setViewerSlotSurface" || label.startsWith("viewer-slot"))
        ) {
            return
        }
        val participant = slot?.let { remoteRenderSlots[it]?.participantId }
        Log.i(
            IVS_TAG,
            "[IVS_BIND][TRACE] call=$label mode=$sessionMode slot=${slot ?: "n/a"} participant=${participant ?: "n/a"} surfaceHash=${surfaceHash(surface)} caller=${callerTrace()}"
        )
    }

    private fun renderSurfaceSummary(config: RenderSurfaceConfig?): String = config?.let {
        "hash=${surfaceHash(it.surface)} size=${it.width}x${it.height}"
    } ?: "null"

    private fun logBindingState(reason: String) {
        val slotSummaries = if (slotSurfaces.isEmpty()) {
            "none"
        } else {
            slotSurfaces.entries.joinToString { entry ->
                val config = entry.value
                "slot=${entry.key} hash=${surfaceHash(config.surface)} size=${config.width}x${config.height}"
            }
        }
        Log.i(
            IVS_TAG,
            "[IVS_BIND][STATE] reason=$reason mode=$sessionMode owner=$renderOwner session=${currentSessionId ?: "null"} host=${renderSurfaceSummary(hostRenderSurface)} slotCount=${slotSurfaces.size} slots=[$slotSummaries] targets=${hostPreviewTargets.size}"
        )
    }

    private fun updateHostRenderSurface(surface: Surface?, width: Int, height: Int) {
        val hash = surfaceHash(surface)
        val ready = surface != null && surface.isValid && width > 0 && height > 0
        val hasSurface = surface != null
        val hasLocalStream = localVideoStream != null
        val stageJoined = stage != null
        Log.i(
            "IVS_SURFACE",
            "LOG: IVS_SURFACE HOST surface_set ready=$ready hasSurface=$hasSurface hasLocalStream=$hasLocalStream stageJoined=$stageJoined"
        )
        Log.i(IVS_TAG, "[IVS_BIND][HOST] update surfaceHash=$hash size=${width}x${height} mode=$sessionMode owner=$renderOwner")
        logCallTrace("updateHostRenderSurface", surface = surface)
        // Important: allow caching the host surface even before the host session starts.
        // The Surface is owned by the view; we only attach it to preview targets when in HOST mode.
        hostRenderSurface = surface?.let { RenderSurfaceConfig(it, width, height) }
        if (surface != null) {
            // Surface is back; cancel any queued clears.
            cancelPendingHostClear()
        } else {
            // Debounce clear to avoid SurfaceTexture updateTexImage races inside broadcastcore.
            // This mirrors the slot-surface clear behavior and prevents hard crashes during brief
            // surface re-creation windows (navigation, RN reload, activity pause/resume).
            scheduleHostClearSurfacesOnly("surface-null")
            logBindingState("host-surface-null")
            return
        }
        if (sessionMode != SessionMode.HOST && sessionMode != SessionMode.GUEST) {
            Log.w(IVS_TAG, "[IVS_BIND][HOST][GUARD] Stored host surface but not attaching (mode=$sessionMode surfaceHash=$hash)")
            logBindingState("host-surface-stored")
            return
        }
        Log.d(IVS_TAG, "[IVS_RENDER][HOST] surface_set surface=${hostRenderSurface?.surface != null} -> reattach targets=${hostPreviewTargets.size} parked=$cameraSwitchParked")
        logBindingState("host-surface-set")
        if (cameraSwitchParked) {
            Log.i(IVS_TAG, "[IVS_RENDER][HOST] surface cached but attach deferred (cameraSwitchParked)")
            return
        }
        reattachHostPreviewSurfaceIfReady("surface_set")
        if (sessionMode == SessionMode.HOST || sessionMode == SessionMode.GUEST) {
            configureStageForRendering("host-surface-updated")
        }
    }

    private fun updateViewerRenderSurface(surface: Surface?, width: Int, height: Int) {
        Log.w(IVS_TAG, "[IVS_SURFACE] Shared viewer surface path disabled; ignoring update")
    }

    private fun updateViewerRenderSurfaceForSlot(slotId: Int, surface: Surface?, width: Int, height: Int) {
        val hash = surfaceHash(surface)
        if (sessionMode != SessionMode.VIEWER && sessionMode != SessionMode.HOST && sessionMode != SessionMode.GUEST) {
            Log.w(IVS_TAG, "[IVS_BIND][VIEWER_SLOT][GUARD] Ignoring viewer slot surface while mode=$sessionMode slot=$slotId surfaceHash=$hash")
            return
        }

        // Any new surface update cancels a pending clear for this slot.
        if (surface != null) {
            cancelPendingSlotClear(slotId)
        }

        if (surface == null) {
            slotSurfaces.remove(slotId)
            remoteRenderSlots[slotId]?.let { slot ->
                slot.surface = null
                // Debounce clear to avoid SurfaceTexture updateTexImage races inside broadcastcore.
                scheduleSlotClearSurface(slotId, slot, "surface-null")
                Log.d(IVS_TAG, "[IVS_SLOT] surfaceDestroyed slot=$slotId streamKey=${slot.streamKey} surfaceHash=$hash")
            }
            logBindingState("viewer-slot-$slotId-cleared")
            emit("IVS_SURFACE_READY", Arguments.createMap().apply {
                putBoolean("ready", false)
                putInt("width", 0)
                putInt("height", 0)
            })
            return
        }
        slotSurfaces[slotId] = RenderSurfaceConfig(surface, width, height)
        val slot = remoteRenderSlots[slotId]
        if (slot == null) {
            Log.d(IVS_TAG, "[IVS_SLOT] surfaceAvailable slot=$slotId but no track yet; awaiting track assignment surfaceHash=$hash size=${width}x${height}")
            logBindingState("viewer-slot-$slotId-staged")
            return
        }

        slot.surface = surface
        slot.width = width
        slot.height = height
        Log.d(IVS_TAG, "[IVS_SLOT] surfaceAvailable slot=$slotId streamKey=${slot.streamKey} size=${width}x${height} surfaceHash=$hash")
        logBindingState("viewer-slot-$slotId-bound")
        attachSurfaceToSlot(slot)
    }

    private fun selectDefaultDevices(cameraPosition: String?) {
        val devices = deviceDiscovery?.listLocalDevices() ?: emptyList()
        val cameras = devices.filter { it.descriptor.type == DeviceType.CAMERA }

        // Map JS camera position to Descriptor position, default to FRONT for selfie UI
        val desiredPosition = when (cameraPosition?.lowercase()) {
            "back" -> Descriptor.Position.BACK
            else -> Descriptor.Position.FRONT
        }

        currentCamera = cameras.firstOrNull { it.descriptor.position == desiredPosition }
            ?: cameras.firstOrNull { it.descriptor.position == Descriptor.Position.FRONT }
            ?: cameras.firstOrNull()
        currentMic = devices.firstOrNull { it.descriptor.type == DeviceType.MICROPHONE }
        
        Log.d(IVS_TAG, "[CAMERA] Selected default camera: position=${currentCamera?.descriptor?.position}, id=${currentCamera?.descriptor?.deviceId}")
    }

    private fun rebuildLocalVideoStream() {
        val previous = localVideoStream
        try {
            previous?.setListener(null)
        } catch (_: Exception) {
            // ignore
        }
        localVideoStream = currentCamera?.let { ImageLocalStageStream(it, buildSafeStageVideoConfiguration()) }
        localVideoStream?.setListener(stageStreamListener)
    }

    private fun buildSafeStageVideoConfiguration(): StageVideoConfiguration {
        // Avoid odd resolutions that crash some hardware encoders.
        // In recent runs we observed IVS attempting 270x480 (portrait 480p), which can SIGABRT in MediaCodec.start
        // on some devices/encoders. Force a conservative 9:16 resolution with dimensions that are multiples of 16.
        val config = StageVideoConfiguration()
        try {
            config.targetFramerate = 15
        } catch (_: Throwable) {
            // ignore
        }
        try {
            // Keep bitrate modest for stability in E2E; SDK may clamp as needed.
            config.maxBitrate = 600
            config.minBitrate = 200
        } catch (_: Throwable) {
            // ignore
        }

        val width = 288
        val height = 512
        try {
            // Construct BroadcastConfiguration.Vec2 reflectively (ctor signatures vary across SDK versions).
            val vec2Class = Class.forName("${BroadcastConfiguration::class.java.name}\$Vec2")

            // Log ctor signatures once (helps diagnose OEM/SDK differences).
            if (!safeVideoConfigCtorLogged) {
                safeVideoConfigCtorLogged = true
                try {
                    val sigs = vec2Class.declaredConstructors.joinToString("; ") { c ->
                        val params = c.parameterTypes.joinToString(",") { it.simpleName }
                        "(${params})"
                    }
                    Log.i(IVS_TAG, "[IVS_HOST][VIDEO_CONFIG] Vec2 ctors: $sigs")
                } catch (_: Throwable) {
                    // ignore
                }
            }

            val ctor = vec2Class.declaredConstructors.firstOrNull { it.parameterTypes.size == 2 }
            if (ctor == null) {
                Log.w(IVS_TAG, "[IVS_HOST][VIDEO_CONFIG] No 2-arg Vec2 ctor found")
                return config
            }
            ctor.isAccessible = true

            fun coerce(target: Class<*>, value: Int): Any {
                return when (target) {
                    Int::class.javaPrimitiveType, java.lang.Integer::class.java -> value
                    Float::class.javaPrimitiveType, java.lang.Float::class.java -> value.toFloat()
                    Double::class.javaPrimitiveType, java.lang.Double::class.java -> value.toDouble()
                    Long::class.javaPrimitiveType, java.lang.Long::class.java -> value.toLong()
                    else -> value
                }
            }

            val params = ctor.parameterTypes
            val vec2 = ctor.newInstance(coerce(params[0], width), coerce(params[1], height))
            val setSize = config.javaClass.methods.firstOrNull { m ->
                m.name == "setSize" && m.parameterTypes.size == 1 && m.parameterTypes[0].isAssignableFrom(vec2Class)
            }
            if (setSize == null) {
                Log.w(IVS_TAG, "[IVS_HOST][VIDEO_CONFIG] StageVideoConfiguration.setSize(Vec2) not found")
                return config
            }

            setSize.invoke(config, vec2)
            Log.i(IVS_TAG, "[IVS_HOST][VIDEO_CONFIG] Forced StageVideoConfiguration size=${width}x${height} fps=15")
        } catch (e: Throwable) {
            Log.w(IVS_TAG, "[IVS_HOST][VIDEO_CONFIG] Failed to set safe size: ${e.message}")
        }

        return config
    }

    private fun rebuildLocalAudioStream() {
        // Defaults match VIDEO_CHAT (mono, NS on, 64kbps). Set explicitly so a future
        // SDK default drift cannot silently disable publish-path noise suppression.
        val audioConfig = StageAudioConfiguration().apply {
            enableNoiseSuppression(true)
            setStereo(false)
        }
        localAudioStream = currentMic?.let { AudioLocalStageStream(it, audioConfig) }
        localAudioStream?.setListener(stageStreamListener)
        Log.i(
            IVS_TAG,
            "[IVS_AUDIO_ROUTE] local mic stream ns=${audioConfig.isNoiseSuppressionEnabled} " +
                "stereo=${audioConfig.isStereo} maxBitrate=${audioConfig.maxBitrate}",
        )
    }

    private fun rebuildLocalStreams() {
        rebuildLocalVideoStream()
        rebuildLocalAudioStream()
        Log.i(
            "IVS_LOCAL_STREAM",
            "LOG: IVS_LOCAL_STREAM created hasVideo=${localVideoStream != null} hasAudio=${localAudioStream != null}"
        )
    }

    private fun registerLocalPreviewTarget(sessionId: String) {
        // Host UX: show the local camera preview on the host device.
        // Some SDK/timing paths may not deliver an ImageStageStream instance for local video
        // via onStreamsAdded(), which would prevent registerPreviewTarget() from attaching a surface.
        // We proactively bind the ImageLocalStageStream preview target so the SurfaceView gets frames.
        val local = localVideoStream
        if (local == null) {
            Log.w(IVS_TAG, "[IVS_PREVIEW][HOST] No localVideoStream to register")
            return
        }

        try {
            val target = local.previewSurfaceTarget
            val key = "local:$sessionId"
            hostPreviewTargets[key] = target
            hostPreviewTargetStreamTypes[key] = local.javaClass.simpleName
            Log.d(
                IVS_TAG,
                "[IVS_PREVIEW][HOST] Registered local preview target key=$key hasRenderSurface=${activeRenderSurface() != null} parked=$cameraSwitchParked"
            )
            if (cameraSwitchParked) {
                Log.i(IVS_TAG, "[IVS_PREVIEW][HOST] target registered; attach deferred (cameraSwitchParked)")
                return
            }
            attachSurfaceToTarget(target, key, local.javaClass.simpleName)
            reattachHostPreviewSurfaceIfReady("local_stream_registered")
        } catch (e: Exception) {
            Log.e(IVS_TAG, "[IVS_PREVIEW][HOST] Failed to register local preview target: ${e.message}", e)
        }
    }

    private fun getCurrentLocalStreams(): List<LocalStageStream> = listOfNotNull(localVideoStream, localAudioStream)

    private fun streamKey(participant: ParticipantInfo, stream: StageStream): String {
        val participantId = participant.participantId ?: "unknown"
        val deviceId = try {
            stream.getDevice().descriptor.deviceId ?: "device"
        } catch (e: Exception) {
            // Remote streams don't have a device, use stream hashcode instead
            stream.hashCode().toString()
        }
        return "$participantId:${stream.streamType}:$deviceId"
    }

    private fun assignSlot(participantId: String, attributes: Map<String, String>? = null): Int {
        // Token attributes are the layout authority (visible to every participant).
        // Resolve role/slotIndex BEFORE any cached or arrival-order mapping so the
        // host never consumes guest box 1 and the first guest lands in box 1.
        val role = attributes?.get("role")?.trim()?.lowercase()
        val tokenSlot = attributes?.get("slotIndex")?.toIntOrNull()
        val authoritativeSlot = when (role) {
            "host" -> 0
            "guest" -> tokenSlot?.takeIf { it in 1..MAX_REMOTE_VIDEO_STREAMS }
            else -> null
        }

        if (authoritativeSlot != null) {
            participantToSlot[participantId] = authoritativeSlot
            if (authoritativeSlot == 0) {
                // Only the token-designated host owns the primary tile.
                viewerParticipantId = participantId
            }
            Log.i(
                IVS_TAG,
                "[IVS_SLOT][AUTHORITATIVE] participant=$participantId role=$role slot=$authoritativeSlot"
            )
            return authoritativeSlot
        }

        participantToSlot[participantId]?.let { return it }

        val used = participantToSlot.values.toSet()
        // Browser Studio host tokens include role=host; if attributes are missing
        // the first publisher must still occupy the primary tile, not guest box 1.
        if (viewerParticipantId == null && !used.contains(0)) {
            participantToSlot[participantId] = 0
            viewerParticipantId = participantId
            Log.w(IVS_TAG, "[IVS_SLOT][UNTAGGED_HOST] participant=$participantId slot=0")
            return 0
        }

        // Legacy/untagged guests: sticky boxes 1..N. Never skip box 1.
        fun firstFreeGuestSlot(): Int {
            val free = (1..MAX_REMOTE_VIDEO_STREAMS).firstOrNull { !used.contains(it) }
            if (free != null) return free
            var spill = MAX_REMOTE_VIDEO_STREAMS + 1
            while (used.contains(spill)) spill += 1
            Log.w(IVS_TAG, "[IVS_SLOT] spillGuestSlot participant=$participantId slot=$spill used=$used")
            return spill
        }

        val slotId = firstFreeGuestSlot()
        participantToSlot[participantId] = slotId
        Log.w(IVS_TAG, "[IVS_SLOT][LEGACY_FALLBACK] participant=$participantId slot=$slotId used=$used")
        return slotId
    }

    private fun registerPreviewTarget(participant: ParticipantInfo, stream: StageStream): Boolean {
        if (stream.streamType != Type.VIDEO) return false
        val previewTarget = when (stream) {
            is ImageStageStream -> stream.previewSurfaceTarget
            is ImageLocalStageStream -> stream.previewSurfaceTarget
            else -> {
                Log.e(
                    IVS_TAG,
                    "[IVS_PREVIEW] Expected ImageStageStream/ImageLocalStageStream for video but got ${stream.javaClass.simpleName}; preview surface not attached"
                )
                return false
            }
        }
        val key = streamKey(participant, stream)

        // Host/guest devices already attach the local camera stream via the dedicated local preview key
        // (e.g., "local:<sessionId>"). Registering the same ImageLocalStageStream again under the local
        // participant key can cause the Broadcast SDK to fail creating an EGL surface (EGL_NO_SURFACE)
        // on some devices, resulting in black video.
        if (participant.isLocal && stream is ImageLocalStageStream && (sessionMode == SessionMode.HOST || sessionMode == SessionMode.GUEST)) {
            Log.d(IVS_TAG, "[IVS_PREVIEW] Skipping duplicate local stream preview target key=$key")
            return false
        }

        if (!participant.isLocal && (sessionMode == SessionMode.VIEWER || sessionMode == SessionMode.HOST || sessionMode == SessionMode.GUEST)) {
            val slotId = assignSlot(participant.participantId ?: "unknown", participant.attributes)
            val slot = RenderSlot(
                slotId = slotId,
                streamKey = key,
                participantId = participant.participantId ?: "unknown",
                previewTarget = previewTarget,
            )

            remoteRenderSlots[slotId] = slot
            slotToStreamKey[slotId] = key

            // Attach immediately if a surface already exists for this slot
            slotSurfaces[slotId]?.let { surfaceConfig ->
                slot.surface = surfaceConfig.surface
                slot.width = surfaceConfig.width
                slot.height = surfaceConfig.height
            }

            Log.d(IVS_TAG, "[IVS_SLOT] trackAdded participant=${participant.participantId} slot=$slotId streamKey=$key")
            attachSurfaceToSlot(slot)
            return true
        }

        hostPreviewTargets[key] = previewTarget
        hostPreviewTargetStreamTypes[key] = stream.javaClass.simpleName
        Log.d(IVS_TAG, "[IVS_PREVIEW] Registered host preview target: participant=${participant.participantId}, key=$key, streamType=${stream.javaClass.simpleName}, hasRenderSurface=${activeRenderSurface() != null}")
        attachSurfaceToTarget(previewTarget, key, stream.javaClass.simpleName)
        if (sessionMode == SessionMode.HOST || sessionMode == SessionMode.GUEST) {
            reattachHostPreviewSurfaceIfReady("target_registered")
        }
        return true
    }

    private fun removePreviewTarget(participant: ParticipantInfo, stream: StageStream) {
        if (stream.streamType != Type.VIDEO) return
        if (stream !is ImageStageStream) return

        val key = streamKey(participant, stream)

        if (!participant.isLocal && (sessionMode == SessionMode.VIEWER || sessionMode == SessionMode.HOST || sessionMode == SessionMode.GUEST)) {
            val slotId = participantToSlot[participant.participantId]
            if (slotId != null) {
                remoteRenderSlots.remove(slotId)?.let { slot ->
                    try {
                        slot.previewTarget.clearSurface()
                    } catch (_: Exception) {
                        // ignore
                    }
                }
                slotToStreamKey.remove(slotId)
                // Only the pinned PRIMARY tile (slot 0 = host) is preserved so it can never be
                // reassigned. Guest tiles (slot >= 1) MUST be freed on leave — otherwise a guest
                // who rejoins arrives with a NEW participantId, finds their authoritative slot
                // still "used" by their own departed session, and falls back to the wrong box.
                val isPinnedPrimary = participant.participantId != null &&
                    participant.participantId == viewerParticipantId &&
                    slotId == 0
                if (!isPinnedPrimary) {
                    participant.participantId?.let { participantToSlot.remove(it) }
                } else {
                    Log.d(
                        IVS_TAG,
                        "[IVS_SLOT] preservePrimarySlotMapping participant=${participant.participantId} slot=$slotId"
                    )
                }
            }
            firstFrameSignalKeys.remove(key)
            return
        }

        hostPreviewTargets.remove(key)?.let { target ->
            try {
                target.clearSurface()
            } catch (_: Exception) {
                // ignore
            }
        }
        hostPreviewTargetStreamTypes.remove(key)
        firstFrameSignalKeys.remove(key)
    }

    private fun attachSurfaceToTarget(
        target: ImagePreviewSurfaceTarget,
        key: String? = null,
        streamTypeName: String? = null,
    ) {
        if (cameraSwitchParked) {
            Log.i(IVS_TAG, "[IVS_RENDER] attachSurfaceToTarget skipped: cameraSwitchParked key=${key ?: "none"}")
            return
        }
        val surfaceConfig = activeRenderSurface() ?: return
        val safeWidth = if (surfaceConfig.width > 0) surfaceConfig.width else 1
        val safeHeight = if (surfaceConfig.height > 0) surfaceConfig.height else 1
        mainHandler.post {
            if (cameraSwitchParked) {
                Log.i(IVS_TAG, "[IVS_RENDER] attachSurfaceToTarget deferred-post skipped: cameraSwitchParked key=${key ?: "none"}")
                return@post
            }
            try {
                surfaceConfig.surface?.let { surface ->
                    target.setSurface(surface, safeWidth, safeHeight)
                    Log.d(
                        IVS_TAG,
                        "[IVS_RENDER] Attached surface ${safeWidth}x${safeHeight} to preview target (mode=$sessionMode) surfaceHash=${surfaceHash(surface)} targetHash=${targetHash(target)} key=${key ?: "none"}"
                    )
                    // Proof log for CI / grep-based verification. Keep the tag as IVS_TAG so it is captured
                    // by the tag-filtered logcat pipeline.
                    Log.i(
                        IVS_TAG,
                        "[IVS_PREVIEW][ATTACHED] streamType=${streamTypeName ?: "unknown"} surface=true size=${safeWidth}x${safeHeight} surfaceHash=${surfaceHash(surface)} key=${key ?: "none"}"
                    )
                }
            } catch (e: Exception) {
                Log.e(IVS_TAG, "[IVS_RENDER] Failed to attach surface: ${e.message}", e)
            }
        }
    }

    private fun attachHostSurfaceToAllTargets() {
        hostPreviewTargets.forEach { (key, target) ->
            val streamType = hostPreviewTargetStreamTypes[key] ?: "unknown"
            attachSurfaceToTarget(target, key, streamType)
        }
    }

    private fun reattachHostPreviewSurfaceIfReady(reason: String) {
        val targetExists = hostPreviewTargets.isNotEmpty()
        val surfaceExists = hostRenderSurface?.surface != null
        val canAttach = renderOwner == RenderOwner.HOST_PREVIEW && (sessionMode == SessionMode.HOST || sessionMode == SessionMode.GUEST)
        val didAttach = canAttach && targetExists && surfaceExists && !cameraSwitchParked
        Log.i(
            "IVS_PREVIEW",
            "LOG: IVS_PREVIEW reattach reason=$reason didAttach=$didAttach targetExists=$targetExists surfaceExists=$surfaceExists parked=$cameraSwitchParked"
        )

        // Host preview surface is used for both HOST and GUEST publishing sessions.
        if (!canAttach) return
        if (cameraSwitchParked) {
            Log.i(IVS_TAG, "[IVS_RENDER][HOST] reattach skipped: cameraSwitchParked (reason=$reason)")
            return
        }

        val surfaceConfig = hostRenderSurface
        if (surfaceConfig?.surface == null) {
            Log.d(IVS_TAG, "[IVS_RENDER][HOST] reattach skipped: surface=null (reason=$reason)")
            return
        }

        val targets = hostPreviewTargets.toMap()
        if (targets.isEmpty()) {
            Log.d(IVS_TAG, "[IVS_RENDER][HOST] reattach skipped: no targets (reason=$reason)")
            return
        }

        Log.d(IVS_TAG, "[IVS_RENDER][HOST] reattach attaching surface to ${targets.size} targets (reason=$reason)")
        targets.forEach { (key, target) ->
            val streamType = hostPreviewTargetStreamTypes[key] ?: "unknown"
            attachSurfaceToTarget(target, key, streamType)
        }
    }

    private fun clearHostPreviewSurfacesOnly(reason: String) {
        val targets = hostPreviewTargets.toMap()
        if (targets.isEmpty()) {
            Log.d(IVS_TAG, "[IVS_RENDER][HOST] clear surfaces skipped: no targets (reason=$reason)")
            return
        }
        // Debounce host clears to avoid races during surface recreation.
        scheduleHostClearSurfacesOnly(reason)
    }

    private fun clearHostPreviewTargets() {
        logCallTrace("clearHostPreviewTargets")
        hostPreviewTargets.forEach { (key, target) ->
            try {
                Log.i(IVS_TAG, "[IVS_BIND][HOST][CLEAR] key=$key targetHash=${targetHash(target)}")
                target.clearSurface()
            } catch (_: Exception) {
                // ignore
            }
        }
        hostPreviewTargets.clear()
        hostPreviewTargetStreamTypes.clear()
        firstFrameSignalKeys.clear()
        remoteVideoFlowKeys.clear()
        logBindingState("clearHostPreviewTargets")
    }

    private fun clearRemoteRenderSlots() {
        remoteRenderSlots.values.forEach { slot ->
            try {
                slot.previewTarget.clearSurface()
            } catch (_: Exception) {
                // ignore
            }
        }
        remoteRenderSlots.clear()
        slotSurfaces.clear()
        participantToSlot.clear()
        slotToStreamKey.clear()
        firstFrameSignalKeys.clear()
        remoteVideoFlowKeys.clear()
        logBindingState("clearRemoteRenderSlots")
    }

    private fun reattachViewerSurfaces(reason: String) {
        if (sessionMode != SessionMode.VIEWER && sessionMode != SessionMode.HOST && sessionMode != SessionMode.GUEST) return
        val slots = remoteRenderSlots.values.toList()
        if (slots.isEmpty()) {
            Log.d(IVS_TAG, "[IVS_VIEWER][RENDER_SLOT] No slots to reattach (reason=$reason)")
            return
        }
        Log.d(IVS_TAG, "[IVS_VIEWER][RENDER_SLOT] Reattaching ${slots.size} slots (reason=$reason)")
        slots.forEach { attachSurfaceToSlot(it) }
    }

    private fun attachSurfaceToSlot(slot: RenderSlot) {
        slotSurfaces[slot.slotId]?.let { config ->
            if (slot.surface == null) {
                slot.surface = config.surface
                slot.width = config.width
                slot.height = config.height
            }
        }
        val safeWidth = if (slot.width > 0) slot.width else 1
        val safeHeight = if (slot.height > 0) slot.height else 1
        val attachSig = "${surfaceHash(slot.surface)}:${safeWidth}x${safeHeight}:${slot.streamKey}"
        if (slot.surface != null && lastSlotAttachSig[slot.slotId] == attachSig) {
            return
        }
        mainHandler.post {
            try {
                val surface = slot.surface
                val hasSurface = surface != null
                Log.d(
                    IVS_TAG,
                    "[IVS_SLOT] tryAttach slot=${slot.slotId} surface=$hasSurface track=${slot.streamKey.isNotEmpty()} size=${safeWidth}x${safeHeight} surfaceHash=${surfaceHash(surface)} previewTargetHash=${targetHash(slot.previewTarget)}"
                )
                if (!hasSurface) {
                    lastSlotAttachSig.remove(slot.slotId)
                    slot.previewTarget.clearSurface()
                    Log.d(IVS_TAG, "[IVS_SLOT] detach slot=${slot.slotId} streamKey=${slot.streamKey}")
                    return@post
                }
                slot.previewTarget.setSurface(surface, safeWidth, safeHeight)
                lastSlotAttachSig[slot.slotId] = attachSig
                Log.d(
                    IVS_TAG,
                    "[IVS_SLOT] ATTACHED slot=${slot.slotId} streamKey=${slot.streamKey} size=${safeWidth}x${safeHeight} surfaceHash=${surfaceHash(surface)} previewTargetHash=${targetHash(slot.previewTarget)}"
                )
                Log.i(
                    IVS_TAG,
                    "[IVS_NATIVE][REMOTE_VIDEO_BOUND] slot=${slot.slotId} trackId=${slot.streamKey} participantId=${slot.participantId} surfaceHash=${surfaceHash(surface)} size=${safeWidth}x${safeHeight}"
                )

                // Deterministic CI proof: viewer-side expected video should flow once slot 0 is bound.
                if (slot.slotId == 0) {
                    startNetRxDeltaProofIfNeeded("viewer", 0, "REMOTE_VIDEO_BOUND_SLOT0")
                }
                if (firstFrameSignalKeys.add(slot.streamKey)) {
                    emit("IVS_REMOTE_FIRST_FRAME_SIGNAL", Arguments.createMap().apply {
                        putString("streamKey", slot.streamKey)
                        putString("sessionId", currentSessionId)
                    })
                }
                emit("IVS_SURFACE_READY", Arguments.createMap().apply {
                    putBoolean("ready", true)
                    putInt("width", safeWidth)
                    putInt("height", safeHeight)
                })
            } catch (e: Exception) {
                Log.e(IVS_TAG, "[IVS_VIEWER][RENDER_SLOT] Failed to attach surface for streamKey=${slot.streamKey}: ${e.message}", e)
            }
        }
    }

    private fun buildStageStrategy(): Stage.Strategy = object : Stage.Strategy {
        override fun stageStreamsToPublishForParticipant(stage: Stage, participantInfo: ParticipantInfo): List<LocalStageStream> {
            return if (participantInfo.isLocal) getCurrentLocalStreams() else emptyList()
        }

        override fun shouldPublishFromParticipant(stage: Stage, participantInfo: ParticipantInfo): Boolean {
            return participantInfo.isLocal
        }

        override fun shouldSubscribeToParticipant(stage: Stage, participantInfo: ParticipantInfo): Stage.SubscribeType {
            return if (participantInfo.isLocal) Stage.SubscribeType.NONE else Stage.SubscribeType.AUDIO_VIDEO
        }

        override fun subscribeConfigrationForParticipant(stage: Stage, participantInfo: ParticipantInfo): SubscribeConfiguration {
            return viewerSubscribeConfiguration()
        }

    }

    private val stageRenderer: StageRenderer = object : StageRenderer {
        override fun onConnectionStateChanged(stage: Stage, state: Stage.ConnectionState, exception: BroadcastException?) {
            Log.d("IVS_STAGE", "[IVS_STAGE] Connection state: $state")
            lastStageConnectionState = state
            if (state == Stage.ConnectionState.CONNECTING || state == Stage.ConnectionState.CONNECTED) {
                loudspeakerController.forceActive("stage-state-${state.name.lowercase()}")
            }
            if (sessionMode == SessionMode.VIEWER && state == Stage.ConnectionState.CONNECTED) {
                viewerReachedStableConnection = true
                reassertViewerPlaybackAudio("viewer-stage-connected")
            }
            // Recoverable viewer ICE blips must not reach JS: stopSession there
            // tears down TextureViews and triggers reconnect storms (slideshow +
            // frozen UI). Native re-join keeps the same Stage + surfaces.
            val recoverableViewerDisconnect =
                sessionMode == SessionMode.VIEWER &&
                    state == Stage.ConnectionState.DISCONNECTED &&
                    exception == null
            if (recoverableViewerDisconnect) {
                Log.i(IVS_TAG, "[VIEWER] recoverable DISCONNECTED; native rejoin (no JS emit)")
                mainHandler.postDelayed({
                    if (sessionMode != SessionMode.VIEWER || stage == null) return@postDelayed
                    try {
                        stage?.join()
                        reassertViewerPlaybackAudio("viewer-auto-rejoin")
                        reattachViewerSurfaces("viewer-auto-rejoin")
                    } catch (e: Exception) {
                        Log.w(IVS_TAG, "[VIEWER] auto-rejoin failed: ${e.message}")
                    }
                }, 400)
            } else {
                emit("IVS_BROADCAST_STATE_CHANGED", Arguments.createMap().apply {
                    putString("state", state.name)
                })
            }

            if (state == Stage.ConnectionState.DISCONNECTED) {
                stopNetRxDeltaProof("stage_disconnected")
            }

            if (exception != null) {
                emitError(exception)
            }
        }

        override fun onParticipantJoined(stage: Stage, participant: ParticipantInfo) {
            Log.d(IVS_TAG, "[IVS_STAGE] Participant joined: id=${participant.participantId}, local=${participant.isLocal}")
            if (participant.isLocal) {
                emitLocalJoined(participant)
            } else {
                emitRemoteJoined(participant)
            }
        }

        override fun onParticipantMetadataUpdated(stage: Stage, participant: ParticipantInfo) {
            if (!participant.isLocal) {
                emitRemoteUpdated(participant, null, null)
            }
        }

        override fun onParticipantLeft(stage: Stage, participant: ParticipantInfo) {
            Log.d(IVS_TAG, "[IVS_STAGE] Participant left: id=${participant.participantId}, local=${participant.isLocal}")
            if (sessionMode != SessionMode.VIEWER) {
                loudspeakerController.forceActive(
                    if (participant.isLocal) "local-participant-left" else "remote-participant-left"
                )
            }
            if (participant.isLocal) {
                emit("IVS_HOST_LOCAL_LEFT", Arguments.createMap().apply {
                    putString("participantId", participant.participantId)
                    putString("reason", "LEFT")
                })
            } else {
                emit("IVS_REMOTE_PARTICIPANT_LEFT", Arguments.createMap().apply {
                    putString("participantId", participant.participantId)
                    putString("reason", "LEFT")
                })
            }
        }

        override fun onParticipantPublishStateChanged(stage: Stage, participant: ParticipantInfo, publishState: Stage.PublishState) {
            Log.d(IVS_TAG, "[IVS_STAGE] Publish state changed: id=${participant.participantId}, state=$publishState")
            if (sessionMode != SessionMode.VIEWER) {
                loudspeakerController.forceActive("publish-state-${publishState.name.lowercase()}")
            }
            if (participant.isLocal && publishState == Stage.PublishState.PUBLISHED) {
                if (sessionMode == SessionMode.GUEST) {
                    Log.i(
                        IVS_TAG,
                        "[IVS_NATIVE][GUEST_PUBLISH_STARTED] participantId=${participant.participantId} sessionId=${currentSessionId} slotIndex=${guestSlotIndex}"
                    )
                }
                emitLocalJoined(participant)
            }
        }

        override fun onParticipantSubscribeStateChanged(stage: Stage, participant: ParticipantInfo, subscribeState: Stage.SubscribeState) {
            Log.d(IVS_TAG, "[IVS_STAGE] Subscribe state changed: id=${participant.participantId}, state=$subscribeState")
            if (sessionMode == SessionMode.VIEWER && !participant.isLocal &&
                subscribeState == Stage.SubscribeState.SUBSCRIBED
            ) {
                // Pin loudspeaker once per participant; avoid force() log/route churn every tick.
                reassertViewerPlaybackAudio("viewer-subscribed-${participant.participantId}")
            } else if (sessionMode != SessionMode.VIEWER) {
                loudspeakerController.forceActive("subscribe-state-${subscribeState.name.lowercase()}")
            }
        }

        override fun onStreamsAdded(stage: Stage, participant: ParticipantInfo, streams: List<StageStream>) {
            val participantId = participant.participantId ?: "null"
            val streamTypes = streams.joinToString(",") { s ->
                when (s.streamType) {
                    Type.VIDEO -> "video"
                    Type.AUDIO -> "audio"
                    else -> s.streamType.toString().lowercase()
                }
            }
            Log.i(
                "IVS_REMOTE_STREAMS",
                "LOG: IVS_REMOTE_STREAMS added count=${streams.size} participants=$participantId streamTypes=$streamTypes"
            )
            if (streams.any { it.streamType == Type.AUDIO } && !participant.isLocal) {
                if (sessionMode == SessionMode.VIEWER) {
                    reassertViewerPlaybackAudio("viewer-remote-audio-added")
                } else {
                    loudspeakerController.forceActive("remote-audio-stream-added")
                }
            }
            Log.d(IVS_TAG, "[IVS_STAGE] Streams added for ${participant.participantId}: count=${streams.size}, isLocal=${participant.isLocal}")
            attachStreamListeners(participant, streams)
            
            // Attach preview targets to any video stream so the surface is actually bound.
            // Remote streams need this in viewer mode; the SDK does not auto-bind our Stage surface.
            val acceptedStreamKeys = mutableSetOf<String>()
            Log.d(IVS_TAG, "[IVS_STAGE] Registering preview targets for participant=${participant.participantId} isLocal=${participant.isLocal} mode=$sessionMode")
            streams.forEach { stream ->
                val accepted = registerPreviewTarget(participant, stream)
                if (accepted && stream.streamType == Type.VIDEO) {
                    acceptedStreamKeys.add(streamKey(participant, stream))
                }
            }
            
            if (participant.isLocal) {
                val hasVideo = streams.any { it.streamType == Type.VIDEO }
                val hasAudio = streams.any { it.streamType == Type.AUDIO }
                if (hasVideo) {
                    val videoTrackIds = streams
                        .filter { it.streamType == Type.VIDEO }
                        .joinToString(",") { streamKey(participant, it) }
                    Log.i(
                        IVS_TAG,
                        "[IVS_NATIVE][LOCAL_VIDEO_ADDED] trackId=${videoTrackIds} participantId=${participant.participantId} sessionId=${currentSessionId} mode=${sessionMode} slotIndex=${guestSlotIndex}"
                    )
                }
                if (hasAudio) {
                    val audioTrackIds = streams
                        .filter { it.streamType == Type.AUDIO }
                        .joinToString(",") { streamKey(participant, it) }
                    Log.i(
                        IVS_TAG,
                        "[IVS_NATIVE][LOCAL_AUDIO_ADDED] trackId=${audioTrackIds} participantId=${participant.participantId} sessionId=${currentSessionId} mode=${sessionMode} slotIndex=${guestSlotIndex}"
                    )
                }
                Log.d(IVS_TAG, "[IVS_LOCAL_TRACK_UPDATE] added: video=$hasVideo audio=$hasAudio")
                emit("IVS_LOCAL_TRACK_UPDATE", Arguments.createMap().apply {
                    putBoolean("videoEnabled", hasVideo)
                    putBoolean("audioEnabled", hasAudio)
                })
            } else {
                streams.forEach { stream ->
                    if (stream.streamType == Type.VIDEO) {
                        val key = streamKey(participant, stream)
                        if (!acceptedStreamKeys.contains(key)) {
                            Log.w(IVS_TAG, "[IVS_TRACKS] remoteVideoTrackAdded skipped due to render limit for streamKey=$key participant=${participant.participantId}")
                            return@forEach
                        }
                        Log.d(IVS_TAG, "[IVS_TRACKS] remoteVideoTrackAdded participantId=${participant.participantId} streamKey=$key")
                        Log.d(IVS_TAG, "[IVS_VIDEO_VIEW] Remote video track detected - Stage view will render it automatically")
                        val slotIndexForBridge = participant.participantId?.let { pid -> participantToSlot[pid] }
                        Log.i(
                            IVS_TAG,
                            "[IVS_BRIDGE][REMOTE_VIDEO_ADDED] participantId=${participant.participantId} slotIndex=${slotIndexForBridge ?: "null"} streamKey=$key"
                        )

                        // Deterministic CI proof: host-side guest video once mapped to a guest box (1..N).
                        val slotIndex = slotIndexForBridge ?: -1
                        if (sessionMode == SessionMode.HOST && slotIndex >= 1) {
                            startNetRxDeltaProofIfNeeded("host", slotIndex, "REMOTE_VIDEO_ADDED_GUEST_SLOT")
                        }

                        val roleAttr = participant.attributes?.get("role")
                        emit("IVS_REMOTE_VIDEO_ADDED", Arguments.createMap().apply {
                            putString("participantId", participant.participantId)
                            putString("userId", participant.userId)
                            putString("streamKey", key)
                            participant.participantId?.let { pid ->
                                participantToSlot[pid]?.let { slot -> putInt("slotIndex", slot) }
                            }
                            if (!roleAttr.isNullOrBlank()) putString("role", roleAttr)
                        })
                        // Primary tile is only for the token-designated host (assignSlot).
                        // Do not pin whichever remote stream happened to arrive first.
                        if (slotIndexForBridge == 0 && stream is RemoteStageStream) {
                            viewerParticipantId = participant.participantId
                            Log.d(IVS_TAG, "[IVS_VIEWER] Tracking authoritative host participant ${participant.participantId}")
                        }
                    }
                }
                emitRemoteUpdated(participant, streams, null)
            }
        }

        override fun onStreamsRemoved(stage: Stage, participant: ParticipantInfo, streams: List<StageStream>) {
            Log.d(IVS_TAG, "[IVS_STAGE] Streams removed for ${participant.participantId}: count=${streams.size}")
            streams.forEach { removePreviewTarget(participant, it) }
            if (participant.isLocal) {
                val videoEnabled = streams.none { it.streamType == Type.VIDEO }
                val audioEnabled = streams.none { it.streamType == Type.AUDIO }
                Log.d(IVS_TAG, "[IVS_LOCAL_TRACK_UPDATE] removed: videoEnabled=$videoEnabled audioEnabled=$audioEnabled")
                emit("IVS_LOCAL_TRACK_UPDATE", Arguments.createMap().apply {
                    putBoolean("videoEnabled", videoEnabled)
                    putBoolean("audioEnabled", audioEnabled)
                })
            } else {
                streams.forEach { stream ->
                    if (stream.streamType == Type.VIDEO) {
                        val key = streamKey(participant, stream)
                        emit("IVS_REMOTE_VIDEO_REMOVED", Arguments.createMap().apply {
                            putString("participantId", participant.participantId)
                            putString("userId", participant.userId)
                            putString("streamKey", key)
                        })
                        // Keep viewerParticipantId pinned for the session so slot 0 is never reassigned.
                        if (viewerParticipantId == participant.participantId) {
                            Log.d(IVS_TAG, "[IVS_VIEWER] Primary remote participant ${participant.participantId} left (slot0 stays pinned)")
                        }
                    }
                }
                emitRemoteUpdated(participant, streams, null)
            }
        }

        override fun onStreamsMutedChanged(stage: Stage, participant: ParticipantInfo, streams: List<StageStream>) {
            Log.d(IVS_TAG, "[IVS_STAGE] Streams muted changed for ${participant.participantId}")
            if (!participant.isLocal) {
                emitRemoteUpdated(participant, streams, null)
            }
        }

        override fun onStreamLayersChanged(stage: Stage, participant: ParticipantInfo, stream: RemoteStageStream, layers: List<RemoteStageStream.Layer>) {
            // Log available layers; selection handled internally by SDK
            if (layers.isEmpty()) return
            val bestLayer = layers.maxByOrNull { it.bitrate ?: 0 }
            Log.d(IVS_TAG, "[IVS_STAGE] Layers available for ${participant.participantId}, best bitrate=${bestLayer?.bitrate}")
        }

        override fun onStreamLayerSelected(stage: Stage, participant: ParticipantInfo, stream: RemoteStageStream, layer: RemoteStageStream.Layer?, reason: RemoteStageStream.LayerSelectedReason) {
            Log.d(IVS_TAG, "[IVS_STAGE] Layer selected: bitrate=${layer?.bitrate} reason=$reason")
        }

        override fun onStreamAdaptionChanged(stage: Stage, participant: ParticipantInfo, stream: RemoteStageStream, isAdapting: Boolean) {
            // no-op
        }

        override fun onSubscriberCountChanged(stage: Stage, subscriberCount: Int) {
            // no-op
        }

        override fun onError(error: BroadcastException) {
            emitError(error)
        }
    }

    private fun attachStreamListeners(participant: ParticipantInfo, streams: List<StageStream>) {
        streams.forEach { stream ->
            val key = streamKey(participant, stream)
            stream.setListener(object : StageStream.Listener {
                override fun onMutedChanged(isMuted: Boolean) {
                    // no-op: higher level events handle participant updates
                }

                override fun onRTCStats(stats: Map<String, Map<String, String>>) {
                    // RemoteVideoStats callbacks do not appear to fire reliably in our environment.
                    // Fall back to WebRTC stats as a deterministic proof that media is flowing.
                    val pid = participant.participantId
                    val slot = if (pid != null) participantToSlot[pid] else null
                    val positiveSummary = extractPositiveRtcMetricSummary(stats)

                    if (positiveSummary.isNotEmpty() &&
                        !participant.isLocal &&
                        remoteVideoFlowKeys.add("rtc:$key")
                    ) {
                        Log.i(
                            "IVS_PROOF",
                            "rtcVideoFlow mode=$sessionMode slot=${slot ?: -1} participantId=${pid ?: "null"} streamKey=$key metrics=$positiveSummary"
                        )
                    }
                }

                override fun onLocalAudioStats(stats: com.amazonaws.ivs.broadcast.LocalAudioStats) {
                    emitNetworkQuality(stats.networkQuality, true)
                }

                override fun onLocalVideoStats(stats: List<com.amazonaws.ivs.broadcast.LocalVideoStats>) {
                    val quality = stats.firstOrNull()?.networkQuality
                    emitNetworkQuality(quality, true)
                }

                override fun onRemoteAudioStats(stats: com.amazonaws.ivs.broadcast.RemoteAudioStats) {
                    // no-op for now
                }

                override fun onRemoteVideoStats(stats: com.amazonaws.ivs.broadcast.RemoteVideoStats) {
                    // Pixel-based probes are unreliable with SurfaceView (often excluded from Window capture and
                    // may return PixelCopy.ERROR_SOURCE_NO_DATA). Use SDK stats to prove remote video is flowing.
                    val pid = participant.participantId
                    val slot = if (pid != null) participantToSlot[pid] else null
                    val positiveSummary = extractPositiveMetricSummary(stats)

                    if (!participant.isLocal && positiveSummary.isNotEmpty() && remoteVideoFlowKeys.add(key)) {
                        Log.i(
                            "IVS_PROOF",
                            "remoteVideoFlow mode=$sessionMode slot=${slot ?: -1} participantId=${pid ?: "null"} streamKey=$key metrics=$positiveSummary"
                        )
                    }
                }
            })
        }
    }

    private fun extractPositiveRtcMetricSummary(stats: Map<String, Map<String, String>>): String {
        // Stats schema varies by device/SDK; keep this defensive and small.
        // We consider these a strong indicator of actual incoming media:
        // - framesDecoded / framesReceived / framesPerSecond
        // - bytesReceived / packetsReceived
        val interestingKeys = listOf(
            "framesDecoded",
            "framesReceived",
            "framesPerSecond",
            "fps",
            "bytesReceived",
            "packetsReceived",
            "jitterBufferDelay",
            "jitterBufferEmittedCount"
        )

        val parts = mutableListOf<String>()

        fun parsePositiveNumber(raw: String?): Double? {
            if (raw.isNullOrBlank()) return null
            val trimmed = raw.trim()
            val value = trimmed.toDoubleOrNull() ?: trimmed.toLongOrNull()?.toDouble() ?: return null
            return if (value > 0.0) value else null
        }

        for ((_, report) in stats) {
            for (k in interestingKeys) {
                val v = report[k]
                val positive = parsePositiveNumber(v) ?: continue
                parts.add("$k=$positive")
                if (parts.size >= 6) return parts.joinToString(",")
            }
        }

        return parts.joinToString(",")
    }

    private fun extractPositiveMetricSummary(stats: Any): String {
        if (remoteVideoFlowKeys.isNotEmpty() && sessionMode == SessionMode.VIEWER) {
            // After first proof, skip reflection — getMethods() on every stats tick janks watch.
            return ""
        }
        return try {
            val parts = mutableListOf<String>()
            val methods = stats.javaClass.methods
            for (m in methods) {
                if (m.parameterCount != 0) continue
                val name = m.name
                if (!name.startsWith("get") && !name.startsWith("is")) continue
                if (name == "getClass") continue

                val rt = m.returnType
                val isNumber = Number::class.java.isAssignableFrom(rt) ||
                    rt == java.lang.Integer.TYPE ||
                    rt == java.lang.Long.TYPE ||
                    rt == java.lang.Double.TYPE ||
                    rt == java.lang.Float.TYPE

                if (!isNumber) continue

                val value = try { m.invoke(stats) } catch (_: Exception) { null }
                val num = (value as? Number)?.toDouble() ?: continue
                if (num > 0.0) {
                    // Keep this compact: only include a few interesting-looking metrics.
                    val lowered = name.lowercase()
                    if (lowered.contains("frame") || lowered.contains("fps") || lowered.contains("bit") || lowered.contains("byte") || lowered.contains("packet")) {
                        parts.add("$name=$value")
                        if (parts.size >= 6) break
                    }
                }
            }
            parts.joinToString(",")
        } catch (_: Exception) {
            ""
        }
    }

    private val stageStreamListener: StageStream.Listener = object : StageStream.Listener {
        override fun onMutedChanged(isMuted: Boolean) {
            // no-op: higher level events handle participant updates
        }

        override fun onRTCStats(stats: Map<String, Map<String, String>>) {
            // optional analytics hook
        }

        override fun onLocalAudioStats(stats: com.amazonaws.ivs.broadcast.LocalAudioStats) {
            emitNetworkQuality(stats.networkQuality, true)
        }

        override fun onLocalVideoStats(stats: List<com.amazonaws.ivs.broadcast.LocalVideoStats>) {
            val quality = stats.firstOrNull()?.networkQuality
            emitNetworkQuality(quality, true)
        }

        override fun onRemoteAudioStats(stats: com.amazonaws.ivs.broadcast.RemoteAudioStats) {
            // no-op for now
        }

        override fun onRemoteVideoStats(stats: com.amazonaws.ivs.broadcast.RemoteVideoStats) {
            if (sessionMode == SessionMode.VIEWER) {
                Log.d(IVS_TAG, "[IVS_VIEWER][REMOTE_VIDEO_STATS] stats=$stats")
            }
        }
    }

    private fun emitLocalJoined(participant: ParticipantInfo) {
        Log.d(IVS_TAG, "[NATIVE_EMIT] emitLocalJoined called: participantId=${participant.participantId}, currentSessionId=$currentSessionId")
        currentSessionId?.let { sessionId ->
            Log.d(IVS_TAG, "[NATIVE_EMIT] Emitting IVS_HOST_LOCAL_JOINED with sessionId=$sessionId")
            val role = when (sessionMode) {
                SessionMode.GUEST -> "guest"
                SessionMode.HOST -> "host"
                else -> "host"
            }
            emit("IVS_HOST_LOCAL_JOINED", Arguments.createMap().apply {
                putString("participantId", participant.participantId ?: sessionId)
                putString("sessionId", sessionId)
                putString("role", role)
                if (role == "guest") {
                    guestSlotIndex?.let { putInt("slotIndex", it) }
                }
            })
        } ?: run {
            Log.w(IVS_TAG, "[NATIVE_EMIT] WARNING: currentSessionId is null, NOT emitting IVS_HOST_LOCAL_JOINED")
        }
    }

    private fun emitRemoteJoined(participant: ParticipantInfo) {
        val pid = participant.participantId ?: "unknown"
        val slot = assignSlot(pid, participant.attributes)
        val role = participant.attributes?.get("role")
        emit("IVS_REMOTE_PARTICIPANT_JOINED", Arguments.createMap().apply {
            putString("participantId", participant.participantId)
            putString("userId", participant.userId)
            putInt("slotIndex", slot)
            if (!role.isNullOrBlank()) putString("role", role)
        })
    }

    private fun emitRemoteUpdated(participant: ParticipantInfo, streams: List<StageStream>?, mutedOverride: Boolean?) {
        val audioMuted = mutedOverride ?: streams?.firstOrNull { it.streamType == Type.AUDIO }?.getMuted()
        val videoMuted = streams?.firstOrNull { it.streamType == Type.VIDEO }?.getMuted()

        emit("IVS_REMOTE_PARTICIPANT_UPDATED", Arguments.createMap().apply {
            putString("participantId", participant.participantId)
            audioMuted?.let { putBoolean("isMuted", it) }
            videoMuted?.let { putBoolean("isCameraDisabled", it) }
            participant.participantId?.let { pid ->
                participantToSlot[pid]?.let { slot -> putInt("slotIndex", slot) }
            }
        })
    }

    private fun emitError(error: BroadcastException) {
        Log.e(IVS_TAG, "[IVS_STAGE][ERROR] code=${error.error?.name}, message=${error.message}, fatal=${error.isFatal}", error)
        emit("IVS_BROADCAST_ERROR", Arguments.createMap().apply {
            putString("code", error.error?.name ?: "BROADCAST_ERROR")
            putString("message", error.message)
            putBoolean("fatal", error.isFatal)
            putString("exception", error.javaClass.simpleName)
            putString("details", error.toString())
            error.cause?.let { cause ->
                putString("cause", cause.message ?: cause.toString())
                putString("causeException", cause.javaClass.simpleName)
            }
        })
    }

    companion object {
        private var sharedInstance: IVSBroadcastModule? = null
        private var safeVideoConfigCtorLogged: Boolean = false
        @Volatile
        var viewerRenderGeneration: Int = 0
            private set

        private fun bumpViewerRenderGeneration() {
            viewerRenderGeneration += 1
        }

        fun setInstance(instance: IVSBroadcastModule) {
            sharedInstance = instance
        }

        fun setRenderSurface(surface: Surface?, width: Int, height: Int) {
            Log.w(IVS_TAG, "[IVS_SURFACE] Deprecated setRenderSurface called; routing to host surface")
            setHostRenderSurface(surface, width, height)
        }

        fun setHostRenderSurface(surface: Surface?, width: Int, height: Int) {
            val instance = sharedInstance
            val hash = surface?.let { "0x${Integer.toHexString(System.identityHashCode(it))}" } ?: "null"
            val ready = surface != null && surface.isValid && width > 0 && height > 0
            val hasSurface = surface != null
            val hasLocalStream = instance?.localVideoStream != null
            val stageJoined = instance?.stage != null
            Log.i(
                "IVS_SURFACE",
                "LOG: IVS_SURFACE HOST surface_set ready=$ready hasSurface=$hasSurface hasLocalStream=$hasLocalStream stageJoined=$stageJoined"
            )
            instance?.logCallTrace("setHostRenderSurface", surface = surface)
            Log.d(IVS_TAG, "[IVS_SURFACE] Setting HOST render surface: ${if (surface != null) "valid" else "null"} ${width}x${height} surfaceHash=$hash")
            if (instance == null) {
                Log.e(IVS_TAG, "[IVS_SURFACE] ERROR: sharedInstance is null! IVSBroadcastModule not initialized yet")
                return
            }
            // Allow caching in NONE/HOST; reject in VIEWER to prevent viewer paths from mutating host state.
            if (instance.sessionMode == SessionMode.VIEWER) {
                Log.w(IVS_TAG, "[IVS_BIND][HOST][GUARD] Ignoring host surface set while mode=${instance.sessionMode}")
                return
            }
            instance.updateHostRenderSurface(surface, width, height)
        }

        fun setViewerRenderSurface(surface: Surface?, width: Int, height: Int) {
            Log.w(IVS_TAG, "[IVS_SURFACE] Shared viewer surface path disabled; call setViewerSlotSurface instead")
        }

        fun setViewerRenderSurfaceForStream(streamKey: String, surface: Surface?, width: Int, height: Int) {
            Log.w(IVS_TAG, "[IVS_SURFACE] Per-stream binding deprecated; call setViewerSlotSurface")
        }

        fun setViewerSlotSurface(slotId: Int, surface: Surface?, width: Int, height: Int) {
            val instance = sharedInstance
            val hash = surface?.let { "0x${Integer.toHexString(System.identityHashCode(it))}" } ?: "null"
            instance?.logCallTrace("setViewerSlotSurface", slotId, surface)
            Log.d(IVS_TAG, "[IVS_SLOT] setViewerSlotSurface slot=$slotId surface=${surface != null} size=${width}x${height} surfaceHash=$hash")
            if (instance == null) {
                Log.e(IVS_TAG, "[IVS_SURFACE] ERROR: sharedInstance is null! IVSBroadcastModule not initialized yet")
                return
            }
            if (instance.sessionMode != SessionMode.VIEWER && instance.sessionMode != SessionMode.HOST && instance.sessionMode != SessionMode.GUEST) {
                Log.w(IVS_TAG, "[IVS_BIND][VIEWER_SLOT][GUARD] Ignoring viewer slot set while mode=${instance.sessionMode} slot=$slotId")
                return
            }

            instance.updateViewerRenderSurfaceForSlot(slotId, surface, width, height)
        }

        fun clearViewerSlotSurface(slotId: Int) {
            val instance = sharedInstance
            instance?.logCallTrace("clearViewerSlotSurface", slotId, null)
            if (instance == null) {
                Log.e(IVS_TAG, "[IVS_SURFACE] ERROR: sharedInstance is null! IVSBroadcastModule not initialized yet")
                return
            }
            if (instance.sessionMode != SessionMode.VIEWER && instance.sessionMode != SessionMode.HOST && instance.sessionMode != SessionMode.GUEST) {
                Log.w(IVS_TAG, "[IVS_BIND][VIEWER_SLOT][GUARD] Ignoring viewer slot clear while mode=${instance.sessionMode} slot=$slotId")
                return
            }
            instance.updateViewerRenderSurfaceForSlot(slotId, null, 0, 0)
        }

        fun clearViewerSlotSurfaceImmediately(slotId: Int, reason: String) {
            val instance = sharedInstance
            instance?.logCallTrace("clearViewerSlotSurfaceImmediately", slotId, null)
            if (instance == null) {
                Log.e(IVS_TAG, "[IVS_SURFACE] ERROR: sharedInstance is null! IVSBroadcastModule not initialized yet")
                return
            }
            if (instance.sessionMode != SessionMode.VIEWER && instance.sessionMode != SessionMode.HOST && instance.sessionMode != SessionMode.GUEST) {
                Log.w(
                    IVS_TAG,
                    "[IVS_BIND][VIEWER_SLOT][GUARD] Ignoring viewer slot immediate clear while mode=${instance.sessionMode} slot=$slotId"
                )
                return
            }
            instance.clearSlotSurfaceImmediately(slotId, reason)
        }

        fun getCurrentSessionId(): String? {
            return sharedInstance?.currentSessionId
        }

        fun getViewerParticipantId(): String? {
            return sharedInstance?.viewerParticipantId
        }

    }

    private fun configureStageForRendering(reason: String? = null) {
        logBindingState("configureStageForRendering-${reason ?: "n/a"}")
        if (renderOwner == RenderOwner.NONE) {
            Log.d(IVS_TAG, "[IVS_SURFACE] No render owner set; skipping configure (${reason ?: "no-reason"})")
            return
        }

        val surfaceConfig = activeRenderSurface()
        if (renderOwner == RenderOwner.VIEWER_REMOTE) {
            val anySlot = slotSurfaces.isNotEmpty()
            Log.d(IVS_TAG, "[IVS_SURFACE][VIEWER] configureStageForRendering reason=${reason ?: "n/a"} slots=${slotSurfaces.size}")
            emit("IVS_SURFACE_READY", Arguments.createMap().apply {
                putBoolean("ready", anySlot)
                putInt("width", surfaceConfig?.width ?: 0)
                putInt("height", surfaceConfig?.height ?: 0)
            })
            return
        }

        if (surfaceConfig?.surface == null) {
            when (renderOwner) {
                RenderOwner.HOST_PREVIEW -> {
                    // Surface can be destroyed/recreated (rotation, re-render). Keep the target registry
                    // so we can reattach when a new surface arrives.
                    Log.d(IVS_TAG, "[IVS_SURFACE][HOST] Surface lost (${reason ?: "no-reason"}); clearing surfaces only")
                    clearHostPreviewSurfacesOnly("surface-lost:${reason ?: "n/a"}")
                }
                else -> {
                    Log.d(IVS_TAG, "[IVS_SURFACE] Surface null with no owner (${reason ?: "no-reason"})")
                }
            }
            return
        }
        
        if (stage == null) {
            Log.d(IVS_TAG, "[IVS_SURFACE] Stage is null, will configure when stage is created (${reason ?: "no-reason"})")
            return
        }

        mainHandler.post {
            try {
                if (renderOwner == RenderOwner.HOST_PREVIEW && sessionMode != SessionMode.HOST && sessionMode != SessionMode.GUEST) {
                    Log.d(IVS_TAG, "[IVS_SURFACE] Skipping configure: owner=HOST_PREVIEW but sessionMode=$sessionMode")
                    return@post
                }
                if (renderOwner == RenderOwner.VIEWER_REMOTE && sessionMode != SessionMode.VIEWER) {
                    Log.d(IVS_TAG, "[IVS_SURFACE] Skipping configure: owner=VIEWER_REMOTE but sessionMode=$sessionMode")
                    return@post
                }

                if (renderOwner == RenderOwner.HOST_PREVIEW) {
                    Log.d(IVS_TAG, "[IVS_SURFACE] Configuring host surface ${surfaceConfig.width}x${surfaceConfig.height} (reason=${reason ?: "n/a"})")
                    Log.d(IVS_TAG, "[IVS_SURFACE] Attaching host surface to ${hostPreviewTargets.size} preview targets")
                    attachHostSurfaceToAllTargets()
                    Log.d(IVS_TAG, "[IVS_SURFACE] Host surface configuration complete for ${hostPreviewTargets.size} preview targets")
                } else {
                    Log.d(IVS_TAG, "[IVS_SURFACE][VIEWER] Surface ready signal emitted (reason=${reason ?: "n/a"}); per-stream binding handled separately")
                }
                emit("IVS_SURFACE_READY", Arguments.createMap().apply {
                    putBoolean("ready", true)
                    putInt("width", surfaceConfig.width)
                    putInt("height", surfaceConfig.height)
                })
            } catch (e: Exception) {
                Log.e(IVS_TAG, "[IVS_SURFACE] Error configuring surface: ${e.message}", e)
            }
        }
    }
}

