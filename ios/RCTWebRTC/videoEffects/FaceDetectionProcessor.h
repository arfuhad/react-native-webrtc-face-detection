#import <Foundation/Foundation.h>
#import <WebRTC/RTCVideoCapturer.h>
@import MLKitFaceDetection;
#import "VideoFrameProcessor.h"

@class RCTEventEmitter;

@interface FaceDetectionProcessor : NSObject<VideoFrameProcessorDelegate>

@property (nonatomic, weak) RCTEventEmitter *eventEmitter;
@property (nonatomic, assign) BOOL isEnabled;
@property (nonatomic, assign) NSInteger frameSkipCount; // Process every Nth frame
@property (nonatomic, assign) CGFloat blinkThreshold; // Eye open probability threshold (0.0-1.0)

// Frame capture configuration
@property (nonatomic, assign) BOOL captureOnBlink;    // Enable frame capture on blink
@property (nonatomic, assign) BOOL cropToFace;        // Crop to face region
@property (nonatomic, assign) CGFloat imageQuality;   // JPEG quality (0.0-1.0)
@property (nonatomic, assign) NSInteger maxImageWidth; // Max image width in pixels

// Blink validation configuration
@property (nonatomic, assign) NSInteger minBlinkDurationMs;  // Min blink duration (default 50ms)
@property (nonatomic, assign) NSInteger maxBlinkDurationMs;  // Max blink duration (default 800ms)
@property (nonatomic, assign) NSInteger blinkCooldownMs;     // Cooldown between blinks (default 300ms)

// Adaptive thresholding
@property (nonatomic, assign) BOOL adaptiveThreshold;         // Enable adaptive threshold
@property (nonatomic, assign) NSInteger calibrationDurationMs; // Calibration duration (default 3000ms)

- (instancetype)initWithEventEmitter:(RCTEventEmitter *)eventEmitter;
- (void)reset;
- (void)startCalibrationIfNeeded;

@end

