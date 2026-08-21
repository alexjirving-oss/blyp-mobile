package com.blyp.mobile.ivs

import android.content.Context
import android.graphics.Color
import android.graphics.SurfaceTexture
import android.view.TextureView

/**
 * Phone mass-watch surface for IVS Player (HLS / low-latency HLS).
 *
 * Stage WebRTC on this screen starved the UI thread (slideshow video, 10s leave,
 * dead like button). Player decode is hardware and cheap. TextureView keeps RN
 * Studio overlays compositing on top — PlayerView is SurfaceView and punches a hole.
 *
 * Do not rebind [TextureView.SurfaceTextureListener.onSurfaceTextureSizeChanged];
 * that class of rebind was the Stage slideshow (1.0.109–110).
 */
class IVSPlayerTextureView(context: Context) : TextureView(context), TextureView.SurfaceTextureListener {
    init {
        isOpaque = true
        setBackgroundColor(Color.BLACK)
        surfaceTextureListener = this
    }

    override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
        IVSPlayerModule.setRenderSurface(surface, width, height)
    }

    override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {
        // Keep the existing Surface. Size-tick rebinds hitch the compositor.
    }

    override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
        IVSPlayerModule.setRenderSurface(null, 0, 0)
        return true
    }

    override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {
        // no-op — must not log or hop to JS per frame
    }
}
