package com.oney.WebRTCModule.videoEffects;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageFormat;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.graphics.YuvImage;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Base64;
import android.util.Log;

import java.io.ByteArrayOutputStream;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import com.google.android.gms.tasks.OnFailureListener;
import com.google.android.gms.tasks.OnSuccessListener;
import com.google.android.gms.tasks.Task;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.face.Face;
import com.google.mlkit.vision.face.FaceDetection;
import com.google.mlkit.vision.face.FaceDetector;
import com.google.mlkit.vision.face.FaceDetectorOptions;
import com.google.mlkit.vision.face.FaceLandmark;

import org.webrtc.EglBase;
import org.webrtc.SurfaceTextureHelper;
import org.webrtc.VideoFrame;
import org.webrtc.YuvConverter;

import java.nio.ByteBuffer;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Face detection processor that processes video frames for face detection.
 * Uses a dedicated capture pipeline to safely convert TextureBuffers to I420
 * without interfering with the main video rendering pipeline.
 */
public class FaceDetectionProcessor implements VideoFrameProcessor {
    private static final String TAG = "FaceDetectionProcessor";
    private static final String EVENT_FACE_DETECTED = "faceDetected";
    private static final String EVENT_BLINK_DETECTED = "blinkDetected";

    private final ReactApplicationContext reactContext;
    private FaceDetector detector;
    private boolean isEnabled = false;
    private int frameSkipCount = 3; // Process every 3rd frame (matches iOS and docs)
    private int frameCounter = 0;
    private float blinkThreshold = 0.3f;

    // Frame capture configuration
    private boolean captureOnBlink = false;
    private boolean cropToFace = true;
    private float imageQuality = 0.7f;
    private int maxImageWidth = 480;
    private byte[] lastNv21Data = null;
    private int lastFrameWidth = 0;
    private int lastFrameHeight = 0;
    private int lastFrameRotation = 0;

    // Closed-eye frame storage (for capturing at correct moment)
    private byte[] closedEyeNv21Data = null;
    private int closedEyeFrameWidth = 0;
    private int closedEyeFrameHeight = 0;
    private Rect closedEyeFaceBounds = null;
    private int closedEyeFrameRotation = 0;

    // Blink validation configuration
    private long minBlinkDurationMs = 50;
    private long maxBlinkDurationMs = 800;
    private long blinkCooldownMs = 300;

    // Adaptive thresholding
    private boolean adaptiveThresholdEnabled = false;
    private long calibrationDurationMs = 3000;
    private boolean isCalibrating = false;
    private long calibrationStartTime = 0;
    private final java.util.ArrayList<Float> calibrationSamples = new java.util.ArrayList<>();

    // Dedicated face detection pipeline
    private HandlerThread faceDetectionThread;
    private Handler faceDetectionHandler;
    private YuvConverter yuvConverter;
    private EglBase eglBase;
    private final AtomicBoolean isProcessing = new AtomicBoolean(false);
    private volatile boolean pipelineInitialized = false;

    // Track eye states per face for blink detection
    private final Map<Integer, EyeState> leftEyeStates = new HashMap<>();
    private final Map<Integer, EyeState> rightEyeStates = new HashMap<>();

    private static class EyeState {
        boolean isOpen = true;
        boolean wasOpen = true;
        int blinkCount = 0;
        float currentProbability = 1.0f;
        float smoothedProbability = 1.0f;       // EMA smoothed value
        long closedTimestamp = 0;                // When eye closed (ms)
        long lastBlinkTimestamp = 0;             // Last blink time (ms) for debounce
        float minProbDuringClosure = 1.0f;       // Lowest prob while closed
    }

    public FaceDetectionProcessor(ReactApplicationContext context) {
        this.reactContext = context;
        initializeFaceDetector();
    }

    private void initializeFaceDetector() {
        FaceDetectorOptions options = new FaceDetectorOptions.Builder()
                .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
                .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
                .setContourMode(FaceDetectorOptions.CONTOUR_MODE_NONE)
                .setMinFaceSize(0.15f)
                .enableTracking()
                .build();
        
        this.detector = FaceDetection.getClient(options);
    }

    /**
     * Initialize the dedicated face detection pipeline.
     * This creates a separate EGL context and thread for safe texture conversion.
     */
    private synchronized void initializePipeline() {
        if (pipelineInitialized) {
            return;
        }

        try {
            // Create dedicated thread for face detection
            faceDetectionThread = new HandlerThread("FaceDetectionThread");
            faceDetectionThread.start();
            faceDetectionHandler = new Handler(faceDetectionThread.getLooper());

            // Create dedicated EGL context for texture conversion
            // This is separate from the rendering EGL context to avoid conflicts
            eglBase = EglBase.create();
            
            // Initialize YuvConverter on the face detection thread
            faceDetectionHandler.post(() -> {
                try {
                    yuvConverter = new YuvConverter();
                    Log.d(TAG, "Face detection pipeline initialized");
                } catch (Exception e) {
                    Log.e(TAG, "Failed to initialize YuvConverter: " + e.getMessage());
                }
            });

            pipelineInitialized = true;
        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize face detection pipeline: " + e.getMessage());
        }
    }

