import Foundation
import UIKit
import AmazonIVSBroadcast

/// iOS counterpart of the Android `IVSBroadcastModule` (Kotlin).
///
/// Owns a single `IVSStage` and drives host / guest / read-only-viewer roles via the
/// real-time Stages SDK. It implements `IVSStageStrategy` (publish/subscribe decisions)
/// and `IVSStageRenderer` (participant + stream lifecycle), translating SDK callbacks
/// into the exact JS event contract consumed by `IVSNativeClient.ts`.
///
/// Preview rendering: the SDK vends UIView previews per image stream; those are pushed
/// into `BlypIVSRenderRegistry` and attached by the RN native views.
@objc(IVSBroadcastModule)
final class IVSBroadcastModule: RCTEventEmitter {

    private enum Role: String {
        case idle
        case host
        case guest
        case viewer
    }

    // MARK: - State

    private var stage: IVSStage?
    private var deviceDiscovery: IVSDeviceDiscovery?
    private var camera: IVSCamera?
    private var microphone: IVSMicrophone?
    private var cameraStream: IVSLocalStageStream?
    private var micStream: IVSLocalStageStream?

    private var role: Role = .idle
    private var currentSessionId: String?
    private var localParticipantId: String?
    private var hasEmittedLocalJoined = false

    private var micEnabled = true
    private var cameraEnabled = true
    private var cameraPosition: IVSDevicePosition = .front

    /// Participants we've already surfaced a video track for (for first-frame signalling).
    private var participantsWithVideo = Set<String>()

    private var hasListeners = false

    // All work that touches the SDK/UI is funnelled to main to keep ordering simple
    // and because preview UIViews must be created on the main thread.
    private func runOnMain(_ block: @escaping () -> Void) {
        if Thread.isMainThread { block() } else { DispatchQueue.main.async(execute: block) }
    }

    // MARK: - RCTEventEmitter plumbing

    override static func requiresMainQueueSetup() -> Bool { true }

