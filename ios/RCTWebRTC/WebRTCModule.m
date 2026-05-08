#if !TARGET_OS_OSX
#import <UIKit/UIKit.h>
#endif

#import <React/RCTBridge.h>
#import <React/RCTEventDispatcher.h>
#import <React/RCTLog.h>
#import <React/RCTUtils.h>

#import "WebRTCModule+RTCPeerConnection.h"
#import "WebRTCModule.h"
#import "WebRTCModuleOptions.h"
#import "videoEffects/ProcessorProvider.h"
#import "videoEffects/FaceDetectionProcessor.h"
#import "videoEffects/ImageAdjustmentProcessor.h"

@interface WebRTCModule ()
@property (nonatomic, strong) FaceDetectionProcessor *faceDetectionProcessor;
@property (nonatomic, strong) ImageAdjustmentProcessor *imageAdjustmentProcessor;
@end

@implementation WebRTCModule

+ (BOOL)requiresMainQueueSetup {
    return NO;
}

- (void)dealloc {
    [_localTracks removeAllObjects];
    _localTracks = nil;
    [_localStreams removeAllObjects];
    _localStreams = nil;

    for (NSNumber *peerConnectionId in _peerConnections) {
        RTCPeerConnection *peerConnection = _peerConnections[peerConnectionId];
        peerConnection.delegate = nil;
        [peerConnection close];
    }
    [_peerConnections removeAllObjects];

    _peerConnectionFactory = nil;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        WebRTCModuleOptions *options = [WebRTCModuleOptions sharedInstance];
        id<RTCAudioDevice> audioDevice = options.audioDevice;
        id<RTCVideoDecoderFactory> decoderFactory = options.videoDecoderFactory;
        id<RTCVideoEncoderFactory> encoderFactory = options.videoEncoderFactory;
        NSDictionary *fieldTrials = options.fieldTrials;
        RTCLoggingSeverity loggingSeverity = options.loggingSeverity;

        // Initialize field trials.
        if (fieldTrials == nil) {
            // Fix for dual-sim connectivity:
            // https://bugs.chromium.org/p/webrtc/issues/detail?id=10966
            fieldTrials = @{kRTCFieldTrialUseNWPathMonitor : kRTCFieldTrialEnabledValue};
        }
        RTCInitFieldTrialDictionary(fieldTrials);

        // Initialize logging.
        RTCSetMinDebugLogLevel(loggingSeverity);

        if (encoderFactory == nil) {
            encoderFactory = [[RTCDefaultVideoEncoderFactory alloc] init];
        }
        if (decoderFactory == nil) {
            decoderFactory = [[RTCDefaultVideoDecoderFactory alloc] init];
        }
        _encoderFactory = encoderFactory;
        _decoderFactory = decoderFactory;

        RCTLogInfo(@"Using video encoder factory: %@", NSStringFromClass([encoderFactory class]));
        RCTLogInfo(@"Using video decoder factory: %@", NSStringFromClass([decoderFactory class]));

        _peerConnectionFactory = [[RTCPeerConnectionFactory alloc] initWithEncoderFactory:encoderFactory
                                                                           decoderFactory:decoderFactory
                                                                              audioDevice:audioDevice];

        _peerConnections = [NSMutableDictionary new];
        _localStreams = [NSMutableDictionary new];
        _localTracks = [NSMutableDictionary new];

        dispatch_queue_attr_t attributes =
            dispatch_queue_attr_make_with_qos_class(DISPATCH_QUEUE_SERIAL, QOS_CLASS_USER_INITIATED, -1);
        _workerQueue = dispatch_queue_create("WebRTCModule.queue", attributes);
        
        // Initialize and register face detection processor
        _faceDetectionProcessor = [[FaceDetectionProcessor alloc] initWithEventEmitter:self];
        [ProcessorProvider addProcessor:_faceDetectionProcessor forName:@"faceDetection"];

        // Initialize and register image adjustment processor
        _imageAdjustmentProcessor = [[ImageAdjustmentProcessor alloc] init];
        [ProcessorProvider addProcessor:_imageAdjustmentProcessor forName:@"imageAdjustment"];
    }

    return self;
}

- (RTCMediaStream *)streamForReactTag:(NSString *)reactTag {
    RTCMediaStream *stream = _localStreams[reactTag];
    if (!stream) {
        for (NSNumber *peerConnectionId in _peerConnections) {
            RTCPeerConnection *peerConnection = _peerConnections[peerConnectionId];
            stream = peerConnection.remoteStreams[reactTag];
            if (stream) {
                break;
            }
        }
    }
    return stream;
}

RCT_EXPORT_MODULE();

- (dispatch_queue_t)methodQueue {
    return _workerQueue;
}

- (NSArray<NSString *> *)supportedEvents {
    return @[
        kEventPeerConnectionSignalingStateChanged,
        kEventPeerConnectionStateChanged,
        kEventPeerConnectionOnRenegotiationNeeded,
        kEventPeerConnectionIceConnectionChanged,
        kEventPeerConnectionIceGatheringChanged,
        kEventPeerConnectionGotICECandidate,
        kEventPeerConnectionDidOpenDataChannel,
        kEventDataChannelDidChangeBufferedAmount,
        kEventDataChannelStateChanged,
        kEventDataChannelReceiveMessage,
        kEventMediaStreamTrackMuteChanged,
        kEventMediaStreamTrackEnded,
        kEventPeerConnectionOnRemoveTrack,
        kEventPeerConnectionOnTrack,
        kEventFaceDetected,
        kEventBlinkDetected
    ];
}

