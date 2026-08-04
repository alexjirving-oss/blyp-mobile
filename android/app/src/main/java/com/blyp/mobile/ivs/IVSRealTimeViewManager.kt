package com.blyp.mobile.ivs

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class IVSRealTimeViewManager : SimpleViewManager<IVSRealTimeView>() {
    override fun getName(): String = "IVSRealTimeView"

    override fun createViewInstance(reactContext: ThemedReactContext): IVSRealTimeView {
        return IVSRealTimeView(reactContext)
    }

    @ReactProp(name = "stageArn")
    fun setStageArn(view: IVSRealTimeView, value: String?) {
        // Placeholder: no-op; avoids crashes when prop sent from JS.
    }

    @ReactProp(name = "token")
    fun setToken(view: IVSRealTimeView, value: String?) {
        // Placeholder: no-op; avoids crashes when prop sent from JS.
    }

    @ReactProp(name = "sessionId")
    fun setSessionId(view: IVSRealTimeView, value: String?) {
        // Placeholder: no-op; avoids crashes when prop sent from JS.
    }

    @ReactProp(name = "participantId")
    fun setParticipantId(view: IVSRealTimeView, value: String?) {
        view.setParticipantId(value)
    }

    @ReactProp(name = "remoteTrackCount", defaultInt = 0)
    fun setRemoteTrackCount(view: IVSRealTimeView, value: Int) {
        view.setRemoteTrackCount(value)
    }

    @ReactProp(name = "slotId")
    fun setSlotId(view: IVSRealTimeView, value: Int) {
        view.setSlotId(value)
    }

    @ReactProp(name = "zoom", defaultFloat = 1.0f)
    fun setZoom(view: IVSRealTimeView, value: Float) {
        view.setZoom(value)
    }
}