    override func supportedEvents() -> [String]! {
        return [
            "IVS_BROADCAST_STATE_CHANGED",
            "IVS_SURFACE_READY",
            "IVS_REMOTE_FIRST_FRAME_SIGNAL",
            "IVS_HOST_LOCAL_JOINED",
            "IVS_HOST_LOCAL_LEFT",
            "IVS_REMOTE_PARTICIPANT_JOINED",
            "IVS_REMOTE_PARTICIPANT_UPDATED",
            "IVS_REMOTE_PARTICIPANT_LEFT",
            "IVS_BROADCAST_ERROR",
            "IVS_NETWORK_QUALITY_UPDATED",
            "IVS_LOCAL_TRACK_UPDATE",
            "IVS_REMOTE_VIDEO_ADDED",
            "IVS_REMOTE_VIDEO_REMOVED",
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

    // MARK: - Public bridge API (matches IVSNativeClient.ts call sites)

    @objc(startHostSession:token:sessionId:callback:)
    func startHostSession(_ stageArn: String, token: String, sessionId: String, callback: @escaping RCTResponseSenderBlock) {
        runOnMain { [weak self] in
            guard let self = self else { return }
            do {
                try self.beginSession(role: .host, token: token, sessionId: sessionId, publish: true)
                callback([])
            } catch {
                callback([self.errorBody("HOST_START_FAILED", error.localizedDescription)])
            }
        }
    }

    @objc(stopHostSession:)
    func stopHostSession(_ callback: @escaping RCTResponseSenderBlock) {
        runOnMain { [weak self] in
            self?.endSession(reason: "host_stop")
            callback([])
        }
    }

    @objc(startGuestSession:token:sessionId:slotIndex:callback:)
    func startGuestSession(_ stageArn: String, token: String, sessionId: String, slotIndex: NSNumber?, callback: @escaping RCTResponseSenderBlock) {
        runOnMain { [weak self] in
            guard let self = self else { return }
            do {
                try self.beginSession(role: .guest, token: token, sessionId: sessionId, publish: true)
                callback([])
            } catch {
                callback([self.errorBody("GUEST_START_FAILED", error.localizedDescription)])
            }
        }
    }

    @objc(stopGuestSession:)
    func stopGuestSession(_ callback: @escaping RCTResponseSenderBlock) {
        runOnMain { [weak self] in
            self?.endSession(reason: "guest_stop")
            callback([])
        }
    }

    @objc(joinAsViewerReadOnly:token:sessionId:callback:)
    func joinAsViewerReadOnly(_ stageArn: String, token: String, sessionId: String, callback: @escaping RCTResponseSenderBlock) {
        runOnMain { [weak self] in
            guard let self = self else { return }
            do {
                try self.beginSession(role: .viewer, token: token, sessionId: sessionId, publish: false)
                callback([])
            } catch {
                callback([self.errorBody("VIEWER_JOIN_FAILED", error.localizedDescription)])
            }
        }
    }

    @objc(leaveAsViewerReadOnly:)
    func leaveAsViewerReadOnly(_ callback: @escaping RCTResponseSenderBlock) {
        runOnMain { [weak self] in
            self?.endSession(reason: "viewer_leave")
            callback([])
        }
    }

    @objc(forceReattach:callback:)
    func forceReattach(_ reason: String, callback: @escaping RCTResponseSenderBlock) {
        // iOS attaches preview UIViews directly; nudge views to re-bind.
        runOnMain {
            NotificationCenter.default.post(name: BlypIVSRenderRegistry.didChangeNotification, object: BlypIVSRenderRegistry.shared)
            callback([])
        }
    }

    @objc(setMicEnabled:callback:)
    func setMicEnabled(_ enabled: Bool, callback: @escaping RCTResponseSenderBlock) {
        runOnMain { [weak self] in
            guard let self = self else { return }
            self.micEnabled = enabled
            self.micStream?.setMuted(!enabled)
            self.emitLocalTrackUpdate()
            callback([])
        }
    }

    @objc(setCameraEnabled:callback:)
    func setCameraEnabled(_ enabled: Bool, callback: @escaping RCTResponseSenderBlock) {
        runOnMain { [weak self] in
            guard let self = self else { return }
            self.cameraEnabled = enabled
            self.cameraStream?.setMuted(!enabled)
            self.emitLocalTrackUpdate()
            callback([])
        }
    }

    @objc(switchCamera:)
    func switchCamera(_ callback: @escaping RCTResponseSenderBlock) {
        runOnMain { [weak self] in
            guard let self = self, let camera = self.camera else {
                callback([])
                return
            }
            let target: IVSDevicePosition = (self.cameraPosition == .front) ? .back : .front
            if let source = camera.listAvailableInputSources().first(where: { $0.position == target }) {
                do {
                    try camera.setPreferredInputSource(source)
                    self.cameraPosition = target
                    // Rebuild the local preview so it reflects the new source.
                    self.refreshLocalPreview()
                    callback([])
                } catch {
                    callback([self.errorBody("SWITCH_CAMERA_FAILED", error.localizedDescription)])
                }
            } else {
                callback([self.errorBody("SWITCH_CAMERA_FAILED", "No camera source for requested position")])
            }
        }
    }

    // MARK: - Session lifecycle

    private func beginSession(role: Role, token: String, sessionId: String, publish: Bool) throws {
        // Tear down any prior session first.
        teardownStage(reason: "begin_\(role.rawValue)")

        self.role = role
        self.currentSessionId = sessionId
        self.hasEmittedLocalJoined = false
        self.participantsWithVideo.removeAll()
        BlypIVSRenderRegistry.shared.setCurrentSessionId(sessionId)

        // Audio routing must be configured before creating DeviceDiscovery / Stage.
        configureStageAudio(publishing: publish, role: role.rawValue)

        if publish {
            try setupLocalStreams()
        }

        let stage = try IVSStage(token: token, strategy: self)
        stage.errorDelegate = self
        stage.addRenderer(self)
        self.stage = stage
        try stage.join()

        emit("IVS_BROADCAST_STATE_CHANGED", ["state": "CONNECTING"])
    }

    /// Keep remote stage speech on the loudspeaker while preserving the publishing mic.
    ///
    /// The explicit `defaultToSpeaker` option matters for host/guest sessions because
    /// `playAndRecord` otherwise permits receiver/earpiece routing. Voice processing and
    /// the video-chat mode remain enabled so loudspeaker output does not feed the mic.
    /// Read-only viewers use the media-quality subscribe-only preset.
    private func configureStageAudio(publishing: Bool, role: String) {
        let audioManager = IVSStageAudioManager.sharedInstance()
        if publishing {
            audioManager.setCategory(
                .playAndRecord,
                options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker, .mixWithOthers],
                mode: .videoChat
            )
            audioManager.isEchoCancellationEnabled = true
        } else {
            audioManager.setPreset(.subscribeOnly)
        }

        NSLog(
            "[IVS_AUDIO_ROUTE] role=%@ publishing=%@ category=%ld mode=%ld defaultToSpeaker=%@",
            role,
            publishing ? "true" : "false",
            audioManager.category.rawValue,
            audioManager.mode.rawValue,
            audioManager.options.contains(.defaultToSpeaker) ? "true" : "false"
        )
    }

    private func setupLocalStreams() throws {
        let discovery = IVSDeviceDiscovery()
        self.deviceDiscovery = discovery
        let devices = discovery.listLocalDevices()

        if let cam = devices.compactMap({ $0 as? IVSCamera }).first {
            if let front = cam.listAvailableInputSources().first(where: { $0.position == cameraPosition }) {
                try? cam.setPreferredInputSource(front)
            }
            self.camera = cam
            let stream = IVSLocalStageStream(device: cam)
            stream.setMuted(!cameraEnabled)
            self.cameraStream = stream
        }

        if let mic = devices.compactMap({ $0 as? IVSMicrophone }).first {
            self.microphone = mic
            let stream = IVSLocalStageStream(device: mic)
            stream.setMuted(!micEnabled)
            self.micStream = stream
        }

        refreshLocalPreview()
        emitLocalTrackUpdate()
    }

    private func refreshLocalPreview() {
        guard let cam = camera else { return }
        if let preview = try? cam.previewView(with: .fill) {
            BlypIVSRenderRegistry.shared.setLocalPreview(preview)
            emit("IVS_SURFACE_READY", ["ready": true, "width": 0, "height": 0])
        }
    }

    private func emitLocalTrackUpdate() {
        emit("IVS_LOCAL_TRACK_UPDATE", [
            "videoEnabled": cameraEnabled && (cameraStream != nil),
            "audioEnabled": micEnabled && (micStream != nil),
        ])
    }

    private func endSession(reason: String) {
        let participantId = localParticipantId ?? "local"
        teardownStage(reason: reason)
        emit("IVS_HOST_LOCAL_LEFT", ["participantId": participantId, "reason": reason])
        emit("IVS_BROADCAST_STATE_CHANGED", ["state": "DISCONNECTED"])
    }

    private func teardownStage(reason: String) {
        stage?.leave()
        stage?.removeRenderer(self)
        stage = nil
        cameraStream = nil
        micStream = nil
        camera = nil
        microphone = nil
        deviceDiscovery = nil
        role = .idle
        localParticipantId = nil
        hasEmittedLocalJoined = false
        participantsWithVideo.removeAll()
        BlypIVSRenderRegistry.shared.reset()
        configureStageAudio(publishing: false, role: Role.idle.rawValue)
    }
}

// MARK: - IVSStageStrategy

extension IVSBroadcastModule: IVSStageStrategy {

