package com.blyp.mobile.ivs

import android.util.Log
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.view.Surface
import android.view.TextureView
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import java.util.WeakHashMap

/**
 * IVSBroadcastViewManager
 * 
 * Provides a TextureView for rendering IVS Real-Time stage output.
 * TextureView is used to avoid SurfaceView's separate window layer (clipping/z-order issues in RN).
 */
class IVSBroadcastViewManager : SimpleViewManager<TextureView>() {

    private val zoomByView: WeakHashMap<TextureView, Float> = WeakHashMap()

    private fun sanitizeZoom(value: Float): Float {
        return if (value.isFinite() && value > 0f) value else 1.0f
    }

    private fun applyZoomTransform(view: TextureView, zoom: Float, reason: String) {
        val w = view.width.toFloat()
        val h = view.height.toFloat()
        if (w <= 0f || h <= 0f) return

        val z = sanitizeZoom(zoom)
        val m = Matrix()
        m.setScale(z, z, w / 2f, h / 2f)
        view.setTransform(m)
        view.invalidate()
        Log.i(
            "IVS_PROOF",
            "[ZOOM_APPLIED][HOST_PREVIEW] reason=$reason zoom=$z size=${w.toInt()}x${h.toInt()}"
        )
    }
    
    override fun getName(): String = "IVSBroadcastView"

    override fun createViewInstance(reactContext: ThemedReactContext): TextureView {
        val textureView = TextureView(reactContext)

        Log.d("IVS_VIEW", "[ViewManager] Creating IVSBroadcastView TextureView")

        zoomByView[textureView] = 1.0f

        // Re-apply zoom after layout; RN can size the view after surface creation.
        textureView.addOnLayoutChangeListener { v, _, _, _, _, _, _, _, _ ->
            val tv = v as? TextureView ?: return@addOnLayoutChangeListener
            val z = zoomByView[tv] ?: 1.0f
            applyZoomTransform(tv, z, "layoutChanged")
        }

        var surface: Surface? = null
        var updateCount: Long = 0
        var lastUpdateLogMs: Long = 0
        val updateLogMinIntervalMs: Long = 1000L

        fun setSurfaceOrClear(w: Int, h: Int) {
            val s = surface
            if (s != null && s.isValid && w > 0 && h > 0) {
                IVSBroadcastModule.setHostRenderSurface(s, w, h)
            } else {
                IVSBroadcastModule.setHostRenderSurface(null, 0, 0)
            }
        }

        textureView.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
            override fun onSurfaceTextureAvailable(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
                Log.d("IVS_VIEW", "[Texture] available: ${width}x${height}")
                surfaceTexture.setDefaultBufferSize(width, height)
                try {
                    surface?.release()
                } catch (_: Exception) {
                    // ignore
                }
                surface = Surface(surfaceTexture)
                applyZoomTransform(textureView, zoomByView[textureView] ?: 1.0f, "surfaceAvailable")
                setSurfaceOrClear(width, height)
            }

            override fun onSurfaceTextureSizeChanged(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
                Log.d("IVS_VIEW", "[Texture] sizeChanged: ${width}x${height}")
                surfaceTexture.setDefaultBufferSize(width, height)
                applyZoomTransform(textureView, zoomByView[textureView] ?: 1.0f, "surfaceSizeChanged")
                setSurfaceOrClear(width, height)
            }

            override fun onSurfaceTextureDestroyed(surfaceTexture: SurfaceTexture): Boolean {
                Log.d("IVS_VIEW", "[Texture] destroyed")
                IVSBroadcastModule.setHostRenderSurface(null, 0, 0)
                try {
                    surface?.release()
                } catch (_: Exception) {
                    // ignore
                }
                surface = null
                updateCount = 0
                lastUpdateLogMs = 0
                return true
            }

            override fun onSurfaceTextureUpdated(surfaceTexture: SurfaceTexture) {
                updateCount += 1
                val now = android.os.SystemClock.elapsedRealtime()
                if (updateCount == 1L || now - lastUpdateLogMs >= updateLogMinIntervalMs) {
                    lastUpdateLogMs = now
                    Log.i(
                        "IVS_NATIVE",
                        "[IVS_TEXTURE_UPDATE][HOST] count=$updateCount size=${textureView.width}x${textureView.height} measured=${textureView.measuredWidth}x${textureView.measuredHeight}"
                    )
                }
            }
        }

        return textureView
    }

    @ReactProp(name = "zoom", defaultFloat = 1.0f)
    fun setZoom(view: TextureView, value: Float) {
        val z = sanitizeZoom(value)
        zoomByView[view] = z
        view.post { applyZoomTransform(view, z, "propChanged") }
    }

    override fun onDropViewInstance(view: TextureView) {
        Log.d("IVS_VIEW", "[ViewManager] Dropping IVSBroadcastView")
        IVSBroadcastModule.setHostRenderSurface(null, 0, 0)
        zoomByView.remove(view)
        super.onDropViewInstance(view)
    }
}
