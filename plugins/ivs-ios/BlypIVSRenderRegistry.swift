import Foundation
import UIKit
import AmazonIVSBroadcast

/// Shared bridge between the IVS Stage module (which owns the SDK preview views)
/// and the React Native UIViews that must host them.
///
/// On Android the JS views hand a `Surface` down to the native module. On iOS the
/// IVS SDK instead vends a `previewView()` UIView per image stream, so the data
/// flows the other way: the module publishes preview views here, and the RN views
/// pull/attach them. Views observe `didChangeNotification` to re-bind on updates.
@objc(BlypIVSRenderRegistry)
final class BlypIVSRenderRegistry: NSObject {

    @objc static let shared = BlypIVSRenderRegistry()

    /// Posted whenever the local or any remote preview view changes. RN views
    /// observe this to (re)attach the correct preview into their hierarchy.
    @objc static let didChangeNotification = Notification.Name("BlypIVSRenderRegistryDidChange")

    private let lock = NSRecursiveLock()

    private var localPreviewView: IVSImagePreviewView?
    private var remotePreviewViews: [String: IVSImagePreviewView] = [:]
    /// participantId -> assigned slot index (mirrors Android slot assignment).
    private var slotByParticipant: [String: Int] = [:]
    /// Most recent sessionId, used by views for attach gating/logging parity.
    private var currentSessionId: String?

    private override init() {
        super.init()
    }

    private func notifyChange() {
        // Always deliver on the main thread; RN views mutate the hierarchy here.
        if Thread.isMainThread {
            NotificationCenter.default.post(name: BlypIVSRenderRegistry.didChangeNotification, object: self)
        } else {
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: BlypIVSRenderRegistry.didChangeNotification, object: self)
            }
        }
    }

    // MARK: - Session

    @objc func setCurrentSessionId(_ sessionId: String?) {
        lock.lock(); defer { lock.unlock() }
        currentSessionId = sessionId
    }

    @objc func getCurrentSessionId() -> String? {
        lock.lock(); defer { lock.unlock() }
        return currentSessionId
    }

    // MARK: - Local (host/guest self) preview

    @objc func setLocalPreview(_ view: IVSImagePreviewView?) {
        lock.lock()
        localPreviewView = view
        lock.unlock()
        notifyChange()
    }

    @objc func getLocalPreview() -> IVSImagePreviewView? {
        lock.lock(); defer { lock.unlock() }
        return localPreviewView
    }

    @objc func clearLocalPreview() {
        lock.lock()
        localPreviewView = nil
        lock.unlock()
        notifyChange()
    }

    // MARK: - Remote participant previews

    @objc func setRemotePreview(_ view: IVSImagePreviewView, forParticipant participantId: String) {
        lock.lock()
        remotePreviewViews[participantId] = view
        lock.unlock()
        notifyChange()
    }

    @objc func removeRemotePreview(forParticipant participantId: String) {
        lock.lock()
        remotePreviewViews.removeValue(forKey: participantId)
        lock.unlock()
        notifyChange()
    }

    @objc func getRemotePreview(forParticipant participantId: String) -> IVSImagePreviewView? {
        lock.lock(); defer { lock.unlock() }
        return remotePreviewViews[participantId]
    }

    // MARK: - Slot assignment (parity with Android slotIndex)

    /// Sticky slot assignment. Honors host-assigned `slotIndex` from IVS token
    /// attributes so host + all viewers keep the same box. On leave, the slot is
    /// released but remaining guests are NOT compacted into lower indices.
    @objc func assignSlot(forParticipant participantId: String, attributes: [String: String]? = nil) -> Int {
        lock.lock(); defer { lock.unlock() }
        if let existing = slotByParticipant[participantId] { return existing }
        let used = Set(slotByParticipant.values)

        let role = attributes?["role"] ?? ""
        if role == "host" {
            slotByParticipant[participantId] = 0
            return 0
        }

        if let attrRaw = attributes?["slotIndex"], let attrSlot = Int(attrRaw), attrSlot >= 1, attrSlot <= 11, !used.contains(attrSlot) {
            slotByParticipant[participantId] = attrSlot
            return attrSlot
        }

        // First free sticky guest box (1-based). Never reuse slot 0 (host).
        var slot = 1
        while used.contains(slot) { slot += 1 }
        slotByParticipant[participantId] = slot
        return slot
    }

    @objc func slot(forParticipant participantId: String) -> Int {
        lock.lock(); defer { lock.unlock() }
        return slotByParticipant[participantId] ?? -1
    }

    @objc func releaseSlot(forParticipant participantId: String) {
        lock.lock()
        slotByParticipant.removeValue(forKey: participantId)
        remotePreviewViews.removeValue(forKey: participantId)
        lock.unlock()
        notifyChange()
    }

    @objc func reset() {
        lock.lock()
        localPreviewView = nil
        remotePreviewViews.removeAll()
        slotByParticipant.removeAll()
        currentSessionId = nil
        lock.unlock()
        notifyChange()
    }
}
