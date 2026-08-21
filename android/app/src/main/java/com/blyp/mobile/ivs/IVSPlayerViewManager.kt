package com.blyp.mobile.ivs

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext

class IVSPlayerViewManager : SimpleViewManager<IVSPlayerTextureView>() {
    override fun getName(): String = "IVSPlayerView"

    override fun createViewInstance(reactContext: ThemedReactContext): IVSPlayerTextureView {
        return IVSPlayerTextureView(reactContext)
    }
}
