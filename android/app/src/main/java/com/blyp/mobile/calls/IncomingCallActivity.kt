package com.blyp.mobile.calls

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.blyp.mobile.MainActivity

/**
 * Thin lock-screen Answer/Decline UI used as the full-screen intent target.
 * Accept launches MainActivity with autoAnswer so JS joins LiveKit immediately.
 */
class IncomingCallActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(
      WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
        WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD,
    )

    val callId = intent?.getStringExtra(EXTRA_CALL_ID)?.trim().orEmpty()
    val callerName = intent?.getStringExtra(EXTRA_CALLER_NAME)?.trim().orEmpty().ifBlank { "Incoming call" }
    if (callId.isEmpty()) {
      finish()
      return
    }

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(48, 120, 48, 48)
      setBackgroundColor(0xFF0A0A0C.toInt())
    }
    val title = TextView(this).apply {
      text = "Incoming call"
      textSize = 18f
      setTextColor(0xFF9CA3AF.toInt())
    }
    val name = TextView(this).apply {
      text = callerName
      textSize = 28f
      setTextColor(0xFFFFFFFF.toInt())
      setPadding(0, 24, 0, 64)
    }
    val row = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
    }
    val decline = Button(this).apply {
      text = "Decline"
      setBackgroundColor(0xFFFB7185.toInt())
      setTextColor(0xFFFFFFFF.toInt())
      setOnClickListener {
        IncomingCallModule.cancel(this@IncomingCallActivity, callId)
        BlypConnectionService.endIncoming(callId)
        val open = Intent(this@IncomingCallActivity, MainActivity::class.java).apply {
          action = Intent.ACTION_VIEW
          data = Uri.parse("blyp://call/$callId?action=decline")
          putExtra("callId", callId)
          putExtra("callAction", "decline")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        startActivity(open)
        finish()
      }
    }
    val answer = Button(this).apply {
      text = "Answer"
      setBackgroundColor(0xFF00D2BE.toInt())
      setTextColor(0xFF0A0A0C.toInt())
      setOnClickListener {
        IncomingCallForegroundService.stop(this@IncomingCallActivity)
        BlypConnectionService.answerIncoming(callId)
        val open = Intent(this@IncomingCallActivity, MainActivity::class.java).apply {
          action = Intent.ACTION_VIEW
          data = Uri.parse(
            "blyp://call/$callId?action=answer&peerName=${Uri.encode(callerName)}",
          )
          putExtra("callId", callId)
          putExtra("role", "callee")
          putExtra("peerName", callerName)
          putExtra("autoAnswer", true)
          putExtra("callAction", "answer")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        startActivity(open)
        finish()
      }
    }
    val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
      setMargins(12, 0, 12, 0)
    }
    row.addView(decline, lp)
    row.addView(answer, lp)
    root.addView(title)
    root.addView(name)
    root.addView(row)
    setContentView(root)
  }

  companion object {
    const val EXTRA_CALL_ID = "callId"
    const val EXTRA_CALLER_NAME = "callerName"
  }
}
