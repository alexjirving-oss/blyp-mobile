import Foundation
import UIKit
import CoreMedia
import AVFoundation
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
    private var routeChangeObserver: NSObjectProtocol?
    private var loudspeakerGuardActive = false
    private var loudspeakerGuardGeneration = 0

    override init() {
        super.init()
        routeChangeObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self = self, self.loudspeakerGuardActive else { return }
            self.forcePlayerLoudspeaker(reason: "route-change")
        }
    }

    deinit {
        if let routeChangeObserver = routeChangeObserver {
            NotificationCenter.default.removeObserver(routeChangeObserver)
        }
    }

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

    private func forcePlayerLoudspeaker(reason: String) {
        let session = AVAudioSession.sharedInstance()
        do {
            if session.category != .playback || session.mode != .moviePlayback {
                try session.setCategory(.playback, mode: .moviePlayback, options: [.mixWithOthers])
            }
            try session.setActive(true)
            let outputs = session.currentRoute.outputs
                .map { "\($0.portType.rawValue):\($0.portName)" }
                .joined(separator: ",")
            NSLog(
                "[IVS_PLAYER_AUDIO] forced reason=%@ category=%@ mode=%@ outputs=%@",
                reason,
                session.category.rawValue,
                session.mode.rawValue,
                outputs
            )
        } catch {
            NSLog(
                "[IVS_PLAYER_AUDIO] force failed reason=%@ error=%@",
                reason,
                error.localizedDescription
            )
        }
    }

    private func startLoudspeakerGuard(reason: String) {
        loudspeakerGuardActive = true
        loudspeakerGuardGeneration += 1
        let generation = loudspeakerGuardGeneration
        forcePlayerLoudspeaker(reason: reason)
        scheduleLoudspeakerGuard(generation: generation)
    }

    private func scheduleLoudspeakerGuard(generation: Int) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
            guard let self = self,
                  self.loudspeakerGuardActive,
                  self.loudspeakerGuardGeneration == generation else { return }
            self.forcePlayerLoudspeaker(reason: "watchdog")
            self.scheduleLoudspeakerGuard(generation: generation)
        }
    }

    private func stopLoudspeakerGuard() {
        loudspeakerGuardActive = false
        loudspeakerGuardGeneration += 1
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
            self.startLoudspeakerGuard(reason: "player-before-load")
            let player = self.ensurePlayer()
            player.load(url)
            player.play()
            self.forcePlayerLoudspeaker(reason: "player-after-play")
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
            self.stopLoudspeakerGuard()
            self.emit("IVS_VIEWER_LEFT", ["sessionId": self.currentSessionId as Any, "reason": "leave"])
            callback([])
        }
    }

    @objc(play:)
    func play(_ callback: @escaping RCTResponseSenderBlock) {
        runOnMain { [weak self] in
            guard let self = self else { return }
            self.startLoudspeakerGuard(reason: "player-play")
            let player = self.ensurePlayer()
            player.play()
            self.forcePlayerLoudspeaker(reason: "player-play-returned")
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
            self.stopLoudspeakerGuard()
            IVSPlayerModule.sharedPlayer = nil
            NotificationCenter.default.post(name: IVSPlayerModule.playerDidChangeNotification, object: nil)
            self.emit("IVS_VIEWER_LEFT", ["sessionId": self.currentSessionId as Any, "reason": "stop"])
            callback([])
        }
    }

    @objc(forceLiveLoudspeaker:callback:)
    func forceLiveLoudspeaker(_ reason: String, callback: @escaping RCTResponseSenderBlock) {
        runOnMain { [weak self] in
            guard let self = self else { return }
            self.forcePlayerLoudspeaker(reason: "js:\(reason)")
            callback([])
        }
    }
}

// MARK: - IVSPlayer.Delegate

extension IVSPlayerModule: IVSPlayer.Delegate {

    func player(_ player: IVSPlayer, didChangeState state: IVSPlayer.State) {
        if state == .ready || state == .playing {
            forcePlayerLoudspeaker(reason: "player-state-\(stateName(state).lowercased())")
        }
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
