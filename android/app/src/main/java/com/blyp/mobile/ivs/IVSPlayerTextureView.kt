package com.blyp.mobile.ivs

import android.content.Context
import android.graphics.Color
import android.graphics.SurfaceTexture
import android.view.Gravity
import android.view.TextureView
import android.view.ViewGroup
import android.widget.FrameLayout

/**
 * Phone mass-watch host for IVS Player (HLS).
 *
 * React Native 0.81 cannot safely style a bare TextureView as the native view
 * root (process crash on mount). Shorts uses the same pattern: FrameLayout
 * parent, TextureView child. RN styles land on this FrameLayout; overlays
 * still composite on top of TextureView.
 *
 * Do not rebind on size ticks — that class was the Stage slideshow.
 */
class IVSPlayerTextureView(context: Context) : FrameLayout(context), TextureView.SurfaceTextureListener {
    private val textureView = TextureView(context)

    init {
        setBackgroundColor(Color.BLACK)
        clipChildren = true
        clipToPadding = true
        textureView.isOpaque = true
        textureView.surfaceTextureListener = this
        addView(
            textureView,
            LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
                Gravity.CENTER,
            ),
        )
    }

    override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
        IVSPlayerModule.setRenderSurface(surface, width, height)
    }

    override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {
        // Keep the existing Surface.
    }

    override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
        IVSPlayerModule.setRenderSurface(null, 0, 0)
        return true
    }

    override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {
        // no-op — must not log or hop to JS per frame
    }
}