    public void setEnabled(boolean enabled) {
        this.isEnabled = enabled;
        if (enabled) {
            initializePipeline();
        }
        if (!enabled) {
            reset();
        }
    }

    public void setFrameSkipCount(int count) {
        this.frameSkipCount = Math.max(1, count);
    }

    public void setBlinkThreshold(float threshold) {
        this.blinkThreshold = threshold;
    }

    // Frame capture setters
    public void setCaptureOnBlink(boolean capture) {
        this.captureOnBlink = capture;
    }

    public void setCropToFace(boolean crop) {
        this.cropToFace = crop;
    }

    public void setImageQuality(float quality) {
        this.imageQuality = quality;
    }

    public void setMaxImageWidth(int width) {
        this.maxImageWidth = width;
    }

    public void setMinBlinkDurationMs(long ms) {
        this.minBlinkDurationMs = ms;
    }

    public void setMaxBlinkDurationMs(long ms) {
        this.maxBlinkDurationMs = ms;
    }

    public void setBlinkCooldownMs(long ms) {
        this.blinkCooldownMs = ms;
    }

    public void setAdaptiveThreshold(boolean enabled) {
        this.adaptiveThresholdEnabled = enabled;
    }

    public void setCalibrationDurationMs(long ms) {
        this.calibrationDurationMs = ms;
    }

    public void startCalibrationIfNeeded() {
        if (adaptiveThresholdEnabled && !isCalibrating) {
            isCalibrating = true;
            calibrationStartTime = System.currentTimeMillis();
            calibrationSamples.clear();
            Log.d(TAG, "Adaptive threshold calibration started");
        }
    }

    private void processCalibrationSample(float openProbability) {
        if (!isCalibrating) return;

        long now = System.currentTimeMillis();

        // Only collect samples that are likely open-eye (> 0.5)
        if (openProbability > 0.5f) {
            calibrationSamples.add(openProbability);
        }

        // Check if calibration period is over
        if (now - calibrationStartTime >= calibrationDurationMs) {
            if (!calibrationSamples.isEmpty()) {
                float sum = 0;
                for (float sample : calibrationSamples) {
                    sum += sample;
                }
                float meanOpen = sum / calibrationSamples.size();
                float adaptedThreshold = meanOpen * 0.5f;
                blinkThreshold = Math.max(adaptedThreshold, 0.1f);
                Log.d(TAG, "Adaptive threshold calibrated: " + blinkThreshold +
                      " (mean open: " + meanOpen + ", samples: " + calibrationSamples.size() + ")");
            } else {
                Log.d(TAG, "Calibration ended with no valid samples, keeping threshold: " + blinkThreshold);
            }
            isCalibrating = false;
            calibrationSamples.clear();
        }
    }

    public void reset() {
        leftEyeStates.clear();
        rightEyeStates.clear();
        frameCounter = 0;
        lastFrameRotation = 0;
        closedEyeFrameRotation = 0;
        isCalibrating = false;
        calibrationStartTime = 0;
        calibrationSamples.clear();
    }

