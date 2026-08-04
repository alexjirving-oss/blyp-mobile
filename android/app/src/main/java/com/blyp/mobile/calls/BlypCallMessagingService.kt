package com.blyp.mobile.calls

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Handles FCM while the JS runtime may be dead (background / killed).
 * Incoming-call data messages must wake this service so we can show a
 * full-screen call notification + ringtone — same job WhatsApp/Messenger do.
 *
 * Declared with higher intent-filter priority than Expo's messaging service.
 */
class BlypCallMessagingService : FirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    val data = message.data ?: emptyMap()
    val type = (data["type"] ?: "").lowercase()
    if (type != "incoming_call" && type != "call") {
      // Let Expo / default path handle non-call pushes when they also arrive.
      return
    }
    val callId = (data["callId"] ?: "").trim()
    if (callId.isEmpty()) return
    val callerName = (data["callerName"] ?: data["title"] ?: "Incoming call").trim()
    try {
      IncomingCallModule.show(applicationContext, callId, callerName.ifBlank { "Incoming call" })
    } catch (_: Exception) {
      // Best-effort — never crash the messaging process.
    }
  }
}
