#import <Foundation/Foundation.h>
#import <WebRTC/RTCVideoCapturer.h>
#import "VideoFrameProcessor.h"

@interface ImageAdjustmentProcessor : NSObject<VideoFrameProcessorDelegate>

@property (nonatomic, assign) BOOL isEnabled;
@property (nonatomic, assign) BOOL isBypassed;
@property (nonatomic, assign) CGFloat exposure;         // -1.0 to 1.0, default 0.0
@property (nonatomic, assign) CGFloat contrast;         //  0.0 to 3.0, default 1.0
@property (nonatomic, assign) CGFloat saturation;       //  0.0 to 3.0, default 1.0
@property (nonatomic, assign) CGFloat colorTemperature; // -1.0 to 1.0, default 0.0

// Bilateral skin smoothing on the Y plane (pre-LUT stage).
@property (nonatomic, assign) BOOL    smoothingEnabled;
@property (nonatomic, assign) CGFloat smoothingDistanceNormalization; // 1.0 to 8.0
@property (nonatomic, assign) CGFloat smoothingTexelSpacing;          // 1.0 to 4.0
@property (nonatomic, assign) int     smoothingIterations;             // 1 to 8, default 4
@property (nonatomic, assign) CGFloat smoothingMix;                    // 0.0 to 1.0, default 0.0
@property (nonatomic, assign) CGFloat smoothingSkinBrightness;         // 0.0 to 1.0, default 0.0
@property (nonatomic, assign) BOOL    smoothingSmoothChroma;           // default YES

// Skin-mask gating for bilateral smoothing. When skinMaskEnabled is YES the
// smoother only runs inside the face bounding box; outside pixels are left
// untouched. Feather/eye/mouth toggles control mask edge softness and cut-outs.
@property (nonatomic, assign) BOOL skinMaskEnabled;       // default YES
@property (nonatomic, assign) int  skinMaskFeatherPx;     // 0 = auto (face-height based)
@property (nonatomic, assign) BOOL skinMaskEyeProtect;    // default YES
@property (nonatomic, assign) BOOL skinMaskMouthProtect;  // default YES

- (void)updateConfig:(NSDictionary *)config;
- (void)reset;

@end
