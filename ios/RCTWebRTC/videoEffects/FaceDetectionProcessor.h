#import <Foundation/Foundation.h>
#import <WebRTC/RTCVideoCapturer.h>
#import <Vision/Vision.h>
#import "VideoFrameProcessor.h"

@class RCTEventEmitter;

@interface FaceDetectionProcessor : NSObject<VideoFrameProcessorDelegate>

@property (nonatomic, weak) RCTEventEmitter *eventEmitter;
@property (nonatomic, assign) BOOL isEnabled;
@property (nonatomic, assign) NSInteger frameSkipCount; // Process every Nth frame
@property (nonatomic, assign) CGFloat blinkThreshold; // EAR threshold for blink detection

- (instancetype)initWithEventEmitter:(RCTEventEmitter *)eventEmitter;
- (void)reset;

@end

