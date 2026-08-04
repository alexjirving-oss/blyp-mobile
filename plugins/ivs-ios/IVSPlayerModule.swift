import Foundation
import UIKit
import CoreMedia
import AmazonIVSPlayer

/// iOS counterpart of the Android `IVSPlayerModule` (Kotlin).
///
/// Wraps an `IVSPlayer` for HLS / low-latency viewer playback. The shared player is
/// exposed via `sharedPlayer` so the `IVSPlayerView` native view can render it.
@objc(IVSPlayerModule)
final class IVSPlayerModule: RCTEventEmitter {

    /// The single active viewer player. The `IVSPlayerView` binds to this.
    @objc static private(set) var sharedPlayer: IVSPlayer?

    /// Posted when `sharedPlayer` is created/destroyed so the view can (re)bind.
    @objc static let playerDidChangeNotification = Notification.Name("BlypIVSPlayerDidChange")

    private var currentSessionId: String?
    private var hasListeners = false

    private func runOnMain(_ block: @escaping () -> Void) {
        if Thread.isMainThread { block() } else { DispatchQueue.main.async(execute: block) }
    }

    override static func requiresMainQueueSetup() -> Bool { true }

    override func supportedEvents() -> [String]! {
        return [
            "IVS_PLAYER_STATE_CHANGED",
            "IVS_VIEWER_JOINED",
            "IVS_VIEWER_LEFT",
            "IVS_PLAYER_ERROR",
            "IVS_PLAYER_DURATION_CHANGED",
            "IVS_PLAYER_VIDEO_SIZE_CHANGED",
            "IVS_PLAYER_QUALITY_CHANGED",
            "IVS_PLAYER_FIRST_FRAME",
            "IVS_PLAYER_NETWORK_QUALITY_UPDATED",
        ]
    }

    override func startObserving() { hasListeners = true }
    override func stopObserving() { hasListeners = false }

    private func emit(_ name: String, _ body: [String: Any]) {
        guard hasListeners else { return }
        sendEvent(withName: name, body: body)
    }

    private func errorBody(_ code: String, _ message: String, fatal: Bool = true) -> [String: Any] {
        return ["code": code, "message": message, "fatal": fatal]
    }

    private func stateName(_ state: IVSPlayer.State) -> String {
        switch state {
        case .idle: return "IDLE"
        case .ready: return "READY"
        case .buffering: return "BUFFERING"
        case .playing: return "PLAYING"
        case .ended: return "ENDED"
        @unknown default: return "UNKNOWN"
        }
    }

    private func ensurePlayer() -> IVSPlayer {
        if let player = IVSPlayerModule.sharedPlayer { return player }
        let player = IVSPlayer()
        player.delegate = self
        IVSPlayerModule.sharedPlayer = player
        NotificationCenter.default.post(name: IVSPlayerModule.playerDidChangeNotification, object: nil)
        return player
    }

    // MARK: - Bridge API (matches IVSNativeClient.ts)

    @objc(joinAsViewer:sessionId:callback:)
    func joinAsViewer(_ playbackUrl: String, sessionId: String, callback: @escaping RCTResponseSenderBlock) {
        runOnMain { [weak self] in
            guard let self = self else { return }
            guard !playbackUrl.isEmpty, let url = URL(string: playbackUrl) else {
                callback([self.errorBody("MISSING_PLAYBACK_URL", "playbackUrl is required for viewer playback")])
                return
            }
            self.currentSessionId = sessionId
            let player = self.ensurePlayer()
            player.load(url)
            player.play()
            self.emit("IVS_VIEWER_JOINED", ["sessionId": sessionId, "playbackUrl": playbackUrl])
            self.emit("IVS_PLAYER_STATE_CHANGED", ["state": self.stateName(player.state), "sessionId": sessionId])
            callback([])
        }
    }

    @objc(leaveAsViewer:)
    func leaveAsViewer(_ callback: @escaping RCTResponseSenderBlock) {
        runOnMain { [weak self] in
            guard let self = self else { return }
            IVSPlayerModule.sharedPlayer?.pause()
            self.emit("IVS_VIEWER_LEFT", ["sessionId": self.currentSessionId as Any, "reason": "leave"])
            callback([])
        }
    }

    @objc(play:)
    func play(_ callback: @escaping RCTResponseSenderBlock) {
        runOnMain { [weak self] in
            guard let self = self else { return }
            let player = self.ensurePlayer()
            player.play()
            self.emit("IVS_PLAYER_STATE_CHANGED", ["state": self.stateName(player.state)])
            callback([])
        }
    }

    @objc(pause:)
    func pause(_ callback: @escaping RCTResponseSenderBlock) {
        runOnMain { [weak self] in
            guard let self = self else { return }
            IVSPlayerModule.sharedPlayer?.pause()
            if let player = IVSPlayerModule.sharedPlayer {
                self.emit("IVS_PLAYER_STATE_CHANGED", ["state": self.stateName(player.state)])
            }
            callback([])
        }
    }

    @objc(stop:)
    func stop(_ callback: @escaping RCTResponseSenderBlock) {
        runOnMain { [weak self] in
            guard let self = self else { return }
            IVSPlayerModule.sharedPlayer?.pause()
            IVSPlayerModule.sharedPlayer = nil
            NotificationCenter.default.post(name: IVSPlayerModule.playerDidChangeNotification, object: nil)
            self.emit("IVS_VIEWER_LEFT", ["sessionId": self.currentSessionId as Any, "reason": "stop"])
            callback([])
        }
    }
}

// MARK: - IVSPlayer.Delegate

extension IVSPlayerModule: IVSPlayer.Delegate {

    func player(_ player: IVSPlayer, didChangeState state: IVSPlayer.State) {
        emit("IVS_PLAYER_STATE_CHANGED", ["state": stateName(state), "sessionId": currentSessionId as Any])
    }

    func player(_ player: IVSPlayer, didFailWithError error: Error) {
        emit("IVS_PLAYER_ERROR", errorBody("PLAYER_ERROR", error.localizedDescription))
    }

    func player(_ player: IVSPlayer, didChangeDuration duration: CMTime) {
        let seconds = CMTIME_IS_NUMERIC(duration) ? CMTimeGetSeconds(duration) * 1000.0 : 0
        emit("IVS_PLAYER_DURATION_CHANGED", ["duration": seconds.isFinite ? seconds : 0])
    }

    func player(_ player: IVSPlayer, didChangeVideoSize videoSize: CGSize) {
        emit("IVS_PLAYER_VIDEO_SIZE_CHANGED", ["width": Int(videoSize.width), "height": Int(videoSize.height)])
    }

    func player(_ player: IVSPlayer, didChangeQuality quality: IVSQuality?) {
        guard let quality = quality else { return }
        emit("IVS_PLAYER_QUALITY_CHANGED", ["name": quality.name, "bitrate": quality.bitrate])
        emit("IVS_PLAYER_NETWORK_QUALITY_UPDATED", ["isLocal": false, "bitrate": quality.bitrate])
    }

    func player(_ player: IVSPlayer, didOutputCue cue: IVSCue) {
        // optional analytics hook
    }

    func playerWillRebuffer(_ player: IVSPlayer) {
        emit("IVS_PLAYER_STATE_CHANGED", ["state": "BUFFERING"])
    }
}