    func stage(_ stage: IVSStage, streamsToPublishForParticipant participant: IVSParticipantInfo) -> [IVSLocalStageStream] {
        guard role == .host || role == .guest else { return [] }
        var streams: [IVSLocalStageStream] = []
        if let cameraStream = cameraStream { streams.append(cameraStream) }
        if let micStream = micStream { streams.append(micStream) }
        return streams
    }

    func stage(_ stage: IVSStage, shouldPublishParticipant participant: IVSParticipantInfo) -> Bool {
        return role == .host || role == .guest
    }

    func stage(_ stage: IVSStage, shouldSubscribeToParticipant participant: IVSParticipantInfo) -> IVSStageSubscribeType {
        // Everyone (host, guest, viewer) wants to see/hear every other publisher.
        return .audioVideo
    }
}

// MARK: - IVSStageRenderer

extension IVSBroadcastModule: IVSStageRenderer {

    func stage(_ stage: IVSStage, participantDidJoin participant: IVSParticipantInfo) {
        if participant.isLocal {
            localParticipantId = participant.participantId
            return
        }
        runOnMain { [weak self] in
            guard let self = self else { return }
            var attrs: [String: String] = [:]
            for (k, v) in participant.attributes {
                if let s = v as? String { attrs[k] = s }
                else if let n = v as? NSNumber { attrs[k] = n.stringValue }
            }
            let slot = BlypIVSRenderRegistry.shared.assignSlot(forParticipant: participant.participantId, attributes: attrs)
            self.emit("IVS_REMOTE_PARTICIPANT_JOINED", [
                "participantId": participant.participantId,
                "userId": participant.attributes["userId"] as Any,
                "slotIndex": slot,
                "role": participant.attributes["role"] ?? "guest",
            ])
        }
    }

    func stage(_ stage: IVSStage, participantDidLeave participant: IVSParticipantInfo) {
        if participant.isLocal { return }
        runOnMain { [weak self] in
            guard let self = self else { return }
            self.participantsWithVideo.remove(participant.participantId)
            BlypIVSRenderRegistry.shared.releaseSlot(forParticipant: participant.participantId)
            self.emit("IVS_REMOTE_PARTICIPANT_LEFT", [
                "participantId": participant.participantId,
                "reason": "left",
            ])
        }
    }

    func stage(_ stage: IVSStage, participant: IVSParticipantInfo, didChange publishState: IVSParticipantPublishState) {
        guard participant.isLocal else { return }
        if publishState == .published && !hasEmittedLocalJoined {
            hasEmittedLocalJoined = true
            runOnMain { [weak self] in
                guard let self = self else { return }
                self.emit("IVS_HOST_LOCAL_JOINED", [
                    "participantId": participant.participantId,
                    "sessionId": self.currentSessionId as Any,
                    "role": self.role == .guest ? "guest" : "host",
                    "slotIndex": 0,
                ])
                self.emitLocalTrackUpdate()
            }
        }
    }

