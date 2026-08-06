# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# ---- React Native / Hermes / New Architecture ----
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
-keep class com.facebook.react.bridge.** { *; }
-keepclassmembers class * { @com.facebook.react.uimanager.annotations.ReactProp <methods>; }
-keepclassmembers class * { @com.facebook.react.uimanager.annotations.ReactPropGroup <methods>; }

# ---- Reanimated / Worklets ----
-keep class com.swmansion.reanimated.** { *; }
-keep class com.swmansion.common.** { *; }
-keep class com.swmansion.rnscreens.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# ---- Skia ----
-keep class com.shopify.reactnative.skia.** { *; }
-keep class com.shopify.** { *; }

# ---- Expo modules ----
-keep class expo.modules.** { *; }
-keep class org.unimodules.** { *; }
-dontwarn expo.modules.**

# ---- Safe area / gesture / screens ----
-keep class com.th3rdwave.safeareacontext.** { *; }
-keep class com.swmansion.gesturehandler.** { *; }

# ---- Amazon IVS Broadcast SDK ----
-keep class com.amazonaws.ivs.broadcast.** { *; }
-keep class com.amazonaws.ivs.broadcast.BroadcastSession { *; }
-keep class com.amazonaws.ivs.broadcast.BroadcastSession$* { *; }
-keep class com.amazonaws.ivs.broadcast.Stage { *; }
-keep class com.amazonaws.ivs.broadcast.Stage$* { *; }
-keep class com.amazonaws.ivs.broadcast.DeviceInfo { *; }
-keep class com.amazonaws.ivs.broadcast.DeviceInfo$* { *; }

# ---- Amazon IVS Player SDK ----
-keep class com.amazonaws.ivs.player.** { *; }
-keep class com.amazonaws.ivs.player.Player { *; }
-keep class com.amazonaws.ivs.player.Player$* { *; }
-keep class com.amazonaws.ivs.player.PlayerException { *; }

# ---- LiveKit / WebRTC ----
-keep class io.livekit.** { *; }
-keep class livekit.org.** { *; }
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**

# ---- ML Kit / CameraX (expo-camera barcode) ----
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_** { *; }
-dontwarn com.google.mlkit.**

# ---- Blyp native modules ----
-keep class com.blyp.mobile.** { *; }

# ---- OkHttp / Gson commonly touched by RN networking ----
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**

# Add any project specific keep options here:

# ---- Optional Chromium Cronet (IVS HTTP client; not on compile classpath) ----
# R8 full mode still errors on missing Cronet types referenced by IVS unless suppressed.
-dontwarn org.chromium.net.**
-dontwarn com.amazonaws.ivs.net.**
-keep class com.amazonaws.ivs.net.** { *; }
-dontwarn org.chromium.net.CronetEngine$Builder
-dontwarn org.chromium.net.CronetEngine
-dontwarn org.chromium.net.CronetException
-dontwarn org.chromium.net.UploadDataProvider
-dontwarn org.chromium.net.UploadDataProviders
-dontwarn org.chromium.net.UrlRequest$Builder
-dontwarn org.chromium.net.UrlRequest$Callback
-dontwarn org.chromium.net.UrlRequest
-dontwarn org.chromium.net.UrlResponseInfo

