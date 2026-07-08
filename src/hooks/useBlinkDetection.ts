import { useState, useEffect, useCallback, useRef } from 'react';
import { NativeModules, NativeEventEmitter } from 'react-native';

import { BlinkEvent, FaceDetectionConfig } from '../FaceDetection.types';
import MediaStreamTrack from '../MediaStreamTrack';

const { WebRTCModule } = NativeModules;
const eventEmitter = new NativeEventEmitter(WebRTCModule);

/**
 * React hook for blink detection on a video track
 *
 * @param track The video track to perform blink detection on
 * @param config Optional configuration for face detection (required for blink detection)
 * @param onBlink Optional callback invoked for each blink event (includes faceImage if captureOnBlink enabled)
 * @returns Object with blink tracking data and control functions
 *
 * @remarks
 * Pass a stable `config` reference (module constant or `useMemo`) rather than an
 * inline object literal — it is a dependency of the `enable` callback, so a new
 * object each render changes `enable`'s identity and can cause enable/disable
 * churn if used in an effect dependency array. `onBlink` is safe to pass inline
 * (it is captured via a ref).
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
    config?: FaceDetectionConfig,
    onBlink?: (event: BlinkEvent) => void
) {
    const [ blinkCount, setBlinkCount ] = useState(0);
    const [ lastBlinkTime, setLastBlinkTime ] = useState<number | null>(null);
    const [ isEnabled, setIsEnabled ] = useState(false);
    const [ error, setError ] = useState<Error | null>(null);
    const [ recentBlinks, setRecentBlinks ] = useState<BlinkEvent[]>([]);
    const [ isCalibrating, setIsCalibrating ] = useState(false);
    const onBlinkRef = useRef(onBlink);

    onBlinkRef.current = onBlink;

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

            if (config?.adaptiveThreshold) {
                setIsCalibrating(true);
                // Auto-clear calibrating state after calibration duration
                const duration = config?.calibrationDurationMs ?? 3000;

                setTimeout(() => setIsCalibrating(false), duration);
            }
        } catch (err) {
            setError(err as Error);
            setIsEnabled(false);
        }
    }, [ track, config ]);

    // Disable blink detection
    const disable = useCallback(async () => {
        if (!track) {
            return;
        }

        try {
            await track.disableFaceDetection();
            setIsEnabled(false);
            setIsCalibrating(false);
            setError(null);
        } catch (err) {
            setError(err as Error);
        }
    }, [ track ]);

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

                // Strip faceImage from stored events to reduce memory pressure (Phase 1.5)
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { faceImage, ...blinkWithoutImage } = event;

                setRecentBlinks(prev => {
                    const updated = [ ...prev, blinkWithoutImage ];

                    // Keep only last 10 blinks
                    return updated.slice(-10);
                });

                // Pass full event (including image) to callback
                if (onBlinkRef.current) {
                    onBlinkRef.current(event);
                }
            }
        );

        return () => {
            subscription.remove();
        };
    }, [ track, isEnabled ]);

    // Cleanup on unmount
    useEffect(() => () => {
        if (isEnabled) {
            disable();
        }
    }, [ isEnabled, disable ]);

    // Calculate blink rate (blinks per minute) - fixed N-1 intervals (Phase 2.4)
    const getBlinkRate = useCallback((): number => {
        if (recentBlinks.length < 2) {
            return 0;
        }

        const timeSpan = recentBlinks[recentBlinks.length - 1].timestamp - recentBlinks[0].timestamp;

        // Need at least 1 second of data for a meaningful rate
        if (timeSpan < 1000) {
            return 0;
        }

        const minutes = timeSpan / 60000; // Convert milliseconds to minutes

        return (recentBlinks.length - 1) / minutes;
    }, [ recentBlinks ]);

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
         * Recent blink events (last 10, without faceImage to save memory)
         */
        recentBlinks,

        /**
         * Whether blink detection is currently enabled
         */
        isEnabled,

        /**
         * Whether adaptive threshold calibration is in progress
         */
        isCalibrating,

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
