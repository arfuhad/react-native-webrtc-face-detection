package com.oney.WebRTCModule.videoEffects;

import android.util.Log;

import org.webrtc.JavaI420Buffer;
import org.webrtc.SurfaceTextureHelper;
import org.webrtc.VideoFrame;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * Video frame processor that applies exposure, contrast, saturation,
 * and color temperature adjustments directly on I420 (YUV) buffers,
 * with an optional bilateral skin-smoothing pass on the Y plane
 * before tone-mapping.
 *
 * Uses pre-computed lookup tables (LUTs) for efficient per-pixel tone
 * processing. Bilateral smoothing runs on the GPU via {@link BilateralSmoother}.
 */
public class ImageAdjustmentProcessor implements VideoFrameProcessor {
    private static final String TAG = "ImageAdjustmentProcessor";

    // Tone config — volatile for cross-thread visibility
    private volatile float exposure         = 0.0f; // -1.0 to 1.0
    private volatile float contrast         = 1.0f; //  0.0 to 3.0
    private volatile float saturation       = 1.0f; //  0.0 to 3.0
    private volatile float colorTemperature = 0.0f; // -1.0 to 1.0

    // Smoothing config
    private volatile boolean smoothingEnabled              = false;
    private volatile float   smoothingDistanceNormalization = 3.0f;
    private volatile float   smoothingTexelSpacing          = 2.0f;
    private volatile int     smoothingIterations            = 4;
    private volatile float   smoothingMix                   = 0.0f;
    private volatile float   smoothingSkinBrightness        = 0.0f;
    private volatile boolean smoothingSmoothChroma          = true;

    // Skin mask config
    public volatile boolean skinMaskEnabled      = true;
    public volatile int     skinMaskFeatherPx    = 0;    // 0 = auto (bbox-height based)
    public volatile boolean skinMaskEyeProtect   = true;
    public volatile boolean skinMaskMouthProtect = true;

    // Max age for face cache data (500ms)
    private static final long FACE_CACHE_MAX_AGE_NANOS = 500_000_000L;

    private volatile boolean isEnabled      = false;
    private volatile boolean isBypassed     = false;
    private volatile boolean toneIsDefault  = true;

    // Reusable per-frame buffers. Reallocated only on resolution change.
    private ByteBuffer smoothedYBuffer;
    private byte[]     scratchMask;
    private int        scratchAllocWidth  = 0;
    private int        scratchAllocHeight = 0;

    // Log-once flags — guard against spamming logcat on every frame.
    private boolean loggedMissingFace    = false;
    private boolean loggedSmootherFailed = false;

    // Pre-computed LUTs
    private volatile byte[] yLUT = new byte[256];
    private volatile byte[] uLUT = new byte[256];
    private volatile byte[] vLUT = new byte[256];

    private final BilateralSmoother smoother = new BilateralSmoother();

    public ImageAdjustmentProcessor() {
        rebuildLUTs();
        syncSmootherConfig();
    }

    public void setEnabled(boolean enabled) {
        this.isEnabled = enabled;
    }

    public boolean getEnabled() {
        return this.isEnabled;
    }

    public void setBypassed(boolean bypassed) {
        this.isBypassed = bypassed;
    }

    public boolean getBypassed() {
        return this.isBypassed;
    }

    /**
     * Update tone adjustment parameters only. Smoothing state is left unchanged.
     * Use {@link #updateConfig(float, float, float, float, boolean, float, float)}
     * to update both.
     */
    public void updateConfig(float exposure, float contrast, float saturation, float colorTemperature) {
        this.exposure = exposure;
        this.contrast = contrast;
        this.saturation = saturation;
        this.colorTemperature = colorTemperature;
        rebuildLUTs();
    }

