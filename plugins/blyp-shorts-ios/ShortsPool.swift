import Foundation
import UIKit
import AVFoundation

/// Ground-up For You AVPlayer pool (DESIGN §2). Never touches AVAudioSession —
/// JS feedAudioSession + livePublishAudioGuard owns audible mode for LIVE safety.
@objc(ShortsPool)
final class ShortsPool: NSObject {
  static let shared = ShortsPool()
  static let poolSize = 3
  static let openingDefaultBytes: Int64 = 1_024_000

  private struct Slot {
    var player: AVPlayer?
    var item: AVPlayerItem?
    var uri: String?
    weak var view: ShortsSurfaceView?
    var muted: Bool = true
    var playing: Bool = false
    var role: String = "neighbor"
    var ready: Bool = false
    var didSeekOnActivate: Bool = false
    var endObserver: NSObjectProtocol?
    var statusObservation: NSKeyValueObservation?
  }

  private var slots: [Slot] = (0..<ShortsPool.poolSize).map { _ in Slot() }
  let io = DispatchQueue(label: "com.blyp.shorts.opening", qos: .utility, attributes: .concurrent)
  private var openingJobs = Set<String>()
  private let lock = NSLock()

  private override init() {
    super.init()
    // Intentionally no AVAudioSession mutation.
  }

  private func ensurePlayer(_ idx: Int) -> AVPlayer {
    if let p = slots[idx].player { return p }
    let p = AVPlayer()
    p.actionAtItemEnd = .none
    p.isMuted = true
    slots[idx].player = p
    return p
  }

  private func pickSlot(uri: String, preferView: ShortsSurfaceView?) -> Int {
    for i in 0..<slots.count where slots[i].uri == uri { return i }
    for i in 0..<slots.count where slots[i].view === preferView { return i }
    for i in 0..<slots.count where slots[i].uri == nil && slots[i].view == nil { return i }
    for i in 0..<slots.count where !slots[i].playing && slots[i].view == nil { return i }
    for i in 0..<slots.count where !slots[i].playing { return i }
    return 0
  }

  private func pickWarmSlot(uri: String) -> Int? {
    for i in 0..<slots.count where slots[i].uri == uri { return i }
    for i in 0..<slots.count where slots[i].view == nil && !slots[i].playing && slots[i].uri == nil {
      return i
    }
    for i in 0..<slots.count where slots[i].view == nil && !slots[i].playing { return i }
    return nil
  }