RCT_EXPORT_METHOD(enableFaceDetection
                  : (NSString *)trackId config
                  : (NSDictionary *)config resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject) {
    if (!self.faceDetectionProcessor) {
        reject(@"E_FACE_DETECTION", @"Face detection not initialized", nil);
        return;
    }
    
    self.faceDetectionProcessor.isEnabled = YES;
    
    // Apply configuration if provided
    if (config[@"frameSkipCount"]) {
        self.faceDetectionProcessor.frameSkipCount = [config[@"frameSkipCount"] integerValue];
    }
    if (config[@"blinkThreshold"]) {
        self.faceDetectionProcessor.blinkThreshold = [config[@"blinkThreshold"] floatValue];
    }
    // Frame capture config options
    if (config[@"captureOnBlink"]) {
        self.faceDetectionProcessor.captureOnBlink = [config[@"captureOnBlink"] boolValue];
    }
    if (config[@"cropToFace"]) {
        self.faceDetectionProcessor.cropToFace = [config[@"cropToFace"] boolValue];
    }
    if (config[@"imageQuality"]) {
        self.faceDetectionProcessor.imageQuality = [config[@"imageQuality"] floatValue];
    }
    if (config[@"maxImageWidth"]) {
        self.faceDetectionProcessor.maxImageWidth = [config[@"maxImageWidth"] integerValue];
    }
    // Blink validation config
    if (config[@"minBlinkDurationMs"]) {
        self.faceDetectionProcessor.minBlinkDurationMs = [config[@"minBlinkDurationMs"] integerValue];
    }
    if (config[@"maxBlinkDurationMs"]) {
        self.faceDetectionProcessor.maxBlinkDurationMs = [config[@"maxBlinkDurationMs"] integerValue];
    }
    if (config[@"blinkCooldownMs"]) {
        self.faceDetectionProcessor.blinkCooldownMs = [config[@"blinkCooldownMs"] integerValue];
    }
    // Adaptive threshold config
    if (config[@"adaptiveThreshold"]) {
        self.faceDetectionProcessor.adaptiveThreshold = [config[@"adaptiveThreshold"] boolValue];
    }
    if (config[@"calibrationDurationMs"]) {
        self.faceDetectionProcessor.calibrationDurationMs = [config[@"calibrationDurationMs"] integerValue];
    }
    // Start calibration if adaptive threshold is enabled
    if (self.faceDetectionProcessor.adaptiveThreshold) {
        [self.faceDetectionProcessor startCalibrationIfNeeded];
    }

    resolve(@YES);
}

RCT_EXPORT_METHOD(disableFaceDetection
                  : (NSString *)trackId resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject) {
    if (!self.faceDetectionProcessor) {
        reject(@"E_FACE_DETECTION", @"Face detection not initialized", nil);
        return;
    }

    self.faceDetectionProcessor.isEnabled = NO;
    [self.faceDetectionProcessor reset];

    resolve(@YES);
}

#pragma mark - Image Adjustment

RCT_EXPORT_METHOD(enableImageAdjustment
                  : (NSString *)trackId config
                  : (NSDictionary *)config resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject) {
    if (!self.imageAdjustmentProcessor) {
        reject(@"E_IMAGE_ADJUSTMENT", @"Image adjustment not initialized", nil);
        return;
    }

    self.imageAdjustmentProcessor.isEnabled = YES;
    [self.imageAdjustmentProcessor updateConfig:config];

    resolve(@YES);
}

RCT_EXPORT_METHOD(updateImageAdjustment
                  : (NSString *)trackId config
                  : (NSDictionary *)config resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject) {
    if (!self.imageAdjustmentProcessor) {
        reject(@"E_IMAGE_ADJUSTMENT", @"Image adjustment not initialized", nil);
        return;
    }

    [self.imageAdjustmentProcessor updateConfig:config];

    resolve(@YES);
}

RCT_EXPORT_METHOD(disableImageAdjustment
                  : (NSString *)trackId resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject) {
    if (!self.imageAdjustmentProcessor) {
        reject(@"E_IMAGE_ADJUSTMENT", @"Image adjustment not initialized", nil);
        return;
    }

    self.imageAdjustmentProcessor.isEnabled = NO;
    self.imageAdjustmentProcessor.isBypassed = NO;
    [self.imageAdjustmentProcessor reset];

    resolve(@YES);
}

RCT_EXPORT_METHOD(bypassImageAdjustment
                  : (NSString *)trackId bypass
                  : (BOOL)bypass resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject) {
    if (!self.imageAdjustmentProcessor) {
        reject(@"E_IMAGE_ADJUSTMENT", @"Image adjustment not initialized", nil);
        return;
    }

    self.imageAdjustmentProcessor.isBypassed = bypass;

    resolve(@YES);
}

@end
