package com.blyp.mobile.calls

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.telecom.Connection
import android.telecom.ConnectionRequest
import android.telecom.ConnectionService
import android.telecom.PhoneAccount
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.telecom.DisconnectCause

/**
 * Self-managed ConnectionService so Android treats Blyp calls more like
 * Messenger (system call chrome). FGS ringtone remains the audio owner;
 * Telecom owns the call lifecycle presentation.
 */
class BlypConnectionService : ConnectionService() {
  override fun onCreateIncomingConnection(
    connectionManagerPhoneAccount: PhoneAccountHandle?,
    request: ConnectionRequest?,
  ): Connection {
    val extras = request?.extras
    val callId = extras?.getString(EXTRA_CALL_ID).orEmpty()
    val callerName = extras?.getString(EXTRA_CALLER_NAME).orEmpty().ifBlank { "Incoming call" }
    val conn = object : Connection() {
      override fun onAnswer() {
        setActive()
        try {
          IncomingCallForegroundService.stop(applicationContext)
        } catch (_: Exception) {
        }
        val open = android.content.Intent(applicationContext, com.blyp.mobile.MainActivity::class.java).apply {
          action = android.content.Intent.ACTION_VIEW
          data = Uri.parse("blyp://call/$callId?action=answer&peerName=${Uri.encode(callerName)}")
          putExtra("callId", callId)
          putExtra("autoAnswer", true)
          putExtra("peerName", callerName)
          addFlags(
            android.content.Intent.FLAG_ACTIVITY_NEW_TASK or
              android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP,
          )
        }
        try {
          applicationContext.startActivity(open)
        } catch (_: Exception) {
        }
      }

      override fun onReject() {
        setDisconnected(DisconnectCause(DisconnectCause.REJECTED))
        destroy()
        try {
          IncomingCallModule.cancel(applicationContext, callId)
        } catch (_: Exception) {
        }
        val open = android.content.Intent(applicationContext, com.blyp.mobile.MainActivity::class.java).apply {
          action = android.content.Intent.ACTION_VIEW
          data = Uri.parse("blyp://call/$callId?action=decline")
          putExtra("callId", callId)
          addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
          applicationContext.startActivity(open)
        } catch (_: Exception) {
        }
      }

      override fun onDisconnect() {
        setDisconnected(DisconnectCause(DisconnectCause.LOCAL))
        destroy()
        activeConnection = null
      }
    }
    conn.setInitializing()
    conn.setCallerDisplayName(callerName, TelecomManager.PRESENTATION_ALLOWED)
    conn.setAddress(Uri.fromParts("blyp", callId, null), TelecomManager.PRESENTATION_ALLOWED)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1) {
      conn.connectionProperties = Connection.PROPERTY_SELF_MANAGED
    }
    conn.setRinging()
    activeConnection = conn
    activeCallId = callId
    return conn
  }

  override fun onCreateIncomingConnectionFailed(
    connectionManagerPhoneAccount: PhoneAccountHandle?,
    request: ConnectionRequest?,
  ) {
    // Fall back to notification-only path already started by IncomingCallModule.
  }

  companion object {
    const val EXTRA_CALL_ID = "callId"
    const val EXTRA_CALLER_NAME = "callerName"
    private const val ACCOUNT_ID = "blyp_calls"

    @Volatile private var activeConnection: Connection? = null
    @Volatile private var activeCallId: String = ""

    fun phoneAccountHandle(context: Context): PhoneAccountHandle {
      return PhoneAccountHandle(
        ComponentName(context, BlypConnectionService::class.java),
        ACCOUNT_ID,
      )
    }

    fun ensurePhoneAccount(context: Context) {
      try {
        val tm = context.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager ?: return
        val handle = phoneAccountHandle(context)
        val account = PhoneAccount.builder(handle, "Blyp Calls")
          .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED)
          .setSupportedUriSchemes(listOf("blyp"))
          .build()
        tm.registerPhoneAccount(account)
      } catch (_: Exception) {
      }
    }

    fun addIncomingCall(context: Context, callId: String, callerName: String) {
      ensurePhoneAccount(context)
      try {
        val tm = context.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager ?: return
        val extras = Bundle().apply {
          putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, phoneAccountHandle(context))
          putString(EXTRA_CALL_ID, callId)
          putString(EXTRA_CALLER_NAME, callerName)
        }
        tm.addNewIncomingCall(phoneAccountHandle(context), extras)
      } catch (_: Exception) {
        // OEM / permission variance — notification path still rings.
      }
    }

    fun answerIncoming(callId: String) {
      if (activeCallId == callId) {
        try {
          activeConnection?.setActive()
        } catch (_: Exception) {
        }
      }
    }

    fun endIncoming(callId: String) {
      if (activeCallId.isNotEmpty() && (callId.isEmpty() || activeCallId == callId)) {
        try {
          activeConnection?.setDisconnected(DisconnectCause(DisconnectCause.LOCAL))
          activeConnection?.destroy()
        } catch (_: Exception) {
        }
        activeConnection = null
        activeCallId = ""
      }
    }
  }
}
