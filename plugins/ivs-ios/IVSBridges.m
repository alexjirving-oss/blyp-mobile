#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTViewManager.h>

// MARK: - IVSBroadcastModule (host / guest / read-only viewer over IVS Stages)

@interface RCT_EXTERN_MODULE(IVSBroadcastModule, RCTEventEmitter)

RCT_EXTERN_METHOD(startHostSession:(NSString *)stageArn
                  token:(NSString *)token
                  sessionId:(NSString *)sessionId
                  callback:(RCTResponseSenderBlock)callback)

RCT_EXTERN_METHOD(stopHostSession:(RCTResponseSenderBlock)callback)

RCT_EXTERN_METHOD(startGuestSession:(NSString *)stageArn
                  token:(NSString *)token
                  sessionId:(NSString *)sessionId
                  slotIndex:(NSNumber *)slotIndex
                  callback:(RCTResponseSenderBlock)callback)

RCT_EXTERN_METHOD(stopGuestSession:(RCTResponseSenderBlock)callback)

RCT_EXTERN_METHOD(joinAsViewerReadOnly:(NSString *)stageArn
                  token:(NSString *)token
                  sessionId:(NSString *)sessionId
                  callback:(RCTResponseSenderBlock)callback)

RCT_EXTERN_METHOD(leaveAsViewerReadOnly:(RCTResponseSenderBlock)callback)

RCT_EXTERN_METHOD(forceReattach:(NSString *)reason
                  callback:(RCTResponseSenderBlock)callback)

RCT_EXTERN_METHOD(forceLiveLoudspeaker:(NSString *)reason
                  callback:(RCTResponseSenderBlock)callback)

RCT_EXTERN_METHOD(setMicEnabled:(BOOL)enabled
                  callback:(RCTResponseSenderBlock)callback)

RCT_EXTERN_METHOD(setCameraEnabled:(BOOL)enabled
                  callback:(RCTResponseSenderBlock)callback)

RCT_EXTERN_METHOD(switchCamera:(RCTResponseSenderBlock)callback)

@end

// MARK: - IVSPlayerModule (HLS / low-latency viewer playback)

@interface RCT_EXTERN_MODULE(IVSPlayerModule, RCTEventEmitter)

RCT_EXTERN_METHOD(joinAsViewer:(NSString *)playbackUrl
                  sessionId:(NSString *)sessionId
                  callback:(RCTResponseSenderBlock)callback)

RCT_EXTERN_METHOD(leaveAsViewer:(RCTResponseSenderBlock)callback)
RCT_EXTERN_METHOD(play:(RCTResponseSenderBlock)callback)
RCT_EXTERN_METHOD(pause:(RCTResponseSenderBlock)callback)
RCT_EXTERN_METHOD(stop:(RCTResponseSenderBlock)callback)
RCT_EXTERN_METHOD(forceLiveLoudspeaker:(NSString *)reason
                  callback:(RCTResponseSenderBlock)callback)

@end

// MARK: - Native views

@interface RCT_EXTERN_MODULE(IVSBroadcastViewManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(zoom, NSNumber)
@end

@interface RCT_EXTERN_MODULE(IVSRealTimeViewManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(participantId, NSString)
RCT_EXPORT_VIEW_PROPERTY(slotId, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(remoteTrackCount, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(zoom, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(stageArn, NSString)
RCT_EXPORT_VIEW_PROPERTY(token, NSString)
RCT_EXPORT_VIEW_PROPERTY(sessionId, NSString)
@end

@interface RCT_EXTERN_MODULE(IVSPlayerViewManager, RCTViewManager)
@end
