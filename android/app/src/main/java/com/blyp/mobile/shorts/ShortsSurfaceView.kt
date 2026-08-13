package com.blyp.mobile.shorts

import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.util.Log
import android.view.Gravity
import android.view.Surface
import android.view.TextureView
import android.widget.FrameLayout
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.events.RCTEventEmitter

/**
 * TextureView host for BlypShorts.
 * ExoPlayer VIDEO_SCALING_MODE does not apply to TextureView — cover is a Matrix.
 *
 * 1.0.85 hid the TextureView (alpha=0) until aspectReady. On Fold that punches a
 * black hole over the poster (TextureView does not composite as transparent) —
 * the complete opposite of stretch→correct. Fix: keep alpha=1, apply provisional
 * 9:16 cover from view size before the first frame, refine on real videoSize,
 * and let JS keep the poster above until onFirstFrame.
 */
class ShortsSurfaceView(context: android.content.Context) : FrameLayout(context),
  TextureView.SurfaceTextureListener {

  companion object {
    private const val TAG = "BlypShorts"
    /** Short-form default until Exo reports natural size. */
    private const val PROVISIONAL_W = 9
    private const val PROVISIONAL_H = 16
  }

  private val textureView = TextureView(context)
  var surface: Surface? = null
    private set
  private var slotIndex: Int = -1
  private var uri: String = ""
  private var playing: Boolean = false
  private var muted: Boolean = true
  private var role: String = "neighbor"
  private var firstFrameDispatched: Boolean = false
  private var propsDirty: Boolean = false
  private var videoW: Int = 0
  private var videoH: Int = 0
  /** True once a cover matrix (provisional or real) is applied for current layout. */
  private var coverApplied: Boolean = false

  init {
    ShortsPool.init(context)
    textureView.surfaceTextureListener = this
    // Never alpha=0 — TextureView hide punches black over the RN poster.
    textureView.alpha = 1f
    addView(
      textureView,
      LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT, Gravity.CENTER),
    )
  }

  fun attachSlot(index: Int) {
    slotIndex = index
  }

  fun setSourceUri(next: String?) {
    val trimmed = next?.trim().orEmpty()
    if (trimmed == uri) return
    uri = trimmed
    firstFrameDispatched = false
    videoW = 0
    videoH = 0
    coverApplied = false
    applyCoverTransform(provisional = true)
    markDirty()
  }

  fun setPlaying(value: Boolean) {
    if (playing == value) return
    playing = value
    markDirty()
  }

  fun setMuted(value: Boolean) {
    if (muted == value) return
    muted = value
    markDirty()
  }

  fun setRole(value: String?) {
    val next = if (value == "active") "active" else "neighbor"
    if (role == next) return
    role = next
    markDirty()
  }

  fun seekToMs(ms: Long) {
    ShortsPool.seekView(this, ms.coerceAtLeast(0L))
  }

  fun applyResizeMode(@Suppress("UNUSED_PARAMETER") mode: String?) {
    applyCoverTransform(provisional = videoW <= 0 || videoH <= 0)
  }

  /** Called from ShortsPool when ExoPlayer reports natural video size. */
  fun onVideoSize(width: Int, height: Int) {
    if (width <= 0 || height <= 0) return
    videoW = width
    videoH = height
    applyCoverTransform(provisional = false)
    emitVideoSize(width, height)
  }

  /**
   * Center-crop cover matrix for TextureView (content is stretch-filled by default).
   * Uses parent layout size (stable); falls back to textureView size.
   */
  private fun applyCoverTransform(provisional: Boolean) {
    val tw = when {
      width > 0 -> width
      textureView.width > 0 -> textureView.width
      else -> 0
    }
    val th = when {
      height > 0 -> height
      textureView.height > 0 -> textureView.height
      else -> 0
    }
    if (tw <= 0 || th <= 0) {
      coverApplied = false
      return
    }
    val vw: Int
    val vh: Int
    if (!provisional && videoW > 0 && videoH > 0) {
      vw = videoW
      vh = videoH
    } else {
      vw = PROVISIONAL_W
      vh = PROVISIONAL_H
    }
    val videoRatio = vw.toFloat() / vh.toFloat()
    val viewRatio = tw.toFloat() / th.toFloat()
    val matrix = Matrix()
    val scaleX: Float
    val scaleY: Float
    if (videoRatio > viewRatio) {
      // Video wider than view — crop sides.
      scaleX = videoRatio / viewRatio
      scaleY = 1f
    } else {
      // Video taller than view — crop top/bottom.
      scaleX = 1f
      scaleY = viewRatio / videoRatio
    }
    matrix.setScale(scaleX, scaleY, tw / 2f, th / 2f)
    textureView.setTransform(matrix)
    coverApplied = true
    if (provisional) {
      Log.i(TAG, "cover-provisional 9:16 view=${tw}x$th sx=$scaleX sy=$scaleY")
    } else {
      Log.i(TAG, "cover-real video=${vw}x$vh view=${tw}x$th sx=$scaleX sy=$scaleY")
    }
  }

  private fun markDirty() {
    propsDirty = true
  }

  /** Apply uri + playing + muted + role together after a RN prop batch. */
  fun commitProps() {
    if (!propsDirty) return
    propsDirty = false
    rebind()
  }

  private fun rebind() {
    if (uri.isEmpty()) {
      ShortsPool.unbind(this)
      return
    }
    // Same URI (neighbor→active promote): unmute/play only — never re-bind / seek.
    if (ShortsPool.hasBoundUri(this, uri) || (slotIndex >= 0 && ShortsPool.uriMatches(slotIndex, uri))) {
      ShortsPool.updatePlayback(this, playing, muted, role)
      return
    }
    ShortsPool.bind(this, uri, playing, muted, role, "cover")
  }

  override fun onSurfaceTextureAvailable(st: SurfaceTexture, width: Int, height: Int) {
    surface?.release()
    surface = Surface(st)
    ShortsPool.onSurfaceAvailable(this, surface!!)
    applyCoverTransform(provisional = videoW <= 0 || videoH <= 0)
    val alreadyBound =
      ShortsPool.hasBoundUri(this, uri) || (slotIndex >= 0 && ShortsPool.uriMatches(slotIndex, uri))
    if (uri.isNotEmpty() && !alreadyBound) {
      propsDirty = true
      commitProps()
    }
  }

  override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, width: Int, height: Int) {
    applyCoverTransform(provisional = videoW <= 0 || videoH <= 0)
  }

  override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
    ShortsPool.onSurfaceDestroyed(this)
    surface?.release()
    surface = null
    return true
  }

  override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    if (changed || !coverApplied) {
      applyCoverTransform(provisional = videoW <= 0 || videoH <= 0)
    }
  }

  fun emitReady() {
    dispatch("onReady", Arguments.createMap().apply {
      putString("uri", uri)
      putInt("slot", slotIndex)
    })
  }

  fun emitFirstFrame() {
    // Do not gate on aspectReady — provisional cover is already applied.
    // JS keeps poster above this surface until onFirstFrame.
    if (firstFrameDispatched) return
    if (!coverApplied) {
      applyCoverTransform(provisional = videoW <= 0 || videoH <= 0)
    }
    textureView.alpha = 1f
    firstFrameDispatched = true
    dispatch("onFirstFrame", Arguments.createMap().apply {
      putString("uri", uri)
      putInt("slot", slotIndex)
    })
  }

  fun emitVideoSize(w: Int, h: Int) {
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

  override fun onDetachedFromWindow() {
    ShortsPool.unbind(this)
    super.onDetachedFromWindow()
  }
}
