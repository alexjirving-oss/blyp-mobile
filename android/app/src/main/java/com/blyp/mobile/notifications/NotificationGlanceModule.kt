package com.blyp.mobile.notifications

import android.content.ComponentName
import android.content.Intent
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Bridge for the on-device notification glance. Exposes whether the user has
 * granted notification access, a way to open the system settings to grant it,
 * and a read of the in-memory buffer captured by BlypNotificationListenerService.
 * Nothing here leaves the device.
 */
class NotificationGlanceModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "BlypNotificationGlance"

    private fun isGranted(): Boolean {
        return try {
            val flat = Settings.Secure.getString(
                reactContext.contentResolver,
                "enabled_notification_listeners"
            ) ?: return false
            val mine = reactContext.packageName
            flat.split(":").any {
                val c = ComponentName.unflattenFromString(it)
                c != null && c.packageName == mine
            }
        } catch (e: Exception) {
            false
        }
    }

    @ReactMethod
    fun isAccessGranted(promise: Promise) {
        promise.resolve(isGranted())
    }

    @ReactMethod
    fun openAccessSettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("OPEN_SETTINGS_FAILED", e.message)
        }
    }

    @ReactMethod
    fun getRecent(promise: Promise) {
        val out = Arguments.createArray()
        try {
            for (item in BlypNotificationListenerService.snapshot()) {
                val m = Arguments.createMap()
                m.putString("pkg", item.pkg)
                m.putString("title", item.title)
                m.putString("text", item.text)
                m.putDouble("postTime", item.postTime.toDouble())
                out.pushMap(m)
            }
        } catch (e: Exception) {
            // Return whatever we managed to collect.
        }
        promise.resolve(out)
    }

    @ReactMethod
    fun clear(promise: Promise) {
        BlypNotificationListenerService.clearAll()
        promise.resolve(true)
    }
}
