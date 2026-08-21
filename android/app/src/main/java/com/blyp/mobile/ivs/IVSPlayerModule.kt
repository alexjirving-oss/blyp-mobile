package com.blyp.mobile.ivs

import android.graphics.SurfaceTexture
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.Surface
import com.amazonaws.ivs.player.Player
import com.amazonaws.ivs.player.PlayerException
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
    private val loudspeakerController =
        LiveLoudspeakerController(reactContext, "IVS_PLAYER_AUDIO")
    private var player: Player? = null
    private var currentSessionId: String? = null
    private var listenerAttached: Boolean = false

    init {
        reactContext.addLifecycleEventListener(this)
        setInstance(this)
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
        loudspeakerController.forceActive("player-host-resume")
        player?.play()
    }

    override fun onHostPause() {
        player?.pause()
    }

    override fun onHostDestroy() {
        mainHandler.post {
            loudspeakerController.stop("player-host-destroy")
            releasePlayer()
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
                if (playbackUrl == null || playbackUrl.isEmpty()) {
                    callback.invoke(
                        errorMap(
                            "MISSING_PLAYBACK_URL",
                            "playbackUrl is required for viewer playback",
                        )
                    )
                    return@post
                }

                loudspeakerController.start(
                    LiveLoudspeakerController.Profile.PLAYBACK,
                    "player-before-load",
                )
                currentSessionId = sessionId
                ensurePlayer()
                bindSurfaceToPlayer()
                val uri = Uri.parse(playbackUrl)
                player?.load(uri)
                player?.play()
                loudspeakerController.forceActive("player-after-play")
                emit("IVS_VIEWER_JOINED", Arguments.createMap().apply {
                    putString("sessionId", sessionId)
                    putString("playbackUrl", playbackUrl)
                })
                emit("IVS_PLAYER_STATE_CHANGED", Arguments.createMap().apply {
                    putString("state", player?.state?.name ?: "UNKNOWN")
                })
                callback.invoke()
            } catch (e: Throwable) {
                callback.invoke(errorMap("VIEWER_JOIN_FAILED", e.message ?: "Failed to join viewer"))
            }
        }
    }

    @ReactMethod
    fun leaveAsViewer(callback: Callback) {
        mainHandler.post {
            try {
                player?.pause()
                loudspeakerController.stop("player-viewer-leave")
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
                loudspeakerController.start(
                    LiveLoudspeakerController.Profile.PLAYBACK,
                    "player-play",
                )
                ensurePlayer()
                bindSurfaceToPlayer()
                player?.play()
                loudspeakerController.forceActive("player-play-returned")
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
                loudspeakerController.stop("player-stop")
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
    fun forceLiveLoudspeaker(reason: String, callback: Callback) {
        mainHandler.post {
            try {
                loudspeakerController.force(
                    LiveLoudspeakerController.Profile.PLAYBACK,
                    "js:$reason",
                )
                callback.invoke()
            } catch (e: Exception) {
                callback.invoke(
                    errorMap(
                        "FORCE_LOUDSPEAKER_FAILED",
                        e.message ?: "Failed to force viewer loudspeaker",
                    )
                )
            }
        }
    }

    @ReactMethod
    fun stop(callback: Callback) {
        mainHandler.post {
            try {
                loudspeakerController.stop("player-stop")
                releasePlayer()
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
        created.setLiveLowLatencyEnabled(true)
        try {
            created.setRebufferToLive(true)
        } catch (_: Throwable) {
            // older player builds
        }
        created.addListener(playerListener)
        listenerAttached = true
        player = created
        sharedPlayer = created
        bindSurfaceToPlayer()
    }

    private fun bindSurfaceToPlayer() {
        val p = player ?: return
        p.setSurface(videoSurface)
    }

    private fun releasePlayer() {
        try {
            player?.setSurface(null)
        } catch (_: Exception) {
        }
        try {
            if (listenerAttached) {
                player?.removeListener(playerListener)
            }
        } catch (_: Exception) {
        }
        listenerAttached = false
        try {
            player?.pause()
            player?.release()
        } catch (_: Exception) {
        }
        player = null
        sharedPlayer = null
        currentSessionId = null
    }

    private val playerListener: Player.Listener = object : Player.Listener() {
        override fun onStateChanged(state: Player.State) {
            val name = state.name
            mainHandler.post {
                if (state == Player.State.READY || state == Player.State.PLAYING) {
                    loudspeakerController.forceActive("player-state-${name.lowercase()}")
                }
                emit("IVS_PLAYER_STATE_CHANGED", Arguments.createMap().apply {
                    putString("state", name)
                    putString("sessionId", currentSessionId)
                })
            }
        }

        override fun onError(exception: PlayerException) {
            val message = exception.message
            mainHandler.post {
                emit("IVS_PLAYER_ERROR", Arguments.createMap().apply {
                    putString("code", "PLAYER_ERROR")
                    putString("message", message)
                    putBoolean("fatal", true)
                })
            }
        }

        override fun onDurationChanged(duration: Long) {
            // unused
        }

        override fun onVideoSizeChanged(width: Int, height: Int) {
            mainHandler.post {
                emit("IVS_PLAYER_VIDEO_SIZE_CHANGED", Arguments.createMap().apply {
                    putInt("width", width)
                    putInt("height", height)
                })
            }
        }

        override fun onCue(cue: com.amazonaws.ivs.player.Cue) {
            // unused
        }

        override fun onRebuffering() {
            mainHandler.post {
                emit("IVS_PLAYER_STATE_CHANGED", Arguments.createMap().apply {
                    putString("state", Player.State.BUFFERING.name)
                })
            }
        }

        override fun onSeekCompleted(position: Long) {
            // no-op
        }

        override fun onQualityChanged(quality: com.amazonaws.ivs.player.Quality) {
            val qualityName = quality.name
            val bitrate = quality.bitrate
            mainHandler.post {
                emit("IVS_PLAYER_QUALITY_CHANGED", Arguments.createMap().apply {
                    putString("name", qualityName)
                    putInt("bitrate", bitrate)
                })
            }
        }

        override fun onVideoFirstFrame(position: Long) {
            mainHandler.post {
                loudspeakerController.forceActive("player-first-frame")
                emit("IVS_PLAYER_FIRST_FRAME", Arguments.createMap())
            }
        }
    }

    private fun emit(event: String, map: WritableMap = Arguments.createMap()) {
        try {
            if (!reactApplicationContext.hasActiveReactInstance()) return
            reactApplicationContext
                .getJSModule(RCTDeviceEventEmitter::class.java)
                .emit(event, map)
        } catch (_: Exception) {
        }
    }

    private fun errorMap(code: String, message: String): WritableMap =
        Arguments.createMap().apply {
            putString("code", code)
            putString("message", message)
        }

    companion object {
        @Volatile
        private var moduleInstance: IVSPlayerModule? = null

        @JvmStatic
        internal var sharedPlayer: Player? = null

        @Volatile
        private var videoSurface: Surface? = null

        private fun setInstance(instance: IVSPlayerModule) {
            moduleInstance = instance
        }

        @JvmStatic
        fun setRenderSurface(surfaceTexture: SurfaceTexture?, @Suppress("UNUSED_PARAMETER") width: Int, @Suppress("UNUSED_PARAMETER") height: Int) {
            val apply = Runnable {
                try {
                    sharedPlayer?.setSurface(null)
                    moduleInstance?.player?.setSurface(null)
                } catch (_: Exception) {
                }
                try {
                    videoSurface?.release()
                } catch (_: Exception) {
                }
                videoSurface = if (surfaceTexture != null) Surface(surfaceTexture) else null
                moduleInstance?.bindSurfaceToPlayer()
                    ?: sharedPlayer?.setSurface(videoSurface)
            }
            if (Looper.myLooper() == Looper.getMainLooper()) {
                apply.run()
            } else {
                Handler(Looper.getMainLooper()).post(apply)
            }
        }
    }
}
