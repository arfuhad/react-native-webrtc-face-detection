import { useState, useEffect, useCallback } from 'react';
import { NativeModules, NativeEventEmitter } from 'react-native';
import MediaStreamTrack from '../MediaStreamTrack';
import { FaceDetectionConfig, FaceDetectionResult } from '../FaceDetection.types';

const { WebRTCModule } = NativeModules;
const eventEmitter = new NativeEventEmitter(WebRTCModule);

/**
 * React hook for face detection on a video track
 * 
 * @param track The video track to perform face detection on
 * @param config Optional configuration for face detection
 * @returns Object with detection results and control functions
 * 
 * @example
 * ```tsx
 * const videoTrack = stream.getVideoTracks()[0];
 * const { detectionResult, isEnabled, enable, disable } = useFaceDetection(videoTrack);
 * 
 * useEffect(() => {
 *   enable();
 *   return () => disable();
 * }, []);
 * 
 * if (detectionResult) {
 *   console.log(`Detected ${detectionResult.faces.length} faces`);
 * }
 * ```
 */
export function useFaceDetection(
    track: MediaStreamTrack | null,
    config?: FaceDetectionConfig
) {
    const [detectionResult, setDetectionResult] = useState<FaceDetectionResult | null>(null);
    const [isEnabled, setIsEnabled] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    // Enable face detection
    const enable = useCallback(async () => {
        if (!track) {
            setError(new Error('No track provided'));
            return;
        }

        if (track.kind !== 'video') {
            setError(new Error('Face detection is only available for video tracks'));
            return;
        }

        try {
            await track.enableFaceDetection(config);
            setIsEnabled(true);
            setError(null);
        } catch (err) {
            setError(err as Error);
            setIsEnabled(false);
        }
    }, [track, config]);

    // Disable face detection
    const disable = useCallback(async () => {
        if (!track) {
            return;
        }

        try {
            await track.disableFaceDetection();
            setIsEnabled(false);
            setDetectionResult(null);
            setError(null);
        } catch (err) {
            setError(err as Error);
        }
    }, [track]);

    // Listen for face detection events
    useEffect(() => {
        if (!track || !isEnabled) {
            return;
        }

        const subscription = eventEmitter.addListener(
            'faceDetected',
            (result: FaceDetectionResult) => {
                setDetectionResult(result);
            }
        );

        return () => {
            subscription.remove();
        };
    }, [track, isEnabled]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (isEnabled) {
                disable();
            }
        };
    }, [isEnabled, disable]);

    return {
        /**
         * The latest face detection result
         */
        detectionResult,
        
        /**
         * Whether face detection is currently enabled
         */
        isEnabled,
        
        /**
         * Enable face detection
         */
        enable,
        
        /**
         * Disable face detection
         */
        disable,
        
        /**
         * Any error that occurred
         */
        error,
    };
}

