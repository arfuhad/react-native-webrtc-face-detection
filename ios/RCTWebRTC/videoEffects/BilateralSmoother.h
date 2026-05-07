#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Metal-backed bilateral smoother for a single-channel luminance plane.
 *
 * Thread-affine: all calls must happen on the same thread as the capturer
 * frame callback. Textures are lazily allocated on first use and reallocated
 * only when the frame resolution changes.
 */
@interface BilateralSmoother : NSObject

/**
 * Whether the smoother is ready to run (Metal device available and pipeline
 * compiled). If NO, callers should skip smoothing and pass the Y plane through.
 */
@property (nonatomic, readonly) BOOL isAvailable;

- (void)updateConfig:(BOOL)enabled
        distanceNorm:(float)distanceNorm
        texelSpacing:(float)texelSpacing;

/**
 * Smooth a Y plane in place. `srcPlane` and `dstPlane` may alias or be
 * distinct; `dstPlane` must have `width` bytes per row. No-op if smoothing
 * is disabled or the smoother failed to initialize.
 *
 * @param srcPlane    Pointer to source Y data. Must be readable, width*height bytes.
 * @param srcStride   Row stride of source data.
 * @param dstPlane    Pointer to destination Y data. Must be writable, width*height bytes.
 * @param width       Frame width in pixels.
 * @param height      Frame height in pixels.
 *
 * @return YES if smoothing ran and dstPlane was populated, NO if skipped
 *         (caller must populate dstPlane via copy or LUT pass).
 */
- (BOOL)smoothYPlane:(const uint8_t *)srcPlane
           srcStride:(int)srcStride
            dstPlane:(uint8_t *)dstPlane
               width:(int)width
              height:(int)height;

/**
 * Returns YES if smoothing is currently enabled (gated by updateConfig).
 * Useful for callers that want to decide whether to allocate a working
 * buffer before calling into smoothYPlane.
 */
@property (nonatomic, readonly) BOOL isEnabled;

@end

NS_ASSUME_NONNULL_END
