import Foundation

@objc(BlypShorts)
final class ShortsModule: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { true }

  @objc func prefetchOpening(_ uri: NSString?, bytes: NSNumber, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
    let u = (uri as String?)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let n = bytes.doubleValue > 0 ? Int64(bytes.doubleValue) : ShortsPool.openingDefaultBytes
    ShortsPool.shared.io.async {
      resolver(ShortsPool.shared.prefetchOpening(uri: u, bytes: n))
    }
  }

  @objc func prefetchOpenings(_ uris: [Any]?, bytes: NSNumber, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
    let n = bytes.doubleValue > 0 ? Int64(bytes.doubleValue) : ShortsPool.openingDefaultBytes
    ShortsPool.shared.io.async {
      var count = 0
      for item in uris ?? [] {
        if let t = item as? String, !t.isEmpty, ShortsPool.shared.prefetchOpening(uri: t, bytes: n) {
          count += 1
        }
      }
      resolver(count)
    }
  }

  @objc func getDiagnostics(_ resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
    resolver(ShortsPool.shared.diagnostics())
  }

  @objc func releaseAll(_ resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
    ShortsPool.shared.releaseAll()
    resolver(true)
  }
}
