package com.blyp.mobile.ivs

import android.net.Uri
import android.os.Handler
import android.os.Looper
import com.amazonaws.ivs.player.Player
import com.amazonaws.ivs.player.PlayerException
import com.amazonaws.ivs.player.PlayerView
import com.amazonaws.ivs.player.ResizeMode
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter

class IVSPlayerModule(
    private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    private val mainHandler = Handler(Looper.getMainLooper())
    private var player: Player? = null
    private var currentSessionId: String? = null

    init {
        reactContext.addLifecycleEventListener(this)
    }

    override fun getName(): String = "IVSPlayerModule"

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for React Native NativeEventEmitter.
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for React Native NativeEventEmitter.
    }

    override fun onHostResume() {
        // No-op for now; we let the UI decide whether to resume playback.
    }

    override fun onHostPause() {
        // Pause playback when the app host is backgrounded.
        player?.pause()
    }

    override fun onHostDestroy() {
        // Fully tear down the player when the app host is destroyed.
        mainHandler.post {
            player?.pause()
            player?.release()
            player = null
            sharedPlayer = null
        }
    }

    @ReactMethod
    fun joinAsViewer(
        playbackUrl: String?,
        sessionId: String,
        callback: Callback
    ) {
        mainHandler.post {
            try {
                // Viewers use IVS Player (HLS/low-latency playback).
                // playbackUrl MUST be provided by the backend /api/ivs/viewer-join endpoint.
                if (playbackUrl == null || playbackUrl.isEmpty()) {
                    callback.invoke(errorMap("MISSING_PLAYBACK_URL", "playbackUrl is required for viewer playback (check backend /api/ivs/viewer-join response)"))
                    return@post
                }

                ensurePlayer()
                currentSessionId = sessionId
                val uri = Uri.parse(playbackUrl)
                player?.load(uri)
                player?.play()
                emit("IVS_VIEWER_JOINED", Arguments.createMap().apply {
                    putString("sessionId", sessionId)
                    putString("playbackUrl", playbackUrl)
                })
                emit("IVS_PLAYER_STATE_CHANGED", Arguments.createMap().apply {
                    putString("state", player?.state?.name ?: "UNKNOWN")
                })
                callback.invoke()
            } catch (e: Exception) {
                callback.invoke(errorMap("VIEWER_JOIN_FAILED", e.message ?: "Failed to join viewer"))
            }
        }
    }

    @ReactMethod
    fun leaveAsViewer(callback: Callback) {
        mainHandler.post {
            try {
                player?.pause()
                emit("IVS_VIEWER_LEFT", Arguments.createMap().apply {
                    putString("sessionId", currentSessionId)
                    putString("reason", "leave")
                })
                callback.invoke()
            } catch (e: Exception) {
                callback.invoke(errorMap("VIEWER_LEAVE_FAILED", e.message ?: "Failed to leave viewer"))
            }
        }
    }

    @ReactMethod
    fun play(callback: Callback) {
        mainHandler.post {
            try {
                ensurePlayer()
                player?.play()
                emit("IVS_PLAYER_STATE_CHANGED", Arguments.createMap().apply {
                    putString("state", player?.state?.name ?: "UNKNOWN")
                })
                callback.invoke()
            } catch (e: Exception) {
                callback.invoke(errorMap("PLAY_FAILED", e.message ?: "Failed to play"))
            }
        }
    }

    @ReactMethod
    fun pause(callback: Callback) {
        mainHandler.post {
            try {
                player?.pause()
                emit("IVS_PLAYER_STATE_CHANGED", Arguments.createMap().apply {
                    putString("state", player?.state?.name ?: "UNKNOWN")
                })
                callback.invoke()
            } catch (e: Exception) {
                callback.invoke(errorMap("PAUSE_FAILED", e.message ?: "Failed to pause"))
            }
        }
    }

    @ReactMethod
    fun stop(callback: Callback) {
        mainHandler.post {
            try {
                player?.pause()
                player?.release()
                player = null
                sharedPlayer = null
                emit("IVS_VIEWER_LEFT", Arguments.createMap().apply {
                    putString("sessionId", currentSessionId)
                    putString("reason", "stop")
                })
                callback.invoke()
            } catch (e: Exception) {
                callback.invoke(errorMap("STOP_FAILED", e.message ?: "Failed to stop"))
            }
        }
    }

    private fun ensurePlayer() {
        if (player != null) return
        val created = Player.Factory.create(reactApplicationContext)
        created.addListener(playerListener)
        created.setLiveLowLatencyEnabled(true)
        player = created
        sharedPlayer = created
    }

    private val playerListener: Player.Listener = object : Player.Listener() {
        override fun onStateChanged(state: Player.State) {
            emit("IVS_PLAYER_STATE_CHANGED", Arguments.createMap().apply {
                putString("state", state.name)
                putString("sessionId", currentSessionId)
            })
            emitNetworkQuality()
        }

        override fun onError(exception: PlayerException) {
            emit("IVS_PLAYER_ERROR", Arguments.createMap().apply {
                putString("code", "PLAYER_ERROR")
                putString("message", exception.message)
                putBoolean("fatal", true)
            })
        }

        override fun onDurationChanged(duration: Long) {
            emit("IVS_PLAYER_DURATION_CHANGED", Arguments.createMap().apply {
                putDouble("duration", duration.toDouble())
            })
        }

        override fun onVideoSizeChanged(width: Int, height: Int) {
            emit("IVS_PLAYER_VIDEO_SIZE_CHANGED", Arguments.createMap().apply {
                putInt("width", width)
                putInt("height", height)
            })
        }

        override fun onCue(cue: com.amazonaws.ivs.player.Cue) {
            // optional analytics hook
        }

        override fun onRebuffering() {
            emit("IVS_PLAYER_STATE_CHANGED", Arguments.createMap().apply {
                putString("state", Player.State.BUFFERING.name)
            })
        }

        override fun onSeekCompleted(position: Long) {
            // no-op
        }

        override fun onQualityChanged(quality: com.amazonaws.ivs.player.Quality) {
            emit("IVS_PLAYER_QUALITY_CHANGED", Arguments.createMap().apply {
                putString("name", quality.name)
                putInt("bitrate", quality.bitrate)
            })
            emitNetworkQuality()
        }

        override fun onVideoFirstFrame(position: Long) {
            emit("IVS_PLAYER_FIRST_FRAME", Arguments.createMap())
        }
    }

    private fun emitNetworkQuality() {
        val stats = player?.statistics
        if (stats != null) {
            emit("IVS_PLAYER_NETWORK_QUALITY_UPDATED", Arguments.createMap().apply {
                putBoolean("isLocal", false)
            })
        }
    }

    private fun emit(event: String, map: WritableMap = Arguments.createMap()) {
        reactApplicationContext
            .getJSModule(RCTDeviceEventEmitter::class.java)
            .emit(event, map)
    }

    private fun errorMap(code: String, message: String): WritableMap =
        Arguments.createMap().apply {
            putString("code", code)
            putString("message", message)
        }

    companion object {
        @JvmStatic
        internal var sharedPlayer: Player? = null

        @JvmStatic
        internal fun attachPlayerView(view: PlayerView) {
            view.setControlsEnabled(false)
            view.setCaptionsEnabled(false)
            view.resizeMode = ResizeMode.FIT
        }
    }
}
