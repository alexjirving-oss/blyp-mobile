package com.blyp.mobile.calls

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.blyp.mobile.MainActivity

/**
 * Handles Answer / Decline taps on the incoming-call notification.
 * Answer opens CallScreen with autoAnswer; Decline stops the ring and
 * deep-links so JS can mark the call declined in Firestore.
 */
class IncomingCallActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    val callId = intent.getStringExtra(EXTRA_CALL_ID)?.trim().orEmpty()
    if (callId.isEmpty()) return
    val callerName = intent.getStringExtra(EXTRA_CALLER_NAME)?.trim().orEmpty().ifBlank { "Incoming call" }

    when (action) {
      ACTION_DECLINE -> {
        try {
          IncomingCallModule.cancel(context, callId)
        } catch (_: Exception) {
        }
        val open = Intent(context, MainActivity::class.java).apply {
          this.action = Intent.ACTION_VIEW
          data = Uri.parse("blyp://call/$callId?action=decline")
          putExtra("callId", callId)
          putExtra("role", "callee")
          putExtra("callAction", "decline")
          addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
              Intent.FLAG_ACTIVITY_CLEAR_TOP or
              Intent.FLAG_ACTIVITY_SINGLE_TOP,
          )
        }
        try {
          context.startActivity(open)
        } catch (_: Exception) {
        }
      }
      ACTION_ANSWER -> {
        try {
          IncomingCallForegroundService.stop(context)
        } catch (_: Exception) {
        }
        val open = Intent(context, MainActivity::class.java).apply {
          this.action = Intent.ACTION_VIEW
          data = Uri.parse(
            "blyp://call/$callId?action=answer&peerName=${Uri.encode(callerName)}",
          )
          putExtra("callId", callId)
          putExtra("role", "callee")
          putExtra("peerName", callerName)
          putExtra("callAction", "answer")
          putExtra("autoAnswer", true)
          addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
              Intent.FLAG_ACTIVITY_CLEAR_TOP or
              Intent.FLAG_ACTIVITY_SINGLE_TOP,
          )
        }
        try {
          context.startActivity(open)
        } catch (_: Exception) {
        }
      }
    }
  }

  companion object {
    const val ACTION_ANSWER = "com.blyp.mobile.calls.ACTION_ANSWER"
    const val ACTION_DECLINE = "com.blyp.mobile.calls.ACTION_DECLINE"
    const val EXTRA_CALL_ID = "callId"
    const val EXTRA_CALLER_NAME = "callerName"
  }
}
