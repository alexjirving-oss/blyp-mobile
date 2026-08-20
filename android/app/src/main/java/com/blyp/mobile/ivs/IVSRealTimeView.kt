package com.blyp.mobile.ivs

import android.content.Context
import android.graphics.Matrix
import android.util.Log
import android.view.Surface
import android.view.TextureView
import android.graphics.SurfaceTexture
import com.blyp.mobile.BuildConfig

/**
 * IVS Real-Time View
 *
 * Provides a TextureView that the IVS Stage renderer can draw into for viewer mode.
 * Mirrors the behaviour of IVSBroadcastViewManager but dedicated to viewer playback.
 *
 * NOTE:
 * We use TextureView instead of SurfaceView so transforms + clipping work reliably
 * (needed for guest-tile zoom / center-crop).
 */
class IVSRealTimeView(context: Context) : TextureView(context) {
    private var slotId: Int = 0
    private var surfaceReady: Boolean = false
    private var lastAttachedKey: String? = null
    private var participantId: String? = null
    private var remoteTrackCount: Int = 0
    private var zoom: Float = 1.0f
    private var currentSurface: Surface? = null

    private fun surfaceHash(surface: Surface?): String = surface?.let {
        "0x${Integer.toHexString(System.identityHashCode(it))}"
    } ?: "null"

    private fun attachKey(): String? {
        val sessionId = IVSBroadcastModule.getCurrentSessionId()
        val pid = participantId
        if (sessionId.isNullOrEmpty() || pid.isNullOrEmpty()) return null
        // Do NOT include remoteTrackCount: session-wide track totals change whenever
        // any guest joins/leaves and would force every tile to re-attach (flicker).
        return "$sessionId|$pid|$slotId|g${IVSBroadcastModule.viewerRenderGeneration}"
    }

    private fun attemptAttach(reason: String) {
        val surface = currentSurface
        val w = width
        val h = height
        val ready = surfaceReady && surface != null && surface.isValid && w > 0 && h > 0
        val layoutReady = isLaidOut
        val pid = participantId
        val key = attachKey()
        val tracks = remoteTrackCount

        val surfaceCreated = surfaceReady
        val streamAssigned = !pid.isNullOrBlank() && tracks > 0
        val didAttach = streamAssigned && ready && key != null && layoutReady && key != lastAttachedKey
        if (didAttach && BuildConfig.DEBUG) {
            Log.i(
                "IVS_TILE_ATTACH",
                "LOG: IVS_TILE_ATTACH slot=$slotId surfaceCreated=$surfaceCreated streamAssigned=$streamAssigned didAttach=$didAttach"
            )
        }

        if (pid.isNullOrBlank() || tracks <= 0) {
            return
        }

        if (!ready || key == null || !layoutReady) {
            return
        }

        if (key == lastAttachedKey) {
            return
        }

        if (BuildConfig.DEBUG) {
            Log.i("IVS_PROOF", "[ATTACH_EXEC] reason=$reason key=$key surfaceHash=${surfaceHash(surface)} size=${w}x${h}")
        }
        IVSBroadcastModule.setViewerSlotSurface(slotId, surface, w, h)
        FirstFrameProbe.markAttach("viewer", "setViewerSlotSurface slot=$slotId size=${w}x${h}")
        lastAttachedKey = key
        FirstFrameProbe.startPixelCopyProbe(this@IVSRealTimeView, "viewer", slotId)
    }

    fun setSlotId(id: Int) {
        if (slotId == id) return
        slotId = id
        lastAttachedKey = null
        // Keep surfaceReady: TextureView is still valid; clearing it without a
        // re-attach left tiles black until the next surface callback.
        FirstFrameProbe.reset("viewer slotId=$slotId")
        post { attemptAttach("slotIdChanged") }
    }

    fun setParticipantId(id: String?) {
        if (participantId == id) return
        participantId = id
        lastAttachedKey = null
        post { attemptAttach("participantChanged") }
    }

