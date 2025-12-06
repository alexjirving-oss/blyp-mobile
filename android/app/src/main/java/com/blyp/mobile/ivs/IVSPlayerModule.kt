package com.blyp.mobile.ivs

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule

class IVSPlayerModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private var currentSessionId: String? = null
    private var currentNetworkQuality: String = "UNKNOWN"
    private var isPlayingStream: Boolean = false

    override fun getName(): String = "IVSPlayerModule"

    @ReactMethod
    fun joinAsViewer(playbackUrl: String, sessionId: String, promise: Promise) {
        try {
            currentSessionId = sessionId
            isPlayingStream = true

            val eventData = Arguments.createMap()
            eventData.putString("state", "playing")
            eventData.putString("url", playbackUrl)
            sendEvent("IVS_PLAYER_STATE_CHANGED", eventData)

            promise.resolve("Viewer session joined")
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun leaveAsViewer(promise: Promise) {
        try {
            val eventData = Arguments.createMap()
            eventData.putString("state", "idle")
            sendEvent("IVS_PLAYER_STATE_CHANGED", eventData)

            currentSessionId = null
            isPlayingStream = false

            promise.resolve("Viewer session left")
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun setVolume(volume: Double, promise: Promise) {
        try {
            promise.resolve("Volume set to $volume")
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun play(promise: Promise) {
        try {
            isPlayingStream = true
            promise.resolve("Playing")
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun pause(promise: Promise) {
        try {
            isPlayingStream = false
            promise.resolve("Paused")
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun getPosition(promise: Promise) {
        try {
            promise.resolve(0.0)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun getPlayerState(promise: Promise) {
        try {
            val state = Arguments.createMap()
            state.putString("state", if (isPlayingStream) "playing" else "idle")
            state.putString("networkQuality", currentNetworkQuality)
            promise.resolve(state)
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    private fun sendEvent(eventName: String, params: WritableMap?) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }
}
