import Foundation
import UIKit
import AVFoundation
import CoreMedia

@objc(ShortsSurfaceView)
final class ShortsSurfaceView: UIView {
  private let playerLayer = AVPlayerLayer()
  private var uriValue: String = ""
  private var playingFlag = false
  private var mutedFlag = true
  private var roleFlag = "neighbor"
  private var hasFirstFrame = false
  private var slotIndex = -1

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .black
    playerLayer.videoGravity = .resizeAspect
    playerLayer.opacity = 0
    layer.addSublayer(playerLayer)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    playerLayer.frame = bounds
  }

  @objc func setUri(_ uri: NSString?) {
    uriValue = (uri as String?)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    hasFirstFrame = false
    playerLayer.opacity = 0
    rebind()
  }

  @objc func setPlaying(_ playing: Bool) {
    playingFlag = playing
    ShortsPool.shared.updatePlayback(view: self, playing: playingFlag, muted: mutedFlag, role: roleFlag)
  }

  @objc func setMuted(_ muted: Bool) {
    mutedFlag = muted
    ShortsPool.shared.updatePlayback(view: self, playing: playingFlag, muted: mutedFlag, role: roleFlag)
  }

  @objc func setRole(_ role: NSString?) {
    roleFlag = (role as String?) == "active" ? "active" : "neighbor"
    ShortsPool.shared.updatePlayback(view: self, playing: playingFlag, muted: mutedFlag, role: roleFlag)
  }

  /// For You promote / remount — seek pool slot to ms (0 = opening).
  @objc func setSeekToMs(_ ms: NSNumber?) {
    guard let ms = ms, ms.doubleValue >= 0 else { return }
    ShortsPool.shared.seekView(view: self, ms: CMTime(seconds: ms.doubleValue / 1000.0, preferredTimescale: 600))
  }

  @objc func setResizeMode(_ mode: NSString?) {
    applyResizeMode((mode as String?) ?? "contain")
  }

  func attachSlot(_ index: Int) {
    slotIndex = index
  }

  func applyResizeMode(_ mode: String) {
    playerLayer.videoGravity = .resizeAspect
  }

  func bindPlayerLayer(_ player: AVPlayer) {
    playerLayer.player = player
  }

  func unbindPlayerLayer() {
    playerLayer.player = nil
  }

  private func rebind() {
    guard !uriValue.isEmpty else {
      ShortsPool.shared.unbind(view: self)
      return
    }
    ShortsPool.shared.bind(
      view: self,
      uri: uriValue,
      playing: playingFlag,
      muted: mutedFlag,
      role: roleFlag,
      resizeMode: "contain"
    )
  }

  func emitReady() {
    sendEvent("onReady", ["uri": uriValue, "slot": slotIndex])
  }

  func emitFirstFrame() {
    hasFirstFrame = true
    playerLayer.opacity = 1
    sendEvent("onFirstFrame", ["uri": uriValue, "slot": slotIndex])
  }

  func emitVideoSize(width: Int, height: Int) {
    if !hasFirstFrame {
      playerLayer.opacity = 1
      hasFirstFrame = true
    }
    sendEvent("onVideoSize", ["width": width, "height": height])
  }

  func emitError(code: String, message: String) {
    sendEvent("onError", ["code": code, "message": message, "uri": uriValue])
  }

  private func sendEvent(_ name: String, _ body: [String: Any]) {
    guard let bridge = ShortsViewManager.sharedBridge else { return }
    // RCTDirectEventBlock props are wired by ViewManager; fall back no-op if unset.
    switch name {
    case "onReady": onReady?(body)
    case "onFirstFrame": onFirstFrame?(body)
    case "onVideoSize": onVideoSize?(body)
    case "onError": onError?(body)
    default: break
    }
    _ = bridge
  }

  @objc var onReady: RCTDirectEventBlock?
  @objc var onFirstFrame: RCTDirectEventBlock?
  @objc var onVideoSize: RCTDirectEventBlock?
  @objc var onError: RCTDirectEventBlock?

  deinit {
    ShortsPool.shared.unbind(view: self)
  }
}
