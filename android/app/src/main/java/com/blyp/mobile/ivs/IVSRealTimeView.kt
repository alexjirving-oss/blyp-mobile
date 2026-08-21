package com.blyp.mobile.ivs

import android.content.Context
import android.graphics.Color
import android.util.Log
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import com.amazonaws.ivs.broadcast.ImagePreviewView
import com.blyp.mobile.BuildConfig

/**
 * Viewer tile for an IVS Real-Time remote stream.
 *
 * Homemade TextureView + ImagePreviewSurfaceTarget.setSurface (1.0.109–110)
 * showed ~1 HD keyframe/sec while the same Stage looked smooth on web
 * `<video>`. Amazon's SDK TextureView (`getPreviewTextureView`) owns the
 * SurfaceTexture lifecycle and buffer size. Keep this as a FrameLayout so
 * React Native overlays still composite on top (SurfaceView punches a hole).
 */
class IVSRealTimeView(context: Context) : FrameLayout(context) {
    private var slotId: Int = -1
    private var participantId: String? = null
    private var remoteTrackCount: Int = 0
    private var zoom: Float = 1.0f
    private var sdkPreview: ImagePreviewView? = null

    init {
        setBackgroundColor(Color.BLACK)
        clipChildren = true
        clipToPadding = true
        clipToOutline = true
        Log.i("IVS_PROOF", "[VIEW_INIT] type=SdkPreviewHost")
    }

    fun currentPreview(): ImagePreviewView? = sdkPreview

    fun attachSdkPreview(preview: ImagePreviewView) {
        if (sdkPreview === preview && preview.parent === this) {
            applyZoomTransform("alreadyAttached")
            return
        }
        detachSdkPreview()
        (preview.parent as? ViewGroup)?.removeView(preview)
        try {
            preview.setMirrored(false)
        } catch (_: Throwable) {
            // ignore
        }
        sdkPreview = preview
        val lp = LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
            Gravity.CENTER,
        )
        addView(preview, lp)
        applyZoomTransform("sdkPreviewAttached")
        FirstFrameProbe.markAttach(
            "viewer",
            "sdkPreviewTextureView slot=$slotId preview=${preview.javaClass.simpleName}",
        )
        FirstFrameProbe.startPixelCopyProbe(this, "viewer", slotId)
        if (BuildConfig.DEBUG) {
            Log.i(
                "IVS_PROOF",
                "[ATTACH_EXEC] reason=sdkPreview slot=$slotId pid=$participantId tracks=$remoteTrackCount",
            )
        }
    }

    fun detachSdkPreview() {
        val preview = sdkPreview ?: return
        if (preview.parent === this) {
            removeView(preview)
        }
        sdkPreview = null
    }

    fun setSlotId(id: Int) {
        if (slotId == id) return
        if (slotId >= 0) {
            IVSBroadcastModule.unregisterViewerSlotView(slotId, this)
        }
        detachSdkPreview()
        slotId = id
        if (isAttachedToWindow && slotId >= 0) {
            IVSBroadcastModule.registerViewerSlotView(slotId, this)
        }
    }

    fun setParticipantId(id: String?) {
        if (participantId == id) return
        participantId = id
    }

    fun setRemoteTrackCount(count: Int) {
        if (remoteTrackCount == count) return
        remoteTrackCount = count
    }

    fun setZoom(value: Float) {
        val next = if (value.isFinite() && value > 0f) value else 1.0f
        if (zoom == next) return
        zoom = next
        applyZoomTransform("zoomChanged")
    }

    private fun applyZoomTransform(reason: String) {
        val preview = sdkPreview ?: return
        val z = if (zoom.isFinite() && zoom > 0f) zoom else 1.0f
        preview.scaleX = z
        preview.scaleY = z
        if (BuildConfig.DEBUG) {
            Log.i(
                "IVS_PROOF",
                "[ZOOM_APPLIED] reason=$reason slot=$slotId zoom=$z size=${width}x${height}",
            )
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (slotId >= 0) {
            IVSBroadcastModule.registerViewerSlotView(slotId, this)
        }
    }

    override fun onDetachedFromWindow() {
        if (slotId >= 0) {
            IVSBroadcastModule.unregisterViewerSlotView(slotId, this)
        }
        detachSdkPreview()
        super.onDetachedFromWindow()
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        val preview = sdkPreview ?: return
        preview.pivotX = preview.width / 2f
        preview.pivotY = preview.height / 2f
        if (changed) applyZoomTransform("layout")
    }
}
