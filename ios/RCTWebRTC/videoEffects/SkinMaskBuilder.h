#import <Foundation/Foundation.h>
#import "FaceResultCache.h"

NS_ASSUME_NONNULL_BEGIN

/**
 * Builds a single-channel 8-bit skin mask for use by ImageAdjustmentProcessor.
 *
 * Mask values: 0 = keep source, 255 = fully smoothed, intermediate = blended.
 * The builder only touches pixels inside `bbox` expanded by `featherPx`; all
 * other pixels must already be zero (caller's responsibility to pre-zero).
 */
@interface SkinMaskBuilder : NSObject

/**
 * Writes 0..255 mask values clamped to (bbox + featherPx) for efficiency.
 * Assumes `dst` is already zero-initialised; does not pre-zero it.
 *
 * @param dst           Mask buffer, width*height bytes, row-major, width stride.
 * @param width         Frame width in pixels.
 * @param height        Frame height in pixels.
 * @param face          FDCFaceResult in source-pixel coords. face.valid must be YES.
 * @param featherPx     Outer falloff distance in pixels.
 * @param eyeProtect    If YES, punch soft holes at leftEye/rightEye landmarks.
 * @param mouthProtect  If YES, punch a soft hole at the mouth center.
 */
+ (void)buildMask:(uint8_t *)dst
            width:(int)width
           height:(int)height
             face:(FDCFaceResult)face
        featherPx:(int)featherPx
       eyeProtect:(BOOL)eyeProtect
     mouthProtect:(BOOL)mouthProtect;

@end

NS_ASSUME_NONNULL_END
