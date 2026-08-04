package com.blyp.mobile.ivs

import android.util.Log
import android.view.View

object FirstFrameProbe {
    fun reset(reason: String) {
        Log.i("IVS_PROOF", "reset reason=$reason")
    }

    fun markSurfaceReady(role: String, detail: String) {
        Log.i("IVS_PROOF", "SURFACE_READY role=$role $detail")
    }

    fun markAttach(role: String, detail: String) {
        Log.i("IVS_PROOF", "ATTACH role=$role $detail")
    }

    fun startPixelCopyProbe(view: View, role: String, slotId: Int) {
        Log.i(
            "IVS_PROOF",
            "PIXEL_COPY_PROBE_START role=$role slot=$slotId view=${view.javaClass.simpleName}"
        )
    }
}
