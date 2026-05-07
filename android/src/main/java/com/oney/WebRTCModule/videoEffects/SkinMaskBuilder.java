package com.oney.WebRTCModule.videoEffects;

/**
 * Builds a single-channel 8-bit skin mask for use by {@link ImageAdjustmentProcessor}.
 *
 * Mask values: 0 = keep source, 255 = fully smoothed, intermediate = blended.
 * The builder only touches pixels inside {@code bbox} expanded by {@code featherPx};
 * callers are responsible for pre-zeroing the rest of the buffer.
 *
 * Mirrors the iOS implementation ({@code SkinMaskBuilder.m}): inset bbox by
 * ~10%, draw feathered ellipse, punch soft holes around eyes and mouth.
 */
public final class SkinMaskBuilder {

    private SkinMaskBuilder() {
    }

    /**
     * Writes 0..255 mask values clamped to (bbox + featherPx). Pre-zeros
     * the bbox+feather rect before writing — callers do not need to pre-zero
     * the whole buffer, only the regions outside this rect.
     *
     * @param dst          Mask buffer, length >= width*height bytes, row-major.
     * @param width        Frame width in pixels.
     * @param height       Frame height in pixels.
     * @param face         Face result in source-pixel coords. Must be valid.
     * @param featherPx    Outer falloff distance in pixels.
     * @param eyeProtect   If true, punch soft holes at left/right eye landmarks.
     * @param mouthProtect If true, punch a soft hole at the mouth center.
     */
    public static void buildMask(byte[] dst, int width, int height,
                                 FaceResultCache.FaceResult face,
                                 int featherPx, boolean eyeProtect, boolean mouthProtect) {
        if (dst == null || width <= 0 || height <= 0 || face == null || !face.valid) {
            return;
        }

        // Inset bbox by ~10% on each side — avoids hair at the top and jawline
        // at the bottom while still covering the majority of skin.
        float insetX = face.bboxW * 0.10f;
        float insetY = face.bboxH * 0.10f;

        float ellipseCx = face.bboxX + face.bboxW * 0.5f;
        float ellipseCy = face.bboxY + face.bboxH * 0.5f;
        float ellipseRx = face.bboxW * 0.5f - insetX;
        float ellipseRy = face.bboxH * 0.5f - insetY;

        if (ellipseRx <= 1.0f || ellipseRy <= 1.0f) {
            return;
        }

        if (featherPx < 0) {
            featherPx = 0;
        }

        // Work rect: bbox expanded by featherPx, clipped to frame.
        int x0 = clampi((int) Math.floor(face.bboxX - featherPx), 0, width);
        int y0 = clampi((int) Math.floor(face.bboxY - featherPx), 0, height);
        int x1 = clampi((int) Math.ceil(face.bboxX + face.bboxW + featherPx), 0, width);
        int y1 = clampi((int) Math.ceil(face.bboxY + face.bboxH + featherPx), 0, height);

        if (x1 <= x0 || y1 <= y0) {
            return;
        }

        // Pre-zero the work rect (callers may have leftover mask data from
        // previous frames in this region). Rows outside the rect are assumed
        // already zero.
        for (int y = y0; y < y1; y++) {
            int rowOffset = y * width;
            for (int x = x0; x < x1; x++) {
                dst[rowOffset + x] = 0;
            }
        }

        // Feather band expressed in normalized-distance units. Using the larger
        // of the two radii keeps the band roughly `featherPx` pixels wide.
        float refR = Math.max(ellipseRx, ellipseRy);
        float featherNorm = (featherPx > 0 && refR > 0.0f) ? ((float) featherPx / refR) : 0.0f;
        float innerEdge = 1.0f;
        float outerEdge = 1.0f + featherNorm;

        // Eye/mouth protection radii, scaled off the face width.
        float eyeR = eyeProtect ? (face.faceWidth * 0.12f) : 0.0f;
        float mouthR = mouthProtect ? (face.faceWidth * 0.14f) : 0.0f;
        // Inner core radius that is fully protected.
        float eyeRInner = eyeR * 0.60f;
        float mouthRInner = mouthR * 0.60f;
        float eyeRSq = eyeR * eyeR;
        float mouthRSq = mouthR * mouthR;

        boolean haveLeftEye = eyeProtect
                && !Float.isNaN(face.leftEyeX) && !Float.isNaN(face.leftEyeY);
        boolean haveRightEye = eyeProtect
                && !Float.isNaN(face.rightEyeX) && !Float.isNaN(face.rightEyeY);
        boolean haveMouth = mouthProtect
                && !Float.isNaN(face.mouthX) && !Float.isNaN(face.mouthY);

        float invRx = 1.0f / ellipseRx;
        float invRy = 1.0f / ellipseRy;

        for (int y = y0; y < y1; y++) {
            int rowOffset = y * width;
            float dy = ((float) y + 0.5f - ellipseCy) * invRy;
            float dySq = dy * dy;

            for (int x = x0; x < x1; x++) {
                float dx = ((float) x + 0.5f - ellipseCx) * invRx;
                float d = (float) Math.sqrt(dx * dx + dySq);

                // Outer falloff: 1.0 inside the ellipse, fading to 0 beyond.
                float coverage;
                if (d <= innerEdge) {
                    coverage = 1.0f;
                } else if (d >= outerEdge) {
                    coverage = 0.0f;
                } else {
                    coverage = 1.0f - smoothstep(innerEdge, outerEdge, d);
                }

                if (coverage <= 0.0f) {
                    continue; // buffer already zero here
                }

                // Eye holes
                if (haveLeftEye && eyeR > 0.5f) {
                    float ex = (float) x + 0.5f - face.leftEyeX;
                    float ey = (float) y + 0.5f - face.leftEyeY;
                    float dSq = ex * ex + ey * ey;
                    if (dSq < eyeRSq) {
                        float dd = (float) Math.sqrt(dSq);
                        float passthrough = smoothstep(eyeRInner, eyeR, dd);
                        coverage *= passthrough;
                    }
                }
                if (haveRightEye && eyeR > 0.5f) {
                    float ex = (float) x + 0.5f - face.rightEyeX;
                    float ey = (float) y + 0.5f - face.rightEyeY;
                    float dSq = ex * ex + ey * ey;
                    if (dSq < eyeRSq) {
                        float dd = (float) Math.sqrt(dSq);
                        float passthrough = smoothstep(eyeRInner, eyeR, dd);
                        coverage *= passthrough;
                    }
                }
                if (haveMouth && mouthR > 0.5f) {
                    float mx = (float) x + 0.5f - face.mouthX;
                    float my = (float) y + 0.5f - face.mouthY;
                    float dSq = mx * mx + my * my;
                    if (dSq < mouthRSq) {
                        float dd = (float) Math.sqrt(dSq);
                        float passthrough = smoothstep(mouthRInner, mouthR, dd);
                        coverage *= passthrough;
                    }
                }

                int m = Math.round(coverage * 255.0f);
                if (m < 0) m = 0;
                if (m > 255) m = 255;
                dst[rowOffset + x] = (byte) m;
            }
        }
    }

    /** Cubic Hermite falloff, returns 0..1. */
    private static float smoothstep(float edge0, float edge1, float x) {
        if (edge1 <= edge0) {
            return x < edge0 ? 0.0f : 1.0f;
        }
        float t = (x - edge0) / (edge1 - edge0);
        if (t < 0.0f) t = 0.0f;
        if (t > 1.0f) t = 1.0f;
        return t * t * (3.0f - 2.0f * t);
    }

    private static int clampi(int v, int lo, int hi) {
        if (v < lo) return lo;
        if (v > hi) return hi;
        return v;
    }
}