    /**
     * Update tone + smoothing parameters together. Preferred entry point from
     * the JS bridge.
     */
    public void updateConfig(float exposure, float contrast, float saturation, float colorTemperature,
                             boolean smoothingEnabled, float smoothingDistanceNormalization,
                             float smoothingTexelSpacing, int smoothingIterations, float smoothingMix,
                             float smoothingSkinBrightness, boolean smoothingSmoothChroma) {
        this.exposure = exposure;
        this.contrast = contrast;
        this.saturation = saturation;
        this.colorTemperature = colorTemperature;
        this.smoothingEnabled = smoothingEnabled;
        this.smoothingDistanceNormalization = smoothingDistanceNormalization;
        this.smoothingTexelSpacing = smoothingTexelSpacing;
        this.smoothingIterations = smoothingIterations;
        this.smoothingMix = smoothingMix;
        this.smoothingSkinBrightness = smoothingSkinBrightness;
        this.smoothingSmoothChroma = smoothingSmoothChroma;
        rebuildLUTs();
        syncSmootherConfig();
        // Reset log-once flags so users get fresh diagnostics after reconfig.
        loggedMissingFace = false;
        loggedSmootherFailed = false;
    }

    /**
     * Update skin-mask parameters independently of the tone/smoothing config.
     *
     * @param enabled       When true, the bilateral smoothing output is
     *                      restricted to a face-derived skin mask; when false,
     *                      the smoother output is applied whole-frame.
     * @param featherPx     Outer feather distance in pixels. Pass 0 for auto
     *                      (derived from face bbox height).
     * @param eyeProtect    When true, punch soft cutouts at eye landmarks.
     * @param mouthProtect  When true, punch a soft cutout at the mouth.
     */
    public void updateSkinMaskConfig(boolean enabled, int featherPx,
                                     boolean eyeProtect, boolean mouthProtect) {
        this.skinMaskEnabled = enabled;
        this.skinMaskFeatherPx = Math.max(0, featherPx);
        this.skinMaskEyeProtect = eyeProtect;
        this.skinMaskMouthProtect = mouthProtect;
        // Reset log-once so the user sees fresh diagnostics.
        loggedMissingFace = false;
    }

    public void reset() {
        this.exposure = 0.0f;
        this.contrast = 1.0f;
        this.saturation = 1.0f;
        this.colorTemperature = 0.0f;
        this.smoothingEnabled = false;
        this.smoothingDistanceNormalization = 3.0f;
        this.smoothingTexelSpacing = 2.0f;
        this.smoothingIterations = 3;
        this.smoothingMix = 0.0f;
        this.smoothingSkinBrightness = 0.0f;
        this.smoothingSmoothChroma = true;
        this.skinMaskEnabled = true;
        this.skinMaskFeatherPx = 0;
        this.skinMaskEyeProtect = true;
        this.skinMaskMouthProtect = true;
        this.toneIsDefault = true;
        this.loggedMissingFace = false;
        this.loggedSmootherFailed = false;
        rebuildLUTs();
        syncSmootherConfig();
    }

    private void syncSmootherConfig() {
        smoother.updateConfig(smoothingEnabled, smoothingDistanceNormalization,
                smoothingTexelSpacing, smoothingIterations, smoothingMix, smoothingSkinBrightness);
    }


    private void rebuildLUTs() {
        toneIsDefault = (exposure == 0.0f && contrast == 1.0f &&
                         saturation == 1.0f && colorTemperature == 0.0f);

        if (toneIsDefault) {
            return;
        }

        byte[] newYLUT = new byte[256];
        byte[] newULUT = new byte[256];
        byte[] newVLUT = new byte[256];

        float exposureOffset = exposure * 128.0f;
        float tempUShift = -colorTemperature * 30.0f;
        float tempVShift =  colorTemperature * 30.0f;

        for (int i = 0; i < 256; i++) {
            float yVal = (i - 128.0f) * contrast + 128.0f + exposureOffset;
            newYLUT[i] = (byte) Math.max(0, Math.min(255, Math.round(yVal)));

            float uVal = (i - 128.0f) * saturation + 128.0f + tempUShift;
            newULUT[i] = (byte) Math.max(0, Math.min(255, Math.round(uVal)));

            float vVal = (i - 128.0f) * saturation + 128.0f + tempVShift;
            newVLUT[i] = (byte) Math.max(0, Math.min(255, Math.round(vVal)));
        }

        this.yLUT = newYLUT;
        this.uLUT = newULUT;
        this.vLUT = newVLUT;
    }