    @Override
    public VideoFrame process(VideoFrame frame, SurfaceTextureHelper textureHelper) {
        // Always return the frame immediately - never block the video pipeline
        if (!isEnabled || !pipelineInitialized) {
            return frame;
        }

        frameCounter++;
        
        // Skip frames for performance
        if (frameCounter % frameSkipCount != 0) {
            return frame;
        }

        // Only process if not already processing a frame
        // This prevents queue buildup and ensures we don't overwhelm the detection thread
        if (!isProcessing.compareAndSet(false, true)) {
            return frame;
        }

        try {
            VideoFrame.Buffer buffer = frame.getBuffer();
            final int rotation = frame.getRotation();
            final int frameWidth = frame.getRotatedWidth();
            final int frameHeight = frame.getRotatedHeight();
            
            if (buffer instanceof VideoFrame.I420Buffer) {
                // Already I420 - process directly (fast path)
                processI420Buffer((VideoFrame.I420Buffer) buffer, rotation, frameWidth, frameHeight);
            } else {
                // TextureBuffer - need to convert on dedicated thread
                processTextureBuffer(frame, textureHelper, rotation, frameWidth, frameHeight);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in process: " + e.getMessage());
            isProcessing.set(false);
        }

        return frame;
    }

    /**
     * Process an I420 buffer directly (fast path for non-texture buffers)
     */
    private void processI420Buffer(VideoFrame.I420Buffer i420Buffer, int rotation,
                                    int frameWidth, int frameHeight) {
        try {
            InputImage image = createInputImageFromI420Buffer(i420Buffer, rotation);
            if (image != null) {
                runFaceDetection(image, rotation, frameWidth, frameHeight);
            } else {
                isProcessing.set(false);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error processing I420 buffer: " + e.getMessage());
            isProcessing.set(false);
        }
    }

    /**
     * Process a TextureBuffer by converting it to I420 and copying data SYNCHRONOUSLY.
     * The pixel data is copied into an InputImage before returning, so we don't need
     * to retain the frame for async processing.
     */
    private void processTextureBuffer(VideoFrame frame, SurfaceTextureHelper textureHelper,
                                       int rotation, int frameWidth, int frameHeight) {
        VideoFrame.I420Buffer i420Buffer = null;
        try {
            // IMPORTANT: Retain the frame before conversion to prevent it from being
            // released by the EglRenderer while we're using it
            frame.retain();
            
            // Convert texture to I420 SYNCHRONOUSLY
            // This creates a new buffer with copied data that we own
            VideoFrame.Buffer buffer = frame.getBuffer();
            
            i420Buffer = buffer.toI420();
            
            // Release our retain on the frame - we're done accessing the texture
            frame.release();
            
            if (i420Buffer != null) {
                // Create InputImage SYNCHRONOUSLY - this copies the pixel data
                // into a byte array that we own
                final InputImage image = createInputImageFromI420Buffer(i420Buffer, rotation);
                
                // Release the I420 buffer now - we've copied all the data we need
                i420Buffer.release();
                i420Buffer = null;
                
                if (image != null && faceDetectionHandler != null) {
                    // Now we can safely process async - the InputImage has its own data copy
                    final int capturedRotation = rotation;
                    faceDetectionHandler.post(() -> {
                        runFaceDetection(image, capturedRotation, frameWidth, frameHeight);
                    });
                } else {
                    isProcessing.set(false);
                }
            } else {
                isProcessing.set(false);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error converting texture to I420: " + e.getMessage());
            isProcessing.set(false);
            // Release the I420 buffer if we created one
            if (i420Buffer != null) {
                i420Buffer.release();
            }
            // Make sure to release the frame retain in case of error
            try {
                frame.release();
            } catch (Exception ignored) {}
        }
        
    }

    /**
     * Run ML Kit face detection on the prepared image
     */
    private void runFaceDetection(InputImage image, int rotation, int frameWidth, int frameHeight) {
        try {
            Task<List<Face>> result = detector.process(image);

            result.addOnSuccessListener(faces -> {
                processFaceResults(faces, rotation, frameWidth, frameHeight);
                isProcessing.set(false);
            }).addOnFailureListener(e -> {
                Log.e(TAG, "Face detection failed: " + e.getMessage());
                isProcessing.set(false);
            });
        } catch (Exception e) {
            Log.e(TAG, "Error running face detection: " + e.getMessage());
            isProcessing.set(false);
        }
    }

    private InputImage createInputImageFromI420Buffer(VideoFrame.I420Buffer i420Buffer, int rotation) {
        try {
            int width = i420Buffer.getWidth();
            int height = i420Buffer.getHeight();

            // Create NV21 format data (required by ML Kit)
            int ySize = width * height;
            int uvSize = width * height / 2;
            byte[] nv21 = new byte[ySize + uvSize];

            // Copy Y plane
            ByteBuffer yBuffer = i420Buffer.getDataY().duplicate();
            yBuffer.rewind();
            int yRemaining = Math.min(ySize, yBuffer.remaining());
            yBuffer.get(nv21, 0, yRemaining);

            // Interleave U and V planes to create NV21
            ByteBuffer uBuffer = i420Buffer.getDataU().duplicate();
            ByteBuffer vBuffer = i420Buffer.getDataV().duplicate();
            uBuffer.rewind();
            vBuffer.rewind();
            
            int uvWidth = width / 2;
            int uvHeight = height / 2;
            int strideU = i420Buffer.getStrideU();
            int strideV = i420Buffer.getStrideV();
            
            for (int row = 0; row < uvHeight; row++) {
                for (int col = 0; col < uvWidth; col++) {
                    int uvIndex = ySize + row * width + col * 2;
                    int srcIndexU = row * strideU + col;
                    int srcIndexV = row * strideV + col;

                    if (uvIndex + 1 < nv21.length &&
                        srcIndexU < uBuffer.limit() &&
                        srcIndexV < vBuffer.limit()) {
                        nv21[uvIndex] = vBuffer.get(srcIndexV);      // V comes first in NV21
                        nv21[uvIndex + 1] = uBuffer.get(srcIndexU);  // Then U
                    }
                }
            }

            // Store NV21 data for frame capture if enabled
            if (captureOnBlink) {
                lastNv21Data = nv21.clone();
                lastFrameWidth = width;
                lastFrameHeight = height;
                lastFrameRotation = rotation;
            }

            return InputImage.fromByteArray(
                    nv21,
                    width,
                    height,
                    rotation,
                    InputImage.IMAGE_FORMAT_NV21
            );

        } catch (Exception e) {
            Log.e(TAG, "Error creating InputImage: " + e.getMessage());
            return null;
        }
    }

    // Helper class to hold blink detection result from processEye
    private static class BlinkResult {
        boolean didBlink = false;
        long blinkDuration = 0;
    }

    private void processFaceResults(List<Face> faces, int rotation, int frameWidth, int frameHeight) {
        WritableArray facesArray = Arguments.createArray();
        java.util.HashSet<Integer> seenTrackingIds = new java.util.HashSet<>();
        long now = System.currentTimeMillis();

        // Derive pre-rotation (source I420) dimensions so we can map ML Kit
        // coordinates (which are expressed in the rotated/upright frame) back
        // into the raw buffer coordinates that ImageAdjustmentProcessor sees.
        final int srcWidth;
        final int srcHeight;
        if (rotation == 90 || rotation == 270) {
            srcWidth = frameHeight;
            srcHeight = frameWidth;
        } else {
            srcWidth = frameWidth;
            srcHeight = frameHeight;
        }

        // Track whether we published anything for this frame. If ML Kit returned
        // no faces we still want to invalidate the cache so stale data (from
        // seconds ago) doesn't linger in ImageAdjustmentProcessor.
        boolean publishedFaceThisFrame = false;

        for (Face face : faces) {
            WritableMap faceMap = Arguments.createMap();

            Integer trackingId = face.getTrackingId();
            if (trackingId != null) {
                seenTrackingIds.add(trackingId);
            }

            // Bounding box
            WritableMap bounds = Arguments.createMap();
            bounds.putDouble("x", face.getBoundingBox().left);
            bounds.putDouble("y", face.getBoundingBox().top);
            bounds.putDouble("width", face.getBoundingBox().width());
            bounds.putDouble("height", face.getBoundingBox().height());
            faceMap.putMap("bounds", bounds);

            faceMap.putDouble("confidence", 1.0);

            if (trackingId != null) {
                faceMap.putInt("trackingId", trackingId);
            }

            // Head pose
            WritableMap headPose = Arguments.createMap();
            headPose.putDouble("yaw", face.getHeadEulerAngleY());
            headPose.putDouble("pitch", face.getHeadEulerAngleX());
            headPose.putDouble("roll", face.getHeadEulerAngleZ());
            faceMap.putMap("headPose", headPose);

            // Landmarks
            WritableMap landmarks = Arguments.createMap();
            Rect faceBounds = face.getBoundingBox();

            BlinkResult leftBlinkResult = new BlinkResult();
            BlinkResult rightBlinkResult = new BlinkResult();

            FaceLandmark leftEye = face.getLandmark(FaceLandmark.LEFT_EYE);
            WritableMap leftEyeData = processEye(
                    leftEye, face.getLeftEyeOpenProbability(),
                    trackingId, leftEyeStates, faceBounds, leftBlinkResult
            );
            landmarks.putMap("leftEye", leftEyeData);

            FaceLandmark rightEye = face.getLandmark(FaceLandmark.RIGHT_EYE);
            WritableMap rightEyeData = processEye(
                    rightEye, face.getRightEyeOpenProbability(),
                    trackingId, rightEyeStates, faceBounds, rightBlinkResult
            );
            landmarks.putMap("rightEye", rightEyeData);

            // Unified blink emission - prevents double-counting natural blinks
            if (leftBlinkResult.didBlink || rightBlinkResult.didBlink) {
                String eyeSide;
                String blinkType;
                int blinkCountToReport;
                long duration;
                float minProb;

                EyeState leftState = trackingId != null ? leftEyeStates.get(trackingId) : null;
                EyeState rightState = trackingId != null ? rightEyeStates.get(trackingId) : null;

                if (leftBlinkResult.didBlink && rightBlinkResult.didBlink) {
                    eyeSide = "both";
                    blinkType = "blink";
                    blinkCountToReport = Math.max(
                            leftState != null ? leftState.blinkCount : 0,
                            rightState != null ? rightState.blinkCount : 0);
                    duration = Math.max(leftBlinkResult.blinkDuration, rightBlinkResult.blinkDuration);
                    minProb = Math.min(
                            leftState != null ? leftState.minProbDuringClosure : 1.0f,
                            rightState != null ? rightState.minProbDuringClosure : 1.0f);
                } else if (leftBlinkResult.didBlink) {
                    eyeSide = "left";
                    blinkType = "wink";
                    blinkCountToReport = leftState != null ? leftState.blinkCount : 0;
                    duration = leftBlinkResult.blinkDuration;
                    minProb = leftState != null ? leftState.minProbDuringClosure : 1.0f;
                } else {
                    eyeSide = "right";
                    blinkType = "wink";
                    blinkCountToReport = rightState != null ? rightState.blinkCount : 0;
                    duration = rightBlinkResult.blinkDuration;
                    minProb = rightState != null ? rightState.minProbDuringClosure : 1.0f;
                }

                // Compute confidence score
                float deltaScore = Math.min(Math.max((blinkThreshold - minProb) / blinkThreshold, 0), 1);
                float optimalDuration = 150.0f;
                float durationDeviation = Math.abs(duration - optimalDuration) / optimalDuration;
                float durationScore = Math.min(Math.max(1.0f - durationDeviation, 0), 1);
                float symmetryScore = (leftBlinkResult.didBlink && rightBlinkResult.didBlink) ? 1.0f : 0.7f;
                float confidence = 0.4f * deltaScore + 0.3f * durationScore + 0.3f * symmetryScore;

                Log.d(TAG, "Blink detected: " + eyeSide + " (type: " + blinkType +
                      ", count: " + blinkCountToReport + ", duration: " + duration +
                      "ms, confidence: " + String.format("%.2f", confidence) + ")");

                WritableMap blinkEvent = Arguments.createMap();
                blinkEvent.putDouble("timestamp", now);
                blinkEvent.putString("eye", eyeSide);
                if (trackingId != null) {
                    blinkEvent.putInt("trackingId", trackingId);
                }
                blinkEvent.putInt("blinkCount", blinkCountToReport);
                blinkEvent.putDouble("duration", duration);
                blinkEvent.putString("blinkType", blinkType);
                blinkEvent.putDouble("confidence", confidence);
                blinkEvent.putDouble("minOpenProbability", minProb);

                // Use STORED closed-eye frame for capture
                if (captureOnBlink && closedEyeNv21Data != null && closedEyeFaceBounds != null) {
                    byte[] savedNv21 = lastNv21Data;
                    int savedWidth = lastFrameWidth;
                    int savedHeight = lastFrameHeight;
                    int savedRotation = lastFrameRotation;

                    lastNv21Data = closedEyeNv21Data;
                    lastFrameWidth = closedEyeFrameWidth;
                    lastFrameHeight = closedEyeFrameHeight;
                    lastFrameRotation = closedEyeFrameRotation;

                    String base64Image = captureFrameAsBase64(closedEyeFaceBounds);

                    lastNv21Data = savedNv21;
                    lastFrameWidth = savedWidth;
                    lastFrameHeight = savedHeight;
                    lastFrameRotation = savedRotation;

                    if (base64Image != null) {
                        blinkEvent.putString("faceImage", base64Image);
                        WritableMap boundsMap = Arguments.createMap();
                        boundsMap.putInt("x", closedEyeFaceBounds.left);
                        boundsMap.putInt("y", closedEyeFaceBounds.top);
                        boundsMap.putInt("width", closedEyeFaceBounds.width());
                        boundsMap.putInt("height", closedEyeFaceBounds.height());
                        blinkEvent.putMap("faceBounds", boundsMap);
                    }

                    closedEyeNv21Data = null;
                    closedEyeFaceBounds = null;
                }

                sendEvent(EVENT_BLINK_DETECTED, blinkEvent);
            }

            // Extract mouth landmarks
            FaceLandmark mouthBottom = face.getLandmark(FaceLandmark.MOUTH_BOTTOM);
            FaceLandmark mouthLeft = face.getLandmark(FaceLandmark.MOUTH_LEFT);
            FaceLandmark mouthRight = face.getLandmark(FaceLandmark.MOUTH_RIGHT);
            if (mouthBottom != null && mouthLeft != null && mouthRight != null) {
                WritableMap mouthData = Arguments.createMap();
                WritableMap mouthPosition = Arguments.createMap();
                float centerX = (mouthLeft.getPosition().x + mouthRight.getPosition().x) / 2.0f;
                float centerY = mouthBottom.getPosition().y;
                mouthPosition.putDouble("x", centerX);
                mouthPosition.putDouble("y", centerY);
                mouthData.putMap("position", mouthPosition);
                float mouthWidth = Math.abs(mouthRight.getPosition().x - mouthLeft.getPosition().x);
                mouthData.putDouble("width", mouthWidth);
                mouthData.putDouble("height", mouthWidth * 0.5);
                landmarks.putMap("mouth", mouthData);
            }

            // Extract nose landmark
            FaceLandmark noseBase = face.getLandmark(FaceLandmark.NOSE_BASE);
            if (noseBase != null) {
                WritableMap noseData = Arguments.createMap();
                WritableMap nosePosition = Arguments.createMap();
                nosePosition.putDouble("x", noseBase.getPosition().x);
                nosePosition.putDouble("y", noseBase.getPosition().y);
                noseData.putMap("position", nosePosition);
                landmarks.putMap("nose", noseData);
            }

            faceMap.putMap("landmarks", landmarks);
            facesArray.pushMap(faceMap);

            // Publish this face into the single-slot cache so
            // ImageAdjustmentProcessor can build a skin mask. We only publish
            // the first face (single-slot cache) — if multiple faces are
            // present the first ML-Kit-returned one wins.
            if (!publishedFaceThisFrame) {
                FaceResultCache.FaceResult cached =
                        buildCacheResult(face, mouthBottom, mouthLeft, mouthRight,
                                         rotation, srcWidth, srcHeight);
                if (cached != null) {
                    FaceResultCache.getInstance().publish(cached);
                    publishedFaceThisFrame = true;
                }
            }
        }

        // If no face was published this frame, invalidate the cache so
        // ImageAdjustmentProcessor sees stale-empty rather than a lingering bbox.
        if (!publishedFaceThisFrame) {
            FaceResultCache.FaceResult empty = new FaceResultCache.FaceResult();
            empty.valid = false;
            FaceResultCache.getInstance().publish(empty);
        }

        // Evict stale eye state entries for faces no longer in frame
        if (!seenTrackingIds.isEmpty()) {
            leftEyeStates.keySet().retainAll(seenTrackingIds);
            rightEyeStates.keySet().retainAll(seenTrackingIds);
        }

        WritableMap result = Arguments.createMap();
        result.putArray("faces", facesArray);
        result.putDouble("timestamp", now);
        result.putInt("frameWidth", frameWidth);
        result.putInt("frameHeight", frameHeight);

        sendEvent(EVENT_FACE_DETECTED, result);
    }

    /**
     * Build a {@link FaceResultCache.FaceResult} from an ML Kit face. ML Kit
     * returns coordinates in the rotated (upright) frame; we un-rotate them
     * back into source-I420 space so {@link ImageAdjustmentProcessor} can
     * mask directly on the pre-rotation buffer.
     */
    private FaceResultCache.FaceResult buildCacheResult(Face face,
                                                        FaceLandmark mouthBottom,
                                                        FaceLandmark mouthLeft,
                                                        FaceLandmark mouthRight,
                                                        int rotation,
                                                        int srcWidth,
                                                        int srcHeight) {
        if (face == null) {
            return null;
        }
        Rect bb = face.getBoundingBox();
        if (bb == null || bb.width() <= 0 || bb.height() <= 0) {
            return null;
        }

        // Un-rotate the bbox corners. Because rotations of 90/270 swap axes,
        // we un-rotate all four corners and take the resulting bbox.
        float[] tl = unrotatePoint(bb.left, bb.top, rotation, srcWidth, srcHeight);
        float[] tr = unrotatePoint(bb.right, bb.top, rotation, srcWidth, srcHeight);
        float[] bl = unrotatePoint(bb.left, bb.bottom, rotation, srcWidth, srcHeight);
        float[] br = unrotatePoint(bb.right, bb.bottom, rotation, srcWidth, srcHeight);

        float minX = Math.min(Math.min(tl[0], tr[0]), Math.min(bl[0], br[0]));
        float minY = Math.min(Math.min(tl[1], tr[1]), Math.min(bl[1], br[1]));
        float maxX = Math.max(Math.max(tl[0], tr[0]), Math.max(bl[0], br[0]));
        float maxY = Math.max(Math.max(tl[1], tr[1]), Math.max(bl[1], br[1]));

        int bx = Math.max(0, Math.round(minX));
        int by = Math.max(0, Math.round(minY));
        int bw = Math.min(srcWidth - bx, Math.round(maxX - minX));
        int bh = Math.min(srcHeight - by, Math.round(maxY - minY));
        if (bw <= 0 || bh <= 0) {
            return null;
        }

        FaceResultCache.FaceResult r = new FaceResultCache.FaceResult();
        r.valid = true;
        r.bboxX = bx;
        r.bboxY = by;
        r.bboxW = bw;
        r.bboxH = bh;
        r.faceWidth = bw;
        r.timestampNanos = System.nanoTime();

        FaceLandmark leftEye = face.getLandmark(FaceLandmark.LEFT_EYE);
        if (leftEye != null && leftEye.getPosition() != null) {
            float[] p = unrotatePoint(leftEye.getPosition().x, leftEye.getPosition().y,
                                      rotation, srcWidth, srcHeight);
            r.leftEyeX = p[0];
            r.leftEyeY = p[1];
        }
        FaceLandmark rightEye = face.getLandmark(FaceLandmark.RIGHT_EYE);
        if (rightEye != null && rightEye.getPosition() != null) {
            float[] p = unrotatePoint(rightEye.getPosition().x, rightEye.getPosition().y,
                                      rotation, srcWidth, srcHeight);
            r.rightEyeX = p[0];
            r.rightEyeY = p[1];
        }
        if (mouthBottom != null && mouthLeft != null && mouthRight != null
                && mouthBottom.getPosition() != null
                && mouthLeft.getPosition() != null
                && mouthRight.getPosition() != null) {
            float mcx = (mouthLeft.getPosition().x + mouthRight.getPosition().x) * 0.5f;
            float mcy = mouthBottom.getPosition().y;
            float[] p = unrotatePoint(mcx, mcy, rotation, srcWidth, srcHeight);
            r.mouthX = p[0];
            r.mouthY = p[1];
        }
        return r;
    }

    /**
     * Map a point (x, y) from the rotated/upright ML-Kit coordinate system
     * back to the source (pre-rotation) I420 buffer coordinate system.
     *
     * {@code rotation} is the frame rotation in degrees (0/90/180/270) where
     * rotation==90 means the source needs to be rotated 90° CW to be upright.
     *
     * Source dims are {@code srcWidth x srcHeight} (pre-rotation).
     */
    private static float[] unrotatePoint(float ux, float uy, int rotation, int srcWidth, int srcHeight) {
        float sx;
        float sy;
        switch (rotation) {
            case 90:
                sx = uy;
                sy = (srcHeight - 1) - ux;
                break;
            case 180:
                sx = (srcWidth - 1) - ux;
                sy = (srcHeight - 1) - uy;
                break;
            case 270:
                sx = (srcWidth - 1) - uy;
                sy = ux;
                break;
            case 0:
            default:
                sx = ux;
                sy = uy;
                break;
        }
        return new float[] { sx, sy };
    }

    private WritableMap processEye(FaceLandmark eyeLandmark, Float openProbability,
                                    Integer trackingId, Map<Integer, EyeState> eyeStates,
                                    Rect faceBounds, BlinkResult blinkResult) {
        WritableMap eyeData = Arguments.createMap();

        WritableMap position = Arguments.createMap();
        if (eyeLandmark != null && eyeLandmark.getPosition() != null) {
            position.putDouble("x", eyeLandmark.getPosition().x);
            position.putDouble("y", eyeLandmark.getPosition().y);
        } else {
            position.putDouble("x", 0);
            position.putDouble("y", 0);
        }
        eyeData.putMap("position", position);

        if (openProbability != null && trackingId != null) {
            EyeState eyeState = eyeStates.get(trackingId);
            if (eyeState == null) {
                eyeState = new EyeState();
                eyeStates.put(trackingId, eyeState);
            }

            // Adaptive threshold calibration
            if (isCalibrating) {
                processCalibrationSample(openProbability);
            }

            eyeState.currentProbability = openProbability;

            // Apply EMA smoothing (Phase 2.1)
            float alpha = 0.4f;
            eyeState.smoothedProbability = alpha * openProbability + (1.0f - alpha) * eyeState.smoothedProbability;

            eyeState.wasOpen = eyeState.isOpen;
            eyeState.isOpen = eyeState.smoothedProbability > blinkThreshold;

            long now = System.currentTimeMillis();

            // Track minimum probability during closure (for confidence)
            if (!eyeState.isOpen) {
                eyeState.minProbDuringClosure = Math.min(eyeState.minProbDuringClosure, openProbability);
            }

            // CAPTURE FRAME WHEN EYE CLOSES (open -> closed transition)
            if (eyeState.wasOpen && !eyeState.isOpen) {
                eyeState.closedTimestamp = now;
                eyeState.minProbDuringClosure = openProbability;

                if (captureOnBlink && lastNv21Data != null && faceBounds != null) {
                    closedEyeNv21Data = lastNv21Data.clone();
                    closedEyeFrameWidth = lastFrameWidth;
                    closedEyeFrameHeight = lastFrameHeight;
                    closedEyeFrameRotation = lastFrameRotation;
                    closedEyeFaceBounds = new Rect(faceBounds);
                }
            }

            // DETECT BLINK (closed -> open transition)
            // Don't emit during calibration
            if (!eyeState.wasOpen && eyeState.isOpen && !isCalibrating) {
                long blinkDuration = now - eyeState.closedTimestamp;

                // Temporal validation (Phase 2.2)
                boolean durationValid = (blinkDuration >= minBlinkDurationMs && blinkDuration <= maxBlinkDurationMs);

                // Debounce (Phase 2.3)
                boolean cooldownPassed = (eyeState.lastBlinkTimestamp == 0 ||
                                          (now - eyeState.lastBlinkTimestamp) >= blinkCooldownMs);

                if (durationValid && cooldownPassed) {
                    eyeState.blinkCount++;
                    eyeState.lastBlinkTimestamp = now;
                    blinkResult.didBlink = true;
                    blinkResult.blinkDuration = blinkDuration;
                }
            }

            eyeData.putBoolean("isOpen", eyeState.isOpen);
            eyeData.putDouble("openProbability", openProbability);
            eyeData.putInt("blinkCount", eyeState.blinkCount);
        } else {
            eyeData.putBoolean("isOpen", true);
            eyeData.putDouble("openProbability", 1.0);
            eyeData.putInt("blinkCount", 0);
        }

        return eyeData;
    }

    /**
     * Captures current frame and returns base64 encoded JPEG.
     * @param faceBounds Face bounding box in pixel coordinates
     * @return Base64 encoded JPEG string, or null on failure
     */
    private String captureFrameAsBase64(Rect faceBounds) {
        if (lastNv21Data == null) return null;

        try {
            // Convert NV21 to Bitmap via YuvImage
            YuvImage yuvImage = new YuvImage(
                lastNv21Data, ImageFormat.NV21,
                lastFrameWidth, lastFrameHeight, null);

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            yuvImage.compressToJpeg(new Rect(0, 0, lastFrameWidth, lastFrameHeight), 100, out);
            Bitmap bitmap = BitmapFactory.decodeByteArray(out.toByteArray(), 0, out.size());

            if (bitmap == null) return null;

            Bitmap resultBitmap = bitmap;

            // Crop to face if enabled
            if (cropToFace && faceBounds != null && !faceBounds.isEmpty()) {
                int padding = (int)(faceBounds.width() * 0.15);
                Rect cropRect = new Rect(
                    Math.max(0, faceBounds.left - padding),
                    Math.max(0, faceBounds.top - padding),
                    Math.min(bitmap.getWidth(), faceBounds.right + padding),
                    Math.min(bitmap.getHeight(), faceBounds.bottom + padding)
                );

                if (cropRect.width() > 0 && cropRect.height() > 0) {
                    resultBitmap = Bitmap.createBitmap(bitmap,
                        cropRect.left, cropRect.top, cropRect.width(), cropRect.height());
                    if (resultBitmap != bitmap) {
                        bitmap.recycle();
                    }
                }
            }

            // Scale down if too large
            if (resultBitmap.getWidth() > maxImageWidth) {
                float scale = (float) maxImageWidth / resultBitmap.getWidth();
                int newHeight = (int) (resultBitmap.getHeight() * scale);
                Bitmap scaledBitmap = Bitmap.createScaledBitmap(resultBitmap, maxImageWidth, newHeight, true);
                if (scaledBitmap != resultBitmap) {
                    resultBitmap.recycle();
                }
                resultBitmap = scaledBitmap;
            }

            // Apply frame rotation to correct image orientation
            if (lastFrameRotation != 0) {
                Matrix matrix = new Matrix();
                matrix.postRotate(lastFrameRotation);
                Bitmap rotatedBitmap = Bitmap.createBitmap(
                    resultBitmap, 0, 0,
                    resultBitmap.getWidth(), resultBitmap.getHeight(),
                    matrix, true);
                if (rotatedBitmap != resultBitmap) {
                    resultBitmap.recycle();
                }
                resultBitmap = rotatedBitmap;
            }

            // Encode to JPEG base64
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            resultBitmap.compress(Bitmap.CompressFormat.JPEG, (int)(imageQuality * 100), baos);
            String base64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);

            resultBitmap.recycle();
            return base64;

        } catch (Exception e) {
            Log.e(TAG, "Error capturing frame: " + e.getMessage());
            return null;
        }
    }

    private void sendEvent(String eventName, WritableMap params) {
        if (reactContext != null && reactContext.hasActiveCatalystInstance()) {
            reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit(eventName, params);
        }
    }

    public void cleanup() {
        isEnabled = false;
        
        if (faceDetectionHandler != null) {
            faceDetectionHandler.post(() -> {
                if (yuvConverter != null) {
                    yuvConverter.release();
                    yuvConverter = null;
                }
            });
        }
        
        if (faceDetectionThread != null) {
            faceDetectionThread.quitSafely();
            faceDetectionThread = null;
            faceDetectionHandler = null;
        }
        
        if (eglBase != null) {
            eglBase.release();
            eglBase = null;
        }
        
        if (detector != null) {
            detector.close();
            detector = null;
        }
        
        leftEyeStates.clear();
        rightEyeStates.clear();
        pipelineInitialized = false;

        // Clear frame capture data
        lastNv21Data = null;
        lastFrameWidth = 0;
        lastFrameHeight = 0;
        lastFrameRotation = 0;

        // Clear closed-eye frame data
        closedEyeNv21Data = null;
        closedEyeFrameWidth = 0;
        closedEyeFrameHeight = 0;
        closedEyeFaceBounds = null;
        closedEyeFrameRotation = 0;

        Log.d(TAG, "Face detection pipeline cleaned up");
    }
}
