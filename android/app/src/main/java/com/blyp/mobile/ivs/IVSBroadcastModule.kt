package com.blyp.mobile.ivs

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.ConcurrentHashMap

class IVSBroadcastModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private var broadcastSessionId: String? = null
    private var localParticipantId: String? = null
    private var currentSessionId: String? = null
    private var isHostMode: Boolean = false
    private val remoteParticipants = ConcurrentHashMap<String, String>()

    override fun getName(): String = "IVSBroadcastModule"

    @ReactMethod
    fun startHostSession(
        stageArn: String,
        token: String,
        sessionId: String,
        callback: Callback
    ) {
        try {
            broadcastSessionId = "broadcast-${System.currentTimeMillis()}"
            localParticipantId = "local-${System.currentTimeMillis()}"
            currentSessionId = sessionId
            isHostMode = true

            val eventData = Arguments.createMap()
            eventData.putString("participantId", localParticipantId)
            eventData.putString("sessionId", sessionId)
            eventData.putString("role", "host")
            sendEvent("IVS_HOST_LOCAL_JOINED", eventData)

            callback.invoke(null, "Host session started")
        } catch (e: Exception) {
            callback.invoke(e.message, null)
        }
    }

    @ReactMethod
    fun stopHostSession(callback: Callback) {
        try {
            val eventData = Arguments.createMap()
            eventData.putString("participantId", localParticipantId)
            sendEvent("IVS_HOST_LOCAL_LEFT", eventData)

            broadcastSessionId = null
            localParticipantId = null
            currentSessionId = null
            isHostMode = false
            remoteParticipants.clear()

            callback.invoke(null, "Host session stopped")
        } catch (e: Exception) {
            callback.invoke(e.message, null)
        }
    }

    @ReactMethod
    fun startGuestSession(
        stageArn: String,
        token: String,
        sessionId: String,
        slotIndex: Int,
        callback: Callback
    ) {
        try {
            broadcastSessionId = "broadcast-${System.currentTimeMillis()}"
            localParticipantId = "guest-${System.currentTimeMillis()}"
            currentSessionId = sessionId
            isHostMode = false

            val eventData = Arguments.createMap()
            eventData.putString("participantId", localParticipantId)
            eventData.putString("sessionId", sessionId)
            eventData.putString("role", "guest")
            eventData.putInt("slotIndex", slotIndex)
            sendEvent("IVS_HOST_LOCAL_JOINED", eventData)

            callback.invoke(null, "Guest session started")
        } catch (e: Exception) {
            callback.invoke(e.message, null)
        }
    }

    @ReactMethod
    fun stopGuestSession(callback: Callback) {
        try {
            val eventData = Arguments.createMap()
            eventData.putString("participantId", localParticipantId)
            sendEvent("IVS_HOST_LOCAL_LEFT", eventData)

            broadcastSessionId = null
            localParticipantId = null
            currentSessionId = null
            isHostMode = false
            remoteParticipants.clear()

            callback.invoke(null, "Guest session stopped")
        } catch (e: Exception) {
            callback.invoke(e.message, null)
        }
    }

    @ReactMethod
    fun setMicEnabled(enabled: Boolean, callback: Callback) {
        try {
            callback.invoke(null, if (enabled) "Mic enabled" else "Mic disabled")
        } catch (e: Exception) {
            callback.invoke(e.message, null)
        }
    }

    @ReactMethod
    fun setCameraEnabled(enabled: Boolean, callback: Callback) {
        try {
            callback.invoke(null, if (enabled) "Camera enabled" else "Camera disabled")
        } catch (e: Exception) {
            callback.invoke(e.message, null)
        }
    }

    @ReactMethod
    fun switchCamera(callback: Callback) {
        try {
            callback.invoke(null, "Camera switched")
        } catch (e: Exception) {
            callback.invoke(e.message, null)
        }
    }

    private fun sendEvent(eventName: String, params: WritableMap?) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }
}
