/**
 * Configuration options for face detection
 */
export interface FaceDetectionConfig {
    /**
     * Process every Nth frame to optimize performance
     * Default: 3 (process every 3rd frame)
     */
    frameSkipCount?: number;
    
    /**
     * Eye Aspect Ratio threshold for blink detection (iOS)
     * or open probability threshold (Android)
     * Default: 0.21 (iOS) / 0.3 (Android)
     */
    blinkThreshold?: number;
}

/**
 * Result from face detection processing
 */
export interface FaceDetectionResult {
    /**
     * Array of detected faces in the frame
     */
    faces: Face[];
    
    /**
     * Timestamp when the detection occurred (in milliseconds)
     */
    timestamp: number;
    
    /**
     * Width of the video frame
     */
    frameWidth: number;
    
    /**
     * Height of the video frame
     */
    frameHeight: number;
}

/**
 * Detected face information
 */
export interface Face {
    /**
     * Bounding box of the face in the frame
     */
    bounds: BoundingBox;
    
    /**
     * Facial landmarks (eyes, nose, mouth, etc.)
     */
    landmarks: FaceLandmarks;
    
    /**
     * Confidence score of face detection (0.0 to 1.0)
     */
    confidence: number;
    
    /**
     * Unique tracking ID for this face across frames
     * Useful for tracking the same person over time
     */
    trackingId?: number;
    
    /**
     * Head pose estimation (rotation angles)
     */
    headPose?: HeadPose;
}

/**
 * Bounding box coordinates
 */
export interface BoundingBox {
    /**
     * X coordinate of top-left corner
     */
    x: number;
    
    /**
     * Y coordinate of top-left corner
     */
    y: number;
    
    /**
     * Width of the bounding box
     */
    width: number;
    
    /**
     * Height of the bounding box
     */
    height: number;
}

/**
 * Facial landmarks
 */
export interface FaceLandmarks {
    /**
     * Left eye data
     */
    leftEye: EyeData;
    
    /**
     * Right eye data
     */
    rightEye: EyeData;
}

/**
 * Eye-specific data including blink detection
 */
export interface EyeData {
    /**
     * Position of the eye center in the frame
     */
    position: {
        x: number;
        y: number;
    };
    
    /**
     * Whether the eye is currently open
     */
    isOpen: boolean;
    
    /**
     * Probability that the eye is open (0.0 = closed, 1.0 = open)
     */
    openProbability: number;
    
    /**
     * Number of blinks detected for this eye
     */
    blinkCount: number;
}

/**
 * Head pose estimation (in degrees)
 */
export interface HeadPose {
    /**
     * Left-right rotation (side to side)
     * Negative = left, Positive = right
     */
    yaw: number;
    
    /**
     * Up-down rotation (nodding)
     * Negative = down, Positive = up
     */
    pitch: number;
    
    /**
     * Tilt rotation
     * Negative = tilt left, Positive = tilt right
     */
    roll: number;
}

/**
 * Blink detection event data
 */
export interface BlinkEvent {
    /**
     * Timestamp when the blink occurred (in milliseconds)
     */
    timestamp: number;
    
    /**
     * Which eye blinked (available on some platforms)
     */
    eye?: 'left' | 'right';
    
    /**
     * Face tracking ID associated with this blink
     */
    trackingId?: number;
}

