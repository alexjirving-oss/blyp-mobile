package com.blyp.mobile.shorts

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap

class ShortsModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "BlypShorts"

  override fun initialize() {
    super.initialize()
    ShortsPool.init(reactApplicationContext)
  }

  @ReactMethod
  fun prefetchOpening(uri: String?, bytes: Double, promise: Promise) {
    val u = uri?.trim().orEmpty()
    if (u.isEmpty()) {
      promise.resolve(false)
      return
    }
    ShortsPool.init(reactApplicationContext)
    val n = if (bytes > 0) bytes.toLong() else 1_024_000L
    Thread {
      try {
        promise.resolve(ShortsPool.prefetchOpening(u, n))
      } catch (_: Throwable) {
        promise.resolve(false)
      }
    }.start()
  }

  @ReactMethod
  fun prefetchOpenings(uris: ReadableArray?, bytes: Double, promise: Promise) {
    ShortsPool.init(reactApplicationContext)
    val n = if (bytes > 0) bytes.toLong() else 1_024_000L
    Thread {
      var count = 0
      if (uris != null) {
        for (i in 0 until uris.size()) {
          val u = uris.getString(i)?.trim().orEmpty()
          if (u.isNotEmpty() && ShortsPool.prefetchOpening(u, n)) count += 1
        }
      }
      promise.resolve(count)
    }.start()
  }

  @ReactMethod
  fun getDiagnostics(promise: Promise) {
    val map: WritableMap = Arguments.createMap()
    val diag = ShortsPool.diagnostics()
    map.putString("engine", diag["engine"] as? String ?: "BlypShorts")
    map.putInt("poolSize", diag["poolSize"] as Int)
    map.putInt("openingJobs", diag["openingJobs"] as Int)
    map.putDouble("cacheBytes", (diag["cacheBytes"] as Long).toDouble())
    promise.resolve(map)
  }

  @ReactMethod
  fun releaseAll(promise: Promise) {
    ShortsPool.releaseAll()
    promise.resolve(true)
  }
}
