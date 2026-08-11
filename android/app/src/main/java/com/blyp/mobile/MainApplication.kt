package com.blyp.mobile

import android.app.Application
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.defaults.DefaultReactNativeHost

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ReactNativeHostWrapper

import com.livekit.reactnative.LiveKitReactNative
import com.livekit.reactnative.audio.AudioType

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost = ReactNativeHostWrapper(
      this,
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              // Avoid double-registering IVS views if the package is already present.
              if (none { it is com.blyp.mobile.ivs.IVSPackage }) {
                add(com.blyp.mobile.ivs.IVSPackage())
              }
              if (none { it is com.blyp.mobile.billing.PlayBillingPackage }) {
                add(com.blyp.mobile.billing.PlayBillingPackage())
              }
              if (none { it is com.blyp.mobile.notifications.NotificationGlancePackage }) {
                add(com.blyp.mobile.notifications.NotificationGlancePackage())
              }
              if (none { it is com.blyp.mobile.calls.IncomingCallPackage }) {
                add(com.blyp.mobile.calls.IncomingCallPackage())
              }
              // For You ground-up shorts pool (not storm FeedPlayer).
              if (none { it is com.blyp.mobile.shorts.ShortsPackage }) {
                add(com.blyp.mobile.shorts.ShortsPackage())
              }
            }

          override fun getJSMainModuleName(): String = ".expo/.virtual-metro-entry"

          override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

          override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
      }
  )

  override val reactHost: ReactHost
    get() = ReactNativeHostWrapper.createReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    // LiveKit ADM default = media/loudspeaker. CommunicationAudioType uses
    // USAGE_VOICE_COMMUNICATION + MODE_IN_COMMUNICATION which routes app audio
    // (including chat notify beeps via expo-av) to the earpiece. Switch to
    // CommunicationAudioType only for the duration of an active LiveKit call.
    LiveKitReactNative.setup(this, AudioType.MediaAudioType())
    super.onCreate()
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
