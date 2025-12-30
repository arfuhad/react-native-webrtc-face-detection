import { useState, useEffect, useCallback } from 'react';
import { NativeModules, NativeEventEmitter } from 'react-native';
import MediaStreamTrack from '../MediaStreamTrack';
import { BlinkEvent, FaceDetectionConfig } from '../FaceDetection.types';

const { WebRTCModule } = NativeModules;
const eventEmitter = new NativeEventEmitter(WebRTCModule);

/**
 * React hook for blink detection on a video track
 * 
 * @param track The video track to perform blink detection on
 * @param config Optional configuration for face detection (required for blink detection)
 * @returns Object with blink tracking data and control functions
 * 
 * @example
 * ```tsx
 * const videoTrack = stream.getVideoTracks()[0];
 * const { blinkCount, lastBlinkTime, resetCount, enable, disable } = useBlinkDetection(videoTrack);
 * 
 * useEffect(() => {
 *   enable();
 *   return () => disable();
 * }, []);
 * 
 * console.log(`Total blinks: ${blinkCount}`);
 * ```
 */
export function useBlinkDetection(
    track: MediaStreamTrack | null,
    config?: FaceDetectionConfig
) {
    const [blinkCount, setBlinkCount] = useState(0);
    const [lastBlinkTime, setLastBlinkTime] = useState<number | null>(null);
    const [isEnabled, setIsEnabled] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [recentBlinks, setRecentBlinks] = useState<BlinkEvent[]>([]);

    // Enable blink detection (enables face detection under the hood)
    const enable = useCallback(async () => {
        if (!track) {
            setError(new Error('No track provided'));
            return;
        }

        if (track.kind !== 'video') {
            setError(new Error('Blink detection is only available for video tracks'));
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

    // Disable blink detection
    const disable = useCallback(async () => {
        if (!track) {
            return;
        }

        try {
            await track.disableFaceDetection();
            setIsEnabled(false);
            setError(null);
        } catch (err) {
            setError(err as Error);
        }
    }, [track]);

    // Reset blink count
    const resetCount = useCallback(() => {
        setBlinkCount(0);
        setLastBlinkTime(null);
        setRecentBlinks([]);
    }, []);

    // Listen for blink detection events
    useEffect(() => {
        if (!track || !isEnabled) {
            return;
        }

        const subscription = eventEmitter.addListener(
            'blinkDetected',
            (event: BlinkEvent) => {
                setBlinkCount(prev => prev + 1);
                setLastBlinkTime(event.timestamp);
                setRecentBlinks(prev => {
                    const updated = [...prev, event];
                    // Keep only last 10 blinks
                    return updated.slice(-10);
                });
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

    // Calculate blink rate (blinks per minute)
    const getBlinkRate = useCallback((): number => {
        if (recentBlinks.length < 2) {
            return 0;
        }

        const timeSpan = recentBlinks[recentBlinks.length - 1].timestamp - recentBlinks[0].timestamp;
        const minutes = timeSpan / 60000; // Convert milliseconds to minutes
        
        if (minutes === 0) {
            return 0;
        }

        return recentBlinks.length / minutes;
    }, [recentBlinks]);

    return {
        /**
         * Total number of blinks detected
         */
        blinkCount,
        
        /**
         * Timestamp of the last blink (in milliseconds)
         */
        lastBlinkTime,
        
        /**
         * Recent blink events (last 10)
         */
        recentBlinks,
        
        /**
         * Whether blink detection is currently enabled
         */
        isEnabled,
        
        /**
         * Enable blink detection
         */
        enable,
        
        /**
         * Disable blink detection
         */
        disable,
        
        /**
         * Reset the blink counter
         */
        resetCount,
        
        /**
         * Get the current blink rate (blinks per minute)
         */
        getBlinkRate,
        
        /**
         * Any error that occurred
         */
        error,
    };
}

