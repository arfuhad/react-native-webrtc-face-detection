#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Lightweight single-slot cache that FaceDetectionProcessor publishes into
 * and ImageAdjustmentProcessor reads from. No trackId keying — if multiple
 * tracks are running simultaneously, last writer wins (best-effort).
 *
 * Thread-safe. Intended to be called from the capture callback thread and
 * the ML-Kit processing queue concurrently.
 */
typedef struct {
    BOOL    valid;
    CGRect  bbox;          // source-pixel coords
    CGPoint leftEye;       // {-1, -1} if missing
    CGPoint rightEye;      // {-1, -1} if missing
    CGPoint mouthCenter;   // {-1, -1} if missing
    CGFloat faceWidth;     // for eye/mouth radii scaling
    int64_t timestampNanos;
} FDCFaceResult;

@interface FaceResultCache : NSObject

+ (instancetype)sharedInstance;

/**
 * Publish the latest face result. Pass {.valid = NO} to mark the cache as
 * empty (e.g. a frame with no face detections).
 */
- (void)publish:(FDCFaceResult)result;

/**
 * Returns the most recent published result if its timestamp is within
 * `maxAgeNanos` of now. Returns {.valid = NO} if stale or never populated.
 */
- (FDCFaceResult)getIfFresh:(int64_t)maxAgeNanos;

@end

NS_ASSUME_NONNULL_END