  func bind(view: ShortsSurfaceView, uri: String, playing: Bool, muted: Bool, role: String, resizeMode: String) {
    DispatchQueue.main.async {
      guard !uri.isEmpty else {
        self.unbind(view: view)
        return
      }
      for i in 0..<self.slots.count {
        if self.slots[i].view === view && self.slots[i].uri != uri {
          self.detachLayer(i)
          self.slots[i].view = nil
        }
      }
      let idx = self.pickSlot(uri: uri, preferView: view)
      if let other = self.slots[idx].view, other !== view {
        self.detachLayer(idx)
        self.slots[idx].view = nil
      }
      let player = self.ensurePlayer(idx)
      let uriChanged = self.slots[idx].uri != uri
      self.slots[idx].view = view
      self.slots[idx].muted = muted
      self.slots[idx].playing = playing
      self.slots[idx].role = role == "active" ? "active" : "neighbor"
      view.attachSlot(idx)
      view.applyResizeMode(resizeMode)

      if uriChanged {
        self.slots[idx].uri = uri
        self.slots[idx].ready = false
        self.slots[idx].didSeekOnActivate = false
        self.replaceItem(idx: idx, uri: uri, player: player)
      }
      view.bindPlayerLayer(player)
      // Active bind always parks at t=0 (promote / remount onto warm URI).
      if self.slots[idx].role == "active" {
        player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)
        self.slots[idx].didSeekOnActivate = true
      }
      self.applyPlayback(idx)
      self.slots[idx].item?.preferredForwardBufferDuration =
        self.slots[idx].role == "active" ? 6 : 1.5
    }
  }

  func seekView(view: ShortsSurfaceView, ms: CMTime) {
    DispatchQueue.main.async {
      for i in 0..<self.slots.count where self.slots[i].view === view {
        self.slots[i].player?.seek(to: ms, toleranceBefore: .zero, toleranceAfter: .zero)
        if CMTimeGetSeconds(ms) <= 0.001 && self.slots[i].role == "active" {
          self.slots[i].didSeekOnActivate = true
        }
        return
      }
    }
  }

  func unbind(view: ShortsSurfaceView) {
    DispatchQueue.main.async {
      for i in 0..<self.slots.count where self.slots[i].view === view {
        self.detachLayer(i)
        self.slots[i].view = nil
        self.slots[i].playing = false
        self.slots[i].player?.pause()
        view.attachSlot(-1)
        return
      }
    }
  }

  func updatePlayback(view: ShortsSurfaceView, playing: Bool, muted: Bool, role: String) {
    DispatchQueue.main.async {
      for i in 0..<self.slots.count where self.slots[i].view === view {
        self.slots[i].playing = playing
        self.slots[i].muted = muted
        self.slots[i].role = role == "active" ? "active" : "neighbor"
        self.applyPlayback(i)
        return
      }
    }
  }

  private func applyPlayback(_ idx: Int) {
    let slot = slots[idx]
    guard let player = slot.player else { return }
    let wantAudible = slot.playing && !slot.muted && slot.role == "active"
    // Seek-to-0 on every activate (muted or unmuted) — TikTok settle bar.
    if slot.role == "active" && slot.playing && !slot.didSeekOnActivate {
      player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)
      slots[idx].didSeekOnActivate = true
    } else if slot.role != "active" {
      slots[idx].didSeekOnActivate = false
    }
    player.isMuted = slot.muted || !wantAudible
    if slot.playing {
      player.play()
    } else {
      player.pause()
    }
  }

  private func detachLayer(_ idx: Int) {
    slots[idx].view?.unbindPlayerLayer()
  }

  private func clearItemObservers(_ idx: Int) {
    if let obs = slots[idx].endObserver {
      NotificationCenter.default.removeObserver(obs)
      slots[idx].endObserver = nil
    }
    slots[idx].statusObservation?.invalidate()
    slots[idx].statusObservation = nil
  }

  private func replaceItem(idx: Int, uri: String, player: AVPlayer) {
    clearItemObservers(idx)
    guard let url = URL(string: uri) else { return }
    let asset = AVURLAsset(url: url)
    let item = AVPlayerItem(asset: asset)
    item.preferredForwardBufferDuration = 1.5
    if #available(iOS 15.0, *) {
      item.preferredPeakBitRate = 1_800_000
    }
    slots[idx].item = item
    slots[idx].ready = false
    player.replaceCurrentItem(with: item)

    let view = slots[idx].view
    slots[idx].statusObservation = item.observe(\.status, options: [.new]) { [weak self, weak view] item, _ in
      guard let self = self else { return }
      DispatchQueue.main.async {
        if item.status == .readyToPlay {
          self.slots[idx].ready = true
          view?.emitReady()
          view?.emitFirstFrame()
          let size = item.presentationSize
          if size.width > 0, size.height > 0 {
            view?.emitVideoSize(width: Int(size.width), height: Int(size.height))
          }
          if self.slots[idx].role == "neighbor" {
            player.pause()
            player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)
            player.isMuted = true
          }
        } else if item.status == .failed {
          view?.emitError(code: "AVPLAYER_FAILED", message: item.error?.localizedDescription ?? "playback_error")
        }
      }
    }

    slots[idx].endObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemDidPlayToEndTime,
      object: item,
      queue: .main
    ) { [weak player] _ in
      player?.seek(to: .zero)
      player?.play()
    }
  }

  /// Real warm: prepare a pooled AVPlayer for uri (same slot bind will reuse).
  @discardableResult
  func prefetchOpening(uri: String, bytes: Int64 = ShortsPool.openingDefaultBytes) -> Bool {
    guard uri.hasPrefix("http://") || uri.hasPrefix("https://"), URL(string: uri) != nil else {
      return false
    }
    lock.lock()
    if openingJobs.contains(uri) {
      lock.unlock()
      return false
    }
    openingJobs.insert(uri)
    lock.unlock()

    let sem = DispatchSemaphore(value: 0)
    var ok = false
    DispatchQueue.main.async {
      defer { sem.signal() }
      if self.slots.contains(where: { $0.uri == uri && $0.ready }) {
        ok = true
        return
      }
      guard let idx = self.pickWarmSlot(uri: uri) else {
        ok = false
        return
      }
      let player = self.ensurePlayer(idx)
      if self.slots[idx].uri != uri {
        self.slots[idx].uri = uri
        self.slots[idx].muted = true
        self.slots[idx].playing = false
        self.slots[idx].role = "neighbor"
        self.slots[idx].ready = false
        self.replaceItem(idx: idx, uri: uri, player: player)
      }
      player.isMuted = true
      player.play()
      let deadline = Date().addingTimeInterval(8)
      while Date() < deadline {
        if self.slots[idx].ready || self.slots[idx].item?.status == .readyToPlay {
          self.slots[idx].ready = true
          break
        }
        if self.slots[idx].item?.status == .failed { break }
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))
      }
      player.pause()
      player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)
      player.isMuted = true
      self.slots[idx].playing = false
      ok = self.slots[idx].ready
      _ = bytes
    }
    _ = sem.wait(timeout: .now() + 10)
    lock.lock()
    openingJobs.remove(uri)
    lock.unlock()
    return ok
  }

  func cancelPrefetch(uri: String) {
    lock.lock()
    openingJobs.remove(uri)
    lock.unlock()
  }

  func diagnostics() -> [String: Any] {
    [
      "engine": "BlypShorts",
      "poolSize": ShortsPool.poolSize,
      "openingJobs": openingJobs.count,
    ]
  }

  func releaseAll() {
    DispatchQueue.main.async {
      for i in 0..<self.slots.count {
        self.detachLayer(i)
        self.clearItemObservers(i)
        self.slots[i].player?.pause()
        self.slots[i].player?.replaceCurrentItem(with: nil)
        self.slots[i] = Slot()
      }
    }
  }
}
