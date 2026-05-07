#import "SkinMaskBuilder.h"

#import <math.h>
#import <stdlib.h>
#import <string.h>

// smoothstep(edge0, edge1, x) — cubic Hermite falloff, returns 0..1.
static inline float sm_smoothstep(float edge0, float edge1, float x) {
    if (edge1 <= edge0) {
        return x < edge0 ? 0.0f : 1.0f;
    }
    float t = (x - edge0) / (edge1 - edge0);
    if (t < 0.0f) t = 0.0f;
    if (t > 1.0f) t = 1.0f;
    return t * t * (3.0f - 2.0f * t);
}

static inline int sm_clampi(int v, int lo, int hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
}

@implementation SkinMaskBuilder

+ (void)buildMask:(uint8_t *)dst
            width:(int)width
           height:(int)height
             face:(FDCFaceResult)face
        featherPx:(int)featherPx
       eyeProtect:(BOOL)eyeProtect
     mouthProtect:(BOOL)mouthProtect {

    if (!dst || width <= 0 || height <= 0 || !face.valid) {
        return;
    }

    // Inset bbox by ~10% on each side — avoids hair at the top and jawline
    // at the bottom while still covering the majority of skin.
    CGFloat insetX = face.bbox.size.width  * 0.10;
    CGFloat insetY = face.bbox.size.height * 0.10;

    CGFloat ellipseCx = CGRectGetMidX(face.bbox);
    CGFloat ellipseCy = CGRectGetMidY(face.bbox);
    CGFloat ellipseRx = (CGFloat)(face.bbox.size.width  * 0.5) - insetX;
    CGFloat ellipseRy = (CGFloat)(face.bbox.size.height * 0.5) - insetY;

    if (ellipseRx <= 1.0 || ellipseRy <= 1.0) {
        return;
    }

    if (featherPx < 0) featherPx = 0;

    // Work rect: bbox expanded by featherPx in every direction, clipped to
    // the frame. We deliberately iterate only this slab — callers pre-zero
    // the buffer so everything outside is already 0.
    int x0 = sm_clampi((int)floor(face.bbox.origin.x - featherPx),                           0, width);
    int y0 = sm_clampi((int)floor(face.bbox.origin.y - featherPx),                           0, height);
    int x1 = sm_clampi((int)ceil(face.bbox.origin.x + face.bbox.size.width  + featherPx),    0, width);
    int y1 = sm_clampi((int)ceil(face.bbox.origin.y + face.bbox.size.height + featherPx),    0, height);

    if (x1 <= x0 || y1 <= y0) {
        return;
    }

    // Feather band expressed in normalized-distance units. Using the larger
    // of the two radii keeps the band roughly `featherPx` pixels wide.
    float refR  = (float)MAX(ellipseRx, ellipseRy);
    float featherNorm = (featherPx > 0 && refR > 0.0f) ? ((float)featherPx / refR) : 0.0f;
    float innerEdge = 1.0f;
    float outerEdge = 1.0f + featherNorm;
    // Coverage is 1.0 inside the ellipse and smoothly fades to 0 at outerEdge.
    // We pass (outerEdge - d) through smoothstep so that d == 1 gives full
    // coverage and d == outerEdge gives zero.

    // Eye/mouth protection radii, scaled off the face width.
    float eyeR   = eyeProtect   ? (float)(face.faceWidth * 0.12) : 0.0f;
    float mouthR = mouthProtect ? (float)(face.faceWidth * 0.14) : 0.0f;
    // Inner core radius that is fully protected (1.0 - fade). The soft edge
    // extends from eyeR*0.6 to eyeR for eyes, and similarly for mouth.
    float eyeRInner   = eyeR   * 0.60f;
    float mouthRInner = mouthR * 0.60f;
    float eyeRSq    = eyeR   * eyeR;
    float mouthRSq  = mouthR * mouthR;

    BOOL haveLeftEye  = eyeProtect   && (face.leftEye.x  >= 0 && face.leftEye.y  >= 0);
    BOOL haveRightEye = eyeProtect   && (face.rightEye.x >= 0 && face.rightEye.y >= 0);
    BOOL haveMouth    = mouthProtect && (face.mouthCenter.x >= 0 && face.mouthCenter.y >= 0);

    float invRx = 1.0f / (float)ellipseRx;
    float invRy = 1.0f / (float)ellipseRy;

    for (int y = y0; y < y1; y++) {
        uint8_t *row = dst + (size_t)y * (size_t)width;
        float dy = ((float)y + 0.5f - (float)ellipseCy) * invRy;
        float dySq = dy * dy;

        for (int x = x0; x < x1; x++) {
            float dx = ((float)x + 0.5f - (float)ellipseCx) * invRx;
            float d  = sqrtf(dx * dx + dySq);

            // Outer falloff: 1.0 inside the ellipse, fading to 0 beyond.
            float coverage;
            if (d <= innerEdge) {
                coverage = 1.0f;
            } else if (d >= outerEdge) {
                coverage = 0.0f;
            } else {
                // Map d from [innerEdge, outerEdge] -> [0,1], then smoothstep-invert.
                coverage = 1.0f - sm_smoothstep(innerEdge, outerEdge, d);
            }

            if (coverage <= 0.0f) {
                continue;  // buffer already zero here
            }

            // Eye holes
            if (haveLeftEye && eyeR > 0.5f) {
                float ex = (float)x + 0.5f - (float)face.leftEye.x;
                float ey = (float)y + 0.5f - (float)face.leftEye.y;
                float dSq = ex * ex + ey * ey;
                if (dSq < eyeRSq) {
                    float dd = sqrtf(dSq);
                    // 0 inside eyeRInner, 1 outside eyeR.
                    float passthrough = sm_smoothstep(eyeRInner, eyeR, dd);
                    coverage *= passthrough;
                }
            }
            if (haveRightEye && eyeR > 0.5f) {
                float ex = (float)x + 0.5f - (float)face.rightEye.x;
                float ey = (float)y + 0.5f - (float)face.rightEye.y;
                float dSq = ex * ex + ey * ey;
                if (dSq < eyeRSq) {
                    float dd = sqrtf(dSq);
                    float passthrough = sm_smoothstep(eyeRInner, eyeR, dd);
                    coverage *= passthrough;
                }
            }
            if (haveMouth && mouthR > 0.5f) {
                float mx = (float)x + 0.5f - (float)face.mouthCenter.x;
                float my = (float)y + 0.5f - (float)face.mouthCenter.y;
                float dSq = mx * mx + my * my;
                if (dSq < mouthRSq) {
                    float dd = sqrtf(dSq);
                    float passthrough = sm_smoothstep(mouthRInner, mouthR, dd);
                    coverage *= passthrough;
                }
            }

            int m = (int)(coverage * 255.0f + 0.5f);
            if (m < 0)   m = 0;
            if (m > 255) m = 255;
            row[x] = (uint8_t)m;
        }
    }
}

@end
