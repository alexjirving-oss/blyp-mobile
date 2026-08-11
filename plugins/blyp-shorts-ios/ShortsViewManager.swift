import Foundation

@objc(BlypShortsViewManager)
final class ShortsViewManager: RCTViewManager {
  static var sharedBridge: RCTBridge?

  override static func moduleName() -> String! {
    "BlypShortsView"
  }

  override func view() -> UIView! {
    ShortsViewManager.sharedBridge = self.bridge
    return ShortsSurfaceView()
  }

  override static func requiresMainQueueSetup() -> Bool { true }
}
