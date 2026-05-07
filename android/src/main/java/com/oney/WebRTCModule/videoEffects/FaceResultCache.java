package com.oney.WebRTCModule.videoEffects;

/**
 * Lightweight single-slot cache that {@link FaceDetectionProcessor} publishes into
 * and {@link ImageAdjustmentProcessor} reads from. No trackId keying — if multiple
 * tracks are running simultaneously, last writer wins (best-effort).
 *
 * Thread-safe. Intended to be called from the capture callback thread and
 * the ML Kit processing thread concurrently.
 */
public final class FaceResultCache {

    /**
     * Snapshot of the latest face detection. Coordinates are in source-pixel
     * space (pre-rotation, i.e. matching the I420 buffer the smoother sees).
     */
    public static final class FaceResult {
        public boolean valid;
        public int bboxX, bboxY, bboxW, bboxH;
        /** Float.NaN if landmark was missing. */
        public float leftEyeX, leftEyeY;
        public float rightEyeX, rightEyeY;
        public float mouthX, mouthY;
        /** For scaling eye/mouth protection radii. */
        public float faceWidth;
        public long timestampNanos;

        public FaceResult() {
            this.valid = false;
            this.leftEyeX = Float.NaN;
            this.leftEyeY = Float.NaN;
            this.rightEyeX = Float.NaN;
            this.rightEyeY = Float.NaN;
            this.mouthX = Float.NaN;
            this.mouthY = Float.NaN;
        }

        public FaceResult copy() {
            FaceResult r = new FaceResult();
            r.valid = this.valid;
            r.bboxX = this.bboxX;
            r.bboxY = this.bboxY;
            r.bboxW = this.bboxW;
            r.bboxH = this.bboxH;
            r.leftEyeX = this.leftEyeX;
            r.leftEyeY = this.leftEyeY;
            r.rightEyeX = this.rightEyeX;
            r.rightEyeY = this.rightEyeY;
            r.mouthX = this.mouthX;
            r.mouthY = this.mouthY;
            r.faceWidth = this.faceWidth;
            r.timestampNanos = this.timestampNanos;
            return r;
        }
    }

    private static final FaceResultCache INSTANCE = new FaceResultCache();

    public static FaceResultCache getInstance() {
        return INSTANCE;
    }

    private final FaceResult slot = new FaceResult();

    private FaceResultCache() {
    }

    /**
     * Publish the latest face result. Pass a result with {@code valid = false}
     * to mark the cache empty (e.g. a frame with no face detections).
     */
    public synchronized void publish(FaceResult r) {
        if (r == null) {
            slot.valid = false;
            return;
        }
        slot.valid = r.valid;
        slot.bboxX = r.bboxX;
        slot.bboxY = r.bboxY;
        slot.bboxW = r.bboxW;
        slot.bboxH = r.bboxH;
        slot.leftEyeX = r.leftEyeX;
        slot.leftEyeY = r.leftEyeY;
        slot.rightEyeX = r.rightEyeX;
        slot.rightEyeY = r.rightEyeY;
        slot.mouthX = r.mouthX;
        slot.mouthY = r.mouthY;
        slot.faceWidth = r.faceWidth;
        slot.timestampNanos = r.timestampNanos;
    }

    /**
     * Returns the most recent published result if its timestamp is within
     * {@code maxAgeNanos} of now. Returns {@code null} if stale or empty.
     */
    public synchronized FaceResult getIfFresh(long maxAgeNanos) {
        if (!slot.valid) {
            return null;
        }
        long now = System.nanoTime();
        if (now - slot.timestampNanos > maxAgeNanos) {
            return null;
        }
        return slot.copy();
    }
}
