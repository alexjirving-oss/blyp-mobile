package com.blyp.mobile.shorts

import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.view.Gravity
import android.view.Surface
import android.view.TextureView
import android.widget.FrameLayout
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.events.RCTEventEmitter

/** TextureView host for BlypShorts — first frame always reveals (no poster-forever). */
class ShortsSurfaceView(context: android.content.Context) : FrameLayout(context),
  TextureView.SurfaceTextureListener {

  private val textureView = TextureView(context)
  var surface: Surface? = null
    private set
  private var slotIndex: Int = -1
  private var resizeMode: String = "contain"
  private var videoW: Int = 0
  private var videoH: Int = 0
  private var uri: String = ""
  private var playing: Boolean = false
  private var muted: Boolean = true
  private var role: String = "neighbor"
  private var hasFirstFrame: Boolean = false

  init {
    ShortsPool.init(context)
    textureView.surfaceTextureListener = this
    textureView.alpha = 0f
    addView(
      textureView,
      LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT, Gravity.CENTER),
    )
  }

  fun attachSlot(index: Int) {
    slotIndex = index
  }

  fun setSourceUri(next: String?) {
    uri = next?.trim().orEmpty()
    videoW = 0
    videoH = 0
    hasFirstFrame = false
    textureView.alpha = 0f
    rebind()
  }

  fun setPlaying(value: Boolean) {
    playing = value
    ShortsPool.updatePlayback(this, playing, muted, role)
  }

  fun setMuted(value: Boolean) {
    muted = value
    ShortsPool.updatePlayback(this, playing, muted, role)
  }

  fun setRole(value: String?) {
    role = if (value == "active") "active" else "neighbor"
    ShortsPool.updatePlayback(this, playing, muted, role)
  }

  fun seekToMs(ms: Long) {
    ShortsPool.seekView(this, ms.coerceAtLeast(0L))
  }

  fun applyResizeMode(mode: String?) {
    // Fit inside fixed MATCH_PARENT host — never change parent layout params.
    resizeMode = if (mode.equals("cover", ignoreCase = true)) "cover" else "contain"
    applyTransform()
  }

  private fun rebind() {
    if (uri.isEmpty()) {
      ShortsPool.unbind(this)
      return
    }
    ShortsPool.bind(this, uri, playing, muted, role, resizeMode)
  }

  override fun onSurfaceTextureAvailable(st: SurfaceTexture, width: Int, height: Int) {
    surface?.release()
    surface = Surface(st)
    ShortsPool.onSurfaceAvailable(this, surface!!)
    if (uri.isNotEmpty()) rebind()
    applyTransform()
  }

  override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, width: Int, height: Int) {
    applyTransform()
  }

  override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
    ShortsPool.onSurfaceDestroyed(this)
    surface?.release()
    surface = null
    return true
  }

  override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}

  fun emitReady() {
    dispatch("onReady", Arguments.createMap().apply {
      putString("uri", uri)
      putInt("slot", slotIndex)
    })
  }

  fun emitFirstFrame() {
    hasFirstFrame = true
    // Reveal only after transform is known so contain/cover doesn't jump post-show.
    if (videoW > 0 && videoH > 0 && width > 0 && height > 0) {
      applyTransform()
    }
    dispatch("onFirstFrame", Arguments.createMap().apply {
      putString("uri", uri)
      putInt("slot", slotIndex)
    })
  }

  fun emitVideoSize(w: Int, h: Int) {
    videoW = w
    videoH = h
    applyTransform()
    dispatch("onVideoSize", Arguments.createMap().apply {
      putInt("width", w)
      putInt("height", h)
    })
  }

  fun emitError(code: String, message: String) {
    dispatch("onError", Arguments.createMap().apply {
      putString("code", code)
      putString("message", message)
      putString("uri", uri)
    })
  }

  private fun dispatch(event: String, payload: com.facebook.react.bridge.WritableMap) {
    val reactContext = context as? ReactContext ?: return
    reactContext.getJSModule(RCTEventEmitter::class.java).receiveEvent(id, event, payload)
  }

  private fun applyTransform() {
    if (videoW <= 0 || videoH <= 0 || width <= 0 || height <= 0) {
      if (!hasFirstFrame) textureView.alpha = 0f
      return
    }
    val viewW = width.toFloat()
    val viewH = height.toFloat()
    val videoAspect = videoW.toFloat() / videoH.toFloat()
    val viewAspect = viewW / viewH
    val matrix = Matrix()
    val scaleX: Float
    val scaleY: Float
    // Matrix scales TextureView content inside a fixed parent — never requestLayout.
    if (resizeMode == "cover") {
      if (videoAspect > viewAspect) {
        scaleX = videoAspect / viewAspect
        scaleY = 1f
      } else {
        scaleX = 1f
        scaleY = viewAspect / videoAspect
      }
    } else {
      // contain
      if (videoAspect > viewAspect) {
        scaleX = 1f
        scaleY = viewAspect / videoAspect
      } else {
        scaleX = videoAspect / viewAspect
        scaleY = 1f
      }
    }
    matrix.setScale(scaleX, scaleY, viewW / 2f, viewH / 2f)
    textureView.setTransform(matrix)
    if (hasFirstFrame) textureView.alpha = 1f
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    if (changed) applyTransform()
  }

  override fun onDetachedFromWindow() {
    ShortsPool.unbind(this)
    super.onDetachedFromWindow()
  }
}
