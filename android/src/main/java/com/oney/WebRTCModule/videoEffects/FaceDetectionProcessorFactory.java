package com.oney.WebRTCModule.videoEffects;

import com.facebook.react.bridge.ReactApplicationContext;

/**
 * Factory for creating FaceDetectionProcessor instances.
 */
public class FaceDetectionProcessorFactory implements VideoFrameProcessorFactoryInterface {
    private final ReactApplicationContext reactContext;
    private FaceDetectionProcessor currentProcessor;

    public FaceDetectionProcessorFactory(ReactApplicationContext context) {
        this.reactContext = context;
    }

    @Override
    public VideoFrameProcessor build() {
        // Always return the same processor instance to ensure
        // enabling/disabling affects the same processor used for video effects
        if (currentProcessor == null) {
            currentProcessor = new FaceDetectionProcessor(reactContext);
        }
        return currentProcessor;
    }

    /**
     * Get the current processor instance for configuration.
     * Creates one if it doesn't exist.
     */
    public FaceDetectionProcessor getProcessor() {
        return (FaceDetectionProcessor) build();
    }

    /**
     * Cleanup resources when the module is destroyed.
     */
    public void cleanup() {
        if (currentProcessor != null) {
            currentProcessor.cleanup();
            currentProcessor = null;
        }
    }
}

