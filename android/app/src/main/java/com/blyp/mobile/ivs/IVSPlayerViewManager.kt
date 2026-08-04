package com.blyp.mobile.ivs

import com.amazonaws.ivs.player.PlayerView
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext

class IVSPlayerViewManager : SimpleViewManager<PlayerView>() {
    override fun getName(): String = "IVSPlayerView"

    override fun createViewInstance(reactContext: ThemedReactContext): PlayerView {
        val view = PlayerView(reactContext)
        IVSPlayerModule.attachPlayerView(view)
        return view
    }

    override fun onDropViewInstance(view: PlayerView) {
        super.onDropViewInstance(view)
    }
}