    @Override
    public VideoFrame process(VideoFrame frame, SurfaceTextureHelper textureHelper) {
        if (!isEnabled || isBypassed) {
            return frame;
        }

        // Fast path: no tone adjustment AND no smoothing -> pass through.
        boolean smoothingActive = smoothingEnabled;
        boolean smoothChroma = smoothingSmoothChroma;
        float localSmoothingMix = smoothingMix;
        float localSmoothingSkinBrightness = smoothingSkinBrightness;
        if (toneIsDefault && !smoothingActive) {
            return frame;
        }

        byte[] localYLUT = this.yLUT;
        byte[] localULUT = this.uLUT;
        byte[] localVLUT = this.vLUT;

        VideoFrame.I420Buffer i420Buffer = null;
        boolean needsRelease = false;

        try {
            VideoFrame.Buffer buffer = frame.getBuffer();
            if (buffer instanceof VideoFrame.I420Buffer) {
                i420Buffer = (VideoFrame.I420Buffer) buffer;
            } else {
                i420Buffer = buffer.toI420();
                needsRelease = true;
            }

            int width  = i420Buffer.getWidth();
            int height = i420Buffer.getHeight();
            int chromaWidth  = (width  + 1) / 2;
            int chromaHeight = (height + 1) / 2;

            ByteBuffer srcY = i420Buffer.getDataY();
            ByteBuffer srcU = i420Buffer.getDataU();
            ByteBuffer srcV = i420Buffer.getDataV();
            int srcStrideY = i420Buffer.getStrideY();
            int srcStrideU = i420Buffer.getStrideU();
            int srcStrideV = i420Buffer.getStrideV();

            JavaI420Buffer dstBuffer = JavaI420Buffer.allocate(width, height);
            ByteBuffer dstY = dstBuffer.getDataY();
            ByteBuffer dstU = dstBuffer.getDataU();
            ByteBuffer dstV = dstBuffer.getDataV();
            int dstStrideY = dstBuffer.getStrideY();
            int dstStrideU = dstBuffer.getStrideU();
            int dstStrideV = dstBuffer.getStrideV();

            // --- Y plane ---
            // Stage 1: optional bilateral smoothing into a working buffer.
            //
            // Two blend modes:
            //   (a) skin-masked   — read latest face from FaceResultCache,
            //                       build mask, blend smoothed+src per-pixel
            //                       inside the bbox+feather rect, copy src
            //                       elsewhere.
            //   (b) whole-frame   — if skinMaskEnabled is false, blend nothing
            //                       and just pass smoothed through (legacy).
            //
            // If smoothingActive but there is no fresh face AND skinMask is
            // enabled, we skip smoothing entirely (no-op) and pass src Y to
            // the tone stage unchanged. This matches the spec "smoothing
            // enabled but no recent face — no-op".
            ByteBuffer yForLUT       = srcY;
            int        yForLUTStride = srcStrideY;
            ByteBuffer smoothedY     = null;
            boolean    smoothedAvail = false;

            // Work rect and mask for skin-masked blending.
            FaceResultCache.FaceResult face = null;
            boolean useSkinMask = false;
            int workX0 = 0, workY0 = 0, workX1 = width, workY1 = height;
            int featherPx = 0;

            if (smoothingActive) {
                ensureScratchBuffers(width, height);

                if (skinMaskEnabled) {
                    face = FaceResultCache.getInstance().getIfFresh(FACE_CACHE_MAX_AGE_NANOS);
                    if (face == null) {
                        // No recent face; skip the smoothing stage rather than
                        // smoothing the whole frame.
                        if (!loggedMissingFace) {
                            android.util.Log.w("ImageAdjustment",
                                    "smoothing enabled but no recent face — no-op");
                            loggedMissingFace = true;
                        }
                    } else {
                        loggedMissingFace = false;
                        useSkinMask = true;
                        featherPx = skinMaskFeatherPx > 0
                                ? skinMaskFeatherPx
                                : Math.max(6, Math.round(face.bboxH * 0.08f));
                        workX0 = Math.max(0, face.bboxX - featherPx);
                        workY0 = Math.max(0, face.bboxY - featherPx);
                        workX1 = Math.min(width,  face.bboxX + face.bboxW + featherPx);
                        workY1 = Math.min(height, face.bboxY + face.bboxH + featherPx);
                    }
                }

                boolean shouldRunSmoother = useSkinMask || !skinMaskEnabled;
                if (shouldRunSmoother) {
                    smoothedY = smoothedYBuffer;
                    smoothedY.position(0);
                    boolean ok = smoother.smoothYPlane(srcY, srcStrideY, smoothedY, width, height);
                    if (ok) {
                        smoothedY.position(0);
                        smoothedAvail = true;
                        loggedSmootherFailed = false;
                        if (!useSkinMask) {
                            // Legacy whole-frame smoothing path.
                            yForLUT = smoothedY;
                            yForLUTStride = width;
                        }
                    } else {
                        if (!loggedSmootherFailed) {
                            Log.w(TAG, "smoother.smoothYPlane returned false; "
                                    + "passing source Y through");
                            loggedSmootherFailed = true;
                        }
                        smoothedY = null;
                        useSkinMask = false;
                    }
                }
            }

            // Stage 1.5: build skin mask (outside the inner loop). Rest of
            // the frame stays zero in scratchMask.
            if (useSkinMask && smoothedAvail) {
                SkinMaskBuilder.buildMask(scratchMask, width, height, face,
                                          featherPx, skinMaskEyeProtect, skinMaskMouthProtect);
            }

            // Stage 2: write dst Y plane. Three sub-paths:
            //   - skin-masked smoothing + tone (blend in bbox, tone outside)
            //   - skin-masked smoothing only  (blend in bbox, copy outside)
            //   - whole-frame smoothing or src-only with optional tone (existing path)
            dstY.position(0);
            if (useSkinMask && smoothedAvail) {
                // Fill rows outside the work rect with source (optionally tone-mapped).
                writeYRowsPassThrough(srcY, srcStrideY, dstY, dstStrideY,
                                      width, 0, workY0,
                                      !toneIsDefault, localYLUT);
                writeYRowsPassThrough(srcY, srcStrideY, dstY, dstStrideY,
                                      width, workY1, height,
                                      !toneIsDefault, localYLUT);

                // Within work rows: copy src outside the work-x range, blend inside.
                for (int row = workY0; row < workY1; row++) {
                    int srcOffset = row * srcStrideY;
                    int dstOffset = row * dstStrideY;
                    int maskRow   = row * width;

                    // Left side outside work rect
                    for (int col = 0; col < workX0; col++) {
                        int srcVal = srcY.get(srcOffset + col) & 0xFF;
                        dstY.put(dstOffset + col,
                                 toneIsDefault ? (byte) srcVal : localYLUT[srcVal]);
                    }
                    // Blend zone
                    int mix8 = Math.round(localSmoothingMix * 255.0f);
                    int brightnessGain = Math.round(localSmoothingSkinBrightness * 40.0f);

                    for (int col = workX0; col < workX1; col++) {
                        int m = scratchMask[maskRow + col] & 0xFF;
                        int sVal = srcY.get(srcOffset + col) & 0xFF;
                        int result;
                        if (m == 0) {
                            result = sVal;
                        } else {
                            int dVal = smoothedY.get(maskRow + col) & 0xFF;

                            // Texture preservation (mix)
                            if (mix8 > 0) {
                                dVal = (mix8 * sVal + (255 - mix8) * dVal + 127) / 255;
                            }

                            // Skin brightening (targeted glow)
                            if (brightnessGain > 0) {
                                dVal = Math.max(0, Math.min(255, dVal + brightnessGain));
                            }

                            if (m == 255) {
                                result = dVal;
                            } else {
                                // (m * dVal + (255 - m) * sVal + 127) / 255
                                result = (m * dVal + (255 - m) * sVal + 127) / 255;
                            }
                        }
                        if (!toneIsDefault) {
                            result = localYLUT[result] & 0xFF;
                        }
                        dstY.put(dstOffset + col, (byte) result);
                    }
                    // Right side outside work rect
                    for (int col = workX1; col < width; col++) {
                        int srcVal = srcY.get(srcOffset + col) & 0xFF;
                        dstY.put(dstOffset + col,
                                 toneIsDefault ? (byte) srcVal : localYLUT[srcVal]);
                    }
                }
            } else if (!toneIsDefault) {
                for (int row = 0; row < height; row++) {
                    int srcOffset = row * yForLUTStride;
                    int dstOffset = row * dstStrideY;
                    for (int col = 0; col < width; col++) {
                        int srcVal = yForLUT.get(srcOffset + col) & 0xFF;
                        dstY.put(dstOffset + col, localYLUT[srcVal]);
                    }
                }
            } else {
                for (int row = 0; row < height; row++) {
                    int srcOffset = row * yForLUTStride;
                    int dstOffset = row * dstStrideY;
                    for (int col = 0; col < width; col++) {
                        dstY.put(dstOffset + col, yForLUT.get(srcOffset + col));
                    }
                }
            }

            // --- U plane ---
            // Chroma smoothing: separable 3x3 box blur to reduce skin discoloration.
            dstU.position(0);
            if (smoothingActive && smoothChroma && smoothedAvail) {
                byte[] scratchChroma = new byte[chromaWidth * chromaHeight];
                // Horizontal pass: srcU -> scratchChroma
                for (int row = 0; row < chromaHeight; row++) {
                    int srcOffset = row * srcStrideU;
                    int dstOffset = row * chromaWidth;
                    for (int col = 0; col < chromaWidth; col++) {
                        int sum = 0;
                        int count = 0;
                        for (int k = -1; k <= 1; k++) {
                            int c = col + k;
                            if (c >= 0 && c < chromaWidth) {
                                sum += srcU.get(srcOffset + c) & 0xFF;
                                count++;
                            }
                        }
                        scratchChroma[dstOffset + col] = (byte) ((sum + count / 2) / count);
                    }
                }
                // Vertical pass: scratchChroma -> dstU (with optional LUT)
                for (int row = 0; row < chromaHeight; row++) {
                    int dstOffset = row * dstStrideU;
                    for (int col = 0; col < chromaWidth; col++) {
                        int sum = 0;
                        int count = 0;
                        for (int k = -1; k <= 1; k++) {
                            int r = row + k;
                            if (r >= 0 && r < chromaHeight) {
                                sum += scratchChroma[r * chromaWidth + col] & 0xFF;
                                count++;
                            }
                        }
                        int blurred = (sum + count / 2) / count;
                        dstU.put(dstOffset + col, toneIsDefault ? (byte) blurred : localULUT[blurred]);
                    }
                }
            } else if (!toneIsDefault) {
                for (int row = 0; row < chromaHeight; row++) {
                    int srcOffset = row * srcStrideU;
                    int dstOffset = row * dstStrideU;
                    for (int col = 0; col < chromaWidth; col++) {
                        int srcVal = srcU.get(srcOffset + col) & 0xFF;
                        dstU.put(dstOffset + col, localULUT[srcVal]);
                    }
                }
            } else {
                for (int row = 0; row < chromaHeight; row++) {
                    int srcOffset = row * srcStrideU;
                    int dstOffset = row * dstStrideU;
                    for (int col = 0; col < chromaWidth; col++) {
                        dstU.put(dstOffset + col, srcU.get(srcOffset + col));
                    }
                }
            }

            // --- V plane ---
            dstV.position(0);
            if (smoothingActive && smoothChroma && smoothedAvail) {
                byte[] scratchChroma = new byte[chromaWidth * chromaHeight];
                // Horizontal pass: srcV -> scratchChroma
                for (int row = 0; row < chromaHeight; row++) {
                    int srcOffset = row * srcStrideV;
                    int dstOffset = row * chromaWidth;
                    for (int col = 0; col < chromaWidth; col++) {
                        int sum = 0;
                        int count = 0;
                        for (int k = -1; k <= 1; k++) {
                            int c = col + k;
                            if (c >= 0 && c < chromaWidth) {
                                sum += srcV.get(srcOffset + c) & 0xFF;
                                count++;
                            }
                        }
                        scratchChroma[dstOffset + col] = (byte) ((sum + count / 2) / count);
                    }
                }
                // Vertical pass: scratchChroma -> dstV (with optional LUT)
                for (int row = 0; row < chromaHeight; row++) {
                    int dstOffset = row * dstStrideV;
                    for (int col = 0; col < chromaWidth; col++) {
                        int sum = 0;
                        int count = 0;
                        for (int k = -1; k <= 1; k++) {
                            int r = row + k;
                            if (r >= 0 && r < chromaHeight) {
                                sum += scratchChroma[r * chromaWidth + col] & 0xFF;
                                count++;
                            }
                        }
                        int blurred = (sum + count / 2) / count;
                        dstV.put(dstOffset + col, toneIsDefault ? (byte) blurred : localVLUT[blurred]);
                    }
                }
            } else if (!toneIsDefault) {
                for (int row = 0; row < chromaHeight; row++) {
                    int srcOffset = row * srcStrideV;
                    int dstOffset = row * dstStrideV;
                    for (int col = 0; col < chromaWidth; col++) {
                        int srcVal = srcV.get(srcOffset + col) & 0xFF;
                        dstV.put(dstOffset + col, localVLUT[srcVal]);
                    }
                }
            } else {
                for (int row = 0; row < chromaHeight; row++) {
                    int srcOffset = row * srcStrideV;
                    int dstOffset = row * dstStrideV;
                    for (int col = 0; col < chromaWidth; col++) {
                        dstV.put(dstOffset + col, srcV.get(srcOffset + col));
                    }
                }
            }

            dstY.rewind();
            dstU.rewind();
            dstV.rewind();

            VideoFrame newFrame = new VideoFrame(dstBuffer, frame.getRotation(), frame.getTimestampNs());

            if (needsRelease) {
                i420Buffer.release();
            }

            return newFrame;
        } catch (Exception e) {
            Log.e(TAG, "Error processing frame: " + e.getMessage(), e);
            if (needsRelease && i420Buffer != null) {
                i420Buffer.release();
            }
            return frame;
        }
    }

