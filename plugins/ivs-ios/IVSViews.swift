import Foundation
import UIKit
import AmazonIVSBroadcast
import AmazonIVSPlayer

// MARK: - Helpers

private func fillSubview(_ subview: UIView, in container: UIView) {
    subview.translatesAutoresizingMaskIntoConstraints = true
    subview.frame = container.bounds
    subview.autoresizingMask = [.flexibleWidth, .flexibleHeight]
}

private func applyZoomTransform(_ view: UIView, _ zoom: CGFloat) {
    let z = (zoom.isFinite && zoom > 0) ? zoom : 1.0
    view.transform = CGAffineTransform(scaleX: z, y: z)
}

// MARK: - Host self-preview view ("IVSBroadcastView")

/// Hosts the local camera preview vended by the Stage module (host/guest self view).
final class BlypIVSBroadcastView: UIView {

    private var attachedPreview: IVSImagePreviewView?
    @objc var zoom: NSNumber = 1.0 { didSet { reapplyZoom() } }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(reattach),
            name: BlypIVSRenderRegistry.didChangeNotification,
            object: nil
        )
        reattach()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    deinit { NotificationCenter.default.removeObserver(self) }

    @objc private func reattach() {
        let preview = BlypIVSRenderRegistry.shared.getLocalPreview()
        if preview === attachedPreview {
            reapplyZoom()
            return
        }
        attachedPreview?.removeFromSuperview()
        attachedPreview = preview
        if let preview = preview {
            fillSubview(preview, in: self)
            addSubview(preview)
            reapplyZoom()
        }
    }

    private func reapplyZoom() {
        guard let preview = attachedPreview else { return }
        applyZoomTransform(preview, CGFloat(truncating: zoom))
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        attachedPreview?.frame = bounds
        reapplyZoom()
    }
}

@objc(IVSBroadcastViewManager)
final class IVSBroadcastViewManager: RCTViewManager {
    override static func requiresMainQueueSetup() -> Bool { true }
    override func view() -> UIView! { return BlypIVSBroadcastView() }
}

// MARK: - Remote participant tile ("IVSRealTimeView")

/// Hosts a remote participant's preview, keyed by `participantId`, vended by the Stage module.
final class BlypIVSRealTimeView: UIView {

    private var attachedPreview: IVSImagePreviewView?
    @objc var participantId: NSString? { didSet { reattach() } }
    @objc var slotId: NSNumber = -1
    // Session-wide track totals used to reattach every tile on every guest join.
    // Only (re)attach when tracks first become available for this tile.
    @objc var remoteTrackCount: NSNumber = 0 {
        didSet {
            let prev = oldValue.intValue
            let next = remoteTrackCount.intValue
            if prev <= 0 && next > 0 {
                reattach()
            }
        }
    }
    @objc var zoom: NSNumber = 1.0 { didSet { reapplyZoom() } }
    // Accepted for parity with the JS/Android prop contract; unused on iOS.
    @objc var stageArn: NSString?
    @objc var token: NSString?
    @objc var sessionId: NSString?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(reattach),
            name: BlypIVSRenderRegistry.didChangeNotification,
            object: nil
        )
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    deinit { NotificationCenter.default.removeObserver(self) }

    @objc private func reattach() {
        guard let pid = participantId as String?, !pid.isEmpty else {
            attachedPreview?.removeFromSuperview()
            attachedPreview = nil
            return
        }
        let preview = BlypIVSRenderRegistry.shared.getRemotePreview(forParticipant: pid)
        if preview === attachedPreview {
            reapplyZoom()
            return
        }
        attachedPreview?.removeFromSuperview()
        attachedPreview = preview
        if let preview = preview {
            fillSubview(preview, in: self)
            addSubview(preview)
            reapplyZoom()
        }
    }

    private func reapplyZoom() {
        guard let preview = attachedPreview else { return }
        applyZoomTransform(preview, CGFloat(truncating: zoom))
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        attachedPreview?.frame = bounds
        reapplyZoom()
    }
}

@objc(IVSRealTimeViewManager)
final class IVSRealTimeViewManager: RCTViewManager {
    override static func requiresMainQueueSetup() -> Bool { true }
    override func view() -> UIView! { return BlypIVSRealTimeView() }
}

// MARK: - HLS / low-latency viewer player ("IVSPlayerView")

/// Hosts the SDK `IVSPlayerView` bound to `IVSPlayerModule.sharedPlayer`.
final class BlypIVSPlayerView: UIView {

    private let playerView = IVSPlayerView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        playerView.videoGravity = .resizeAspect
        fillSubview(playerView, in: self)
        addSubview(playerView)
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(bindPlayer),
            name: IVSPlayerModule.playerDidChangeNotification,
            object: nil
        )
        bindPlayer()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    deinit { NotificationCenter.default.removeObserver(self) }

    @objc private func bindPlayer() {
        playerView.player = IVSPlayerModule.sharedPlayer
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        playerView.frame = bounds
    }
}

@objc(IVSPlayerViewManager)
final class IVSPlayerViewManager: RCTViewManager {
    override static func requiresMainQueueSetup() -> Bool { true }
    override func view() -> UIView! { return BlypIVSPlayerView() }
}