    fun setRemoteTrackCount(count: Int) {
        if (remoteTrackCount == count) return
        val wasAssignable = remoteTrackCount > 0
        remoteTrackCount = count
        // Only (re)attach when tracks first become available for this tile.
        // Mid-session global count bumps must not tear down a healthy attach.
        if (!wasAssignable && count > 0) {
            lastAttachedKey = null
            post { attemptAttach("trackCountBecamePositive") }
        } else if (wasAssignable && count <= 0) {
            lastAttachedKey = null
        }
    }

    fun setZoom(value: Float) {
        val next = if (value.isFinite() && value > 0f) value else 1.0f
        if (zoom == next) return
        zoom = next
        post { applyZoomTransform("zoomChanged") }
    }

    private fun applyZoomTransform(reason: String) {
        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0f || h <= 0f) return
        val m = Matrix()
        val z = if (zoom.isFinite() && zoom > 0f) zoom else 1.0f
        m.setScale(z, z, w / 2f, h / 2f)
        setTransform(m)
        invalidate()
        if (BuildConfig.DEBUG) {
            Log.i("IVS_PROOF", "[ZOOM_APPLIED] reason=$reason slot=$slotId zoom=$z size=${w.toInt()}x${h.toInt()}")
        }
    }

    init {
        surfaceTextureListener = object : SurfaceTextureListener {
            override fun onSurfaceTextureAvailable(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
                Log.d("IVS_REALTIME_VIEW", "Texture available ${width}x${height}")
                try {
                    surfaceTexture.setDefaultBufferSize(width, height)
                } catch (_: Throwable) {
                    // ignore
                }
                currentSurface?.release()
                currentSurface = Surface(surfaceTexture)
                surfaceReady = true
                lastAttachedKey = null
                FirstFrameProbe.markSurfaceReady(
                    "viewer",
                    "surfaceAvailable slot=$slotId size=${width}x${height} surfaceHash=${surfaceHash(currentSurface)}"
                )
                applyZoomTransform("surfaceAvailable")
                post { attemptAttach("surfaceAvailable") }
            }

            override fun onSurfaceTextureSizeChanged(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
                Log.d("IVS_REALTIME_VIEW", "Texture sizeChanged ${width}x${height}")
                try {
                    surfaceTexture.setDefaultBufferSize(width, height)
                } catch (_: Throwable) {
                    // ignore
                }
                surfaceReady = true
                applyZoomTransform("surfaceSizeChanged")
                // Do not clear lastAttachedKey: overlay/tray layout ticks used to
                // rebind EGL here and the Studio watch surface stalled then jumped.
                if (lastAttachedKey == null) {
                    post { attemptAttach("surfaceSizeChanged") }
                } else if (currentSurface != null && currentSurface!!.isValid) {
                    IVSBroadcastModule.setViewerSlotSurface(slotId, currentSurface, width, height)
                }
            }

            override fun onSurfaceTextureDestroyed(surfaceTexture: SurfaceTexture): Boolean {
                Log.d("IVS_REALTIME_VIEW", "Texture destroyed")
                surfaceReady = false
                lastAttachedKey = null
                IVSBroadcastModule.clearViewerSlotSurfaceImmediately(slotId, "textureDestroyed")
                try {
                    currentSurface?.release()
                } catch (_: Throwable) {
                    // ignore
                }
                currentSurface = null
                return true
            }

            override fun onSurfaceTextureUpdated(surfaceTexture: SurfaceTexture) {
                // no-op
            }
        }

        setWillNotDraw(false)
        Log.i("IVS_PROOF", "[VIEW_INIT] type=TextureView alpha=$alpha visibility=$visibility isShown=$isShown")
    }

    override fun onDetachedFromWindow() {
        // Detach as early as possible: waiting for SurfaceTextureDestroyed can be too late
        // (the IVS renderer may still touch the SurfaceTexture and crash with updateTexImage).
        surfaceReady = false
        lastAttachedKey = null
        IVSBroadcastModule.clearViewerSlotSurfaceImmediately(slotId, "viewDetached")
        super.onDetachedFromWindow()
    }
}