    /**
     * Ensure the direct smoothing buffer and mask scratch byte[] are sized
     * for the current frame dimensions. Reallocated only on resolution change.
     */
    private void ensureScratchBuffers(int width, int height) {
        int pixels = width * height;
        if (smoothedYBuffer == null || smoothedYBuffer.capacity() < pixels) {
            smoothedYBuffer = ByteBuffer.allocateDirect(pixels).order(ByteOrder.nativeOrder());
        }
        if (scratchMask == null || scratchMask.length < pixels
                || scratchAllocWidth != width || scratchAllocHeight != height) {
            scratchMask = new byte[pixels];
            scratchAllocWidth = width;
            scratchAllocHeight = height;
        }
        // We do NOT pre-zero the whole scratchMask on every frame — the
        // builder pre-zeros its own work rect, and anything outside the work
        // rect is never read (the blend code only touches pixels inside the
        // work rect). Leftover non-zero mask values outside the work rect
        // are therefore safe.
    }

    /**
     * Copy a contiguous row range from src to dst, optionally applying the
     * Y LUT. Used for the strips above/below the skin-mask work rect.
     */
    private static void writeYRowsPassThrough(ByteBuffer src, int srcStride,
                                              ByteBuffer dst, int dstStride,
                                              int width, int rowStart, int rowEnd,
                                              boolean applyLUT, byte[] yLUT) {
        if (rowStart >= rowEnd) {
            return;
        }
        if (applyLUT) {
            for (int row = rowStart; row < rowEnd; row++) {
                int srcOffset = row * srcStride;
                int dstOffset = row * dstStride;
                for (int col = 0; col < width; col++) {
                    int srcVal = src.get(srcOffset + col) & 0xFF;
                    dst.put(dstOffset + col, yLUT[srcVal]);
                }
            }
        } else {
            for (int row = rowStart; row < rowEnd; row++) {
                int srcOffset = row * srcStride;
                int dstOffset = row * dstStride;
                for (int col = 0; col < width; col++) {
                    dst.put(dstOffset + col, src.get(srcOffset + col));
                }
            }
        }
    }

    public void cleanup() {
        isEnabled = false;
        reset();
        smoother.release();
        Log.d(TAG, "Image adjustment processor cleaned up");
    }
}