    func stage(_ stage: IVSStage, participant: IVSParticipantInfo, didChange subscribeState: IVSParticipantSubscribeState) {
        // No-op: video add/remove drives the UI.
    }

    func stage(_ stage: IVSStage, participant: IVSParticipantInfo, didAdd streams: [IVSStageStream]) {
        guard !participant.isLocal else { return }
        runOnMain { [weak self] in
            guard let self = self else { return }
            let pid = participant.participantId
            var attrs: [String: String] = [:]
            for (k, v) in participant.attributes {
                if let s = v as? String { attrs[k] = s }
                else if let n = v as? NSNumber { attrs[k] = n.stringValue }
            }
            // Prefer sticky token slot; assign if join callback was missed.
            let existing = BlypIVSRenderRegistry.shared.slot(forParticipant: pid)
            let slot = existing >= 0
                ? existing
                : BlypIVSRenderRegistry.shared.assignSlot(forParticipant: pid, attributes: attrs)
            for stream in streams {
                if let imageDevice = stream.device as? IVSImageDevice {
                    if let preview = try? imageDevice.previewView(with: .fill) {
                        BlypIVSRenderRegistry.shared.setRemotePreview(preview, forParticipant: pid)
                    }
                    // streamKey required by JS multi-guest registry (Android parity).
                    let streamKey = "\(pid):video"
                    self.emit("IVS_REMOTE_VIDEO_ADDED", [
                        "participantId": pid,
                        "userId": participant.attributes["userId"] as Any,
                        "streamKey": streamKey,
                        "slotIndex": slot,
                        "role": participant.attributes["role"] ?? "guest",
                    ])
                    if !self.participantsWithVideo.contains(pid) {
                        self.participantsWithVideo.insert(pid)
                        self.emit("IVS_REMOTE_FIRST_FRAME_SIGNAL", [
                            "streamKey": pid,
                            "sessionId": self.currentSessionId as Any,
                        ])
                    }
                }
            }
        }
    }

    func stage(_ stage: IVSStage, participant: IVSParticipantInfo, didRemove streams: [IVSStageStream]) {
        guard !participant.isLocal else { return }
        runOnMain { [weak self] in
            guard let self = self else { return }
            let pid = participant.participantId
            var removedVideo = false
            for stream in streams where stream.device is IVSImageDevice {
                removedVideo = true
            }
            if removedVideo {
                BlypIVSRenderRegistry.shared.removeRemotePreview(forParticipant: pid)
                self.emit("IVS_REMOTE_VIDEO_REMOVED", [
                    "participantId": pid,
                    "userId": participant.attributes["userId"] as Any,
                ])
            }
        }
    }

    func stage(_ stage: IVSStage, participant: IVSParticipantInfo, didChangeMutedStreams streams: [IVSStageStream]) {
        guard !participant.isLocal else { return }
        var audioMuted: Bool? = nil
        var videoMuted: Bool? = nil
        for stream in streams {
            if stream.device is IVSAudioDevice { audioMuted = stream.isMuted }
            if stream.device is IVSImageDevice { videoMuted = stream.isMuted }
        }
        runOnMain { [weak self] in
            guard let self = self else { return }
            var body: [String: Any] = ["participantId": participant.participantId]
            if let audioMuted = audioMuted { body["isMuted"] = audioMuted }
            if let videoMuted = videoMuted { body["isCameraDisabled"] = videoMuted }
            self.emit("IVS_REMOTE_PARTICIPANT_UPDATED", body)
        }
    }

    func stage(_ stage: IVSStage, didChange connectionState: IVSStageConnectionState, withError error: Error?) {
        let stateString: String
        switch connectionState {
        case .disconnected: stateString = "DISCONNECTED"
        case .connecting: stateString = "CONNECTING"
        case .connected: stateString = "CONNECTED"
        @unknown default: stateString = "UNKNOWN"
        }
        runOnMain { [weak self] in
            guard let self = self else { return }
            self.emit("IVS_BROADCAST_STATE_CHANGED", ["state": stateString])
            if let error = error {
                self.emit("IVS_BROADCAST_ERROR", self.errorBody("STAGE_ERROR", error.localizedDescription))
            }
        }
    }
}

// MARK: - IVSErrorDelegate

extension IVSBroadcastModule: IVSErrorDelegate {
    func source(_ source: IVSErrorSource, didEmitError error: Error) {
        runOnMain { [weak self] in
            self?.emit("IVS_BROADCAST_ERROR", self?.errorBody("IVS_ERROR", error.localizedDescription) ?? [:])
        }
    }
}
