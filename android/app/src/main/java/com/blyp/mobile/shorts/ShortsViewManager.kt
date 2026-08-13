package com.blyp.mobile.shorts

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.common.MapBuilder
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class ShortsViewManager : SimpleViewManager<ShortsSurfaceView>() {
  override fun getName(): String = "BlypShortsView"

  override fun createViewInstance(reactContext: ThemedReactContext): ShortsSurfaceView {
    return ShortsSurfaceView(reactContext)
  }

  override fun onAfterUpdateTransaction(view: ShortsSurfaceView) {
    super.onAfterUpdateTransaction(view)
    view.commitProps()
  }

  @ReactProp(name = "uri")
  fun setUri(view: ShortsSurfaceView, uri: String?) {
    view.setSourceUri(uri)
  }

  @ReactProp(name = "playing", defaultBoolean = false)
  fun setPlaying(view: ShortsSurfaceView, playing: Boolean) {
    view.setPlaying(playing)
  }

  @ReactProp(name = "muted", defaultBoolean = true)
  fun setMuted(view: ShortsSurfaceView, muted: Boolean) {
    view.setMuted(muted)
  }

  // Named setFeedRole so we do not hide BaseViewManager.setRole.
  @ReactProp(name = "role")
  fun setFeedRole(view: ShortsSurfaceView, role: String?) {
    view.setRole(role)
  }

  /** When >= 0, seek that slot to ms (For You promote -> 0). Prop change only re-fires. */
  @ReactProp(name = "seekToMs", defaultInt = -1)
  fun setSeekToMs(view: ShortsSurfaceView, ms: Int) {
    if (ms >= 0) view.seekToMs(ms.toLong())
  }

  @ReactProp(name = "resizeMode")
  fun setResizeMode(view: ShortsSurfaceView, mode: String?) {
    view.applyResizeMode(mode)
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any>? {
    val map: MutableMap<String, Any> = HashMap()
    map.putAll(
      MapBuilder.builder<String, Any>()
        .put("onReady", MapBuilder.of("registrationName", "onReady"))
        .put("onFirstFrame", MapBuilder.of("registrationName", "onFirstFrame"))
        .put("onVideoSize", MapBuilder.of("registrationName", "onVideoSize"))
        .put("onError", MapBuilder.of("registrationName", "onError"))
        .build()
    )
    return map
  }

  override fun receiveCommand(root: ShortsSurfaceView, commandId: String?, args: ReadableArray?) {
    // no-op — props drive bind
  }
}
