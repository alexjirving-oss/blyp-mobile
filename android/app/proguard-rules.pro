# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Amazon IVS Broadcast SDK
-keep class com.amazonaws.ivs.broadcast.** { *; }
-keep class com.amazonaws.ivs.broadcast.BroadcastSession { *; }
-keep class com.amazonaws.ivs.broadcast.BroadcastSession$* { *; }
-keep class com.amazonaws.ivs.broadcast.Stage { *; }
-keep class com.amazonaws.ivs.broadcast.Stage$* { *; }
-keep class com.amazonaws.ivs.broadcast.DeviceInfo { *; }
-keep class com.amazonaws.ivs.broadcast.DeviceInfo$* { *; }

# Amazon IVS Player SDK
-keep class com.amazonaws.ivs.player.** { *; }
-keep class com.amazonaws.ivs.player.Player { *; }
-keep class com.amazonaws.ivs.player.Player$* { *; }
-keep class com.amazonaws.ivs.player.PlayerException { *; }

# Add any project specific keep options here:
