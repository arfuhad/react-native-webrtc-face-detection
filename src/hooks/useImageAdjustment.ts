// Skin-mask smoothing requires `faceDetection` enabled on the same track; otherwise smoothing no-ops.
import { useState, useEffect, useCallback, useRef } from 'react';

import {
    ImageAdjustmentConfig,
    ImageAdjustmentSkinMaskConfig,
    ImageAdjustmentSmoothingConfig,
} from '../ImageAdjustment.types';
import MediaStreamTrack from '../MediaStreamTrack';

const DEFAULT_CONFIG: Required<ImageAdjustmentConfig> = {
    exposure: 0,
    contrast: 1,
    saturation: 1,
    colorTemperature: 0,
    smoothing: {
        enabled: false,
        distanceNormalization: 3,
        texelSpacing: 2,
        iterations: 3,
        mix: 0,
        skinBrightness: 0,
        smoothChroma: true,
        skinMask: {
            feather: 0,
            eyeProtect: true,
            mouthProtect: true,
        },
    },
};

/**
 * React hook for image adjustment on a video track
 *
 * @param track The video track to apply image adjustments to
 * @param initialConfig Optional initial configuration
 * @returns Object with config state and control functions
 *
 * @example
 * ```tsx
 * const videoTrack = stream.getVideoTracks()[0];
 * const { isEnabled, enable, disable, setExposure, setContrast } = useImageAdjustment(videoTrack);
 *
 * useEffect(() => {
 *   enable();
 *   return () => disable();
 * }, []);
 *
 * // Adjust exposure with a slider
 * <Slider value={config.exposure} onValueChange={setExposure} minimumValue={-1} maximumValue={1} />
 * ```
 */
export function useImageAdjustment(
    track: MediaStreamTrack | null,
    initialConfig?: Partial<ImageAdjustmentConfig>
) {
    const [ config, setConfig ] = useState<Required<ImageAdjustmentConfig>>({
        ...DEFAULT_CONFIG,
        ...initialConfig,
    });
    const [ isEnabled, setIsEnabled ] = useState(false);
    const [ error, setError ] = useState<Error | null>(null);
    const configRef = useRef(config);

    configRef.current = config;

    const enable = useCallback(async () => {
        if (!track) {
            setError(new Error('No track provided'));

            return;
        }

        if (track.kind !== 'video') {
            setError(new Error('Image adjustment is only available for video tracks'));

            return;
        }

        try {
            await track.enableImageAdjustment(configRef.current);
            setIsEnabled(true);
            setError(null);
        } catch (err) {
            setError(err as Error);
            setIsEnabled(false);
        }
    }, [ track ]);

    const disable = useCallback(async () => {
        if (!track) {
            return;
        }

        try {
            await track.disableImageAdjustment();
            setIsEnabled(false);
            setError(null);
        } catch (err) {
            setError(err as Error);
        }
    }, [ track ]);

    const updateConfig = useCallback(async (changes: Partial<ImageAdjustmentConfig>) => {
        const newConfig = { ...configRef.current, ...changes };

        setConfig(newConfig);

        if (!track || !isEnabled) {
            return;
        }

        try {
            await track.updateImageAdjustment(newConfig);
            setError(null);
        } catch (err) {
            setError(err as Error);
        }
    }, [ track, isEnabled ]);

    const setExposure = useCallback((value: number) => {
        updateConfig({ exposure: value });
    }, [ updateConfig ]);

    const setContrast = useCallback((value: number) => {
        updateConfig({ contrast: value });
    }, [ updateConfig ]);

    const setSaturation = useCallback((value: number) => {
        updateConfig({ saturation: value });
    }, [ updateConfig ]);

    const setColorTemperature = useCallback((value: number) => {
        updateConfig({ colorTemperature: value });
    }, [ updateConfig ]);

    const setSmoothing = useCallback((value: Partial<ImageAdjustmentSmoothingConfig>) => {
        const merged: ImageAdjustmentSmoothingConfig = {
            ...configRef.current.smoothing,
            ...value,
        };

        updateConfig({ smoothing: merged });
    }, [ updateConfig ]);

    const setSkinMask = useCallback((partial: Partial<ImageAdjustmentSkinMaskConfig>) => {
        const currentSmoothing = configRef.current.smoothing;
        const mergedSkinMask: ImageAdjustmentSkinMaskConfig = {
            ...currentSmoothing.skinMask,
            ...partial,
        };
        const merged: ImageAdjustmentSmoothingConfig = {
            ...currentSmoothing,
            skinMask: mergedSkinMask,
        };

        updateConfig({ smoothing: merged });
    }, [ updateConfig ]);

    const setBypass = useCallback(async (bypass: boolean) => {
        if (!track) {
            return;
        }

        try {
            await track.bypassImageAdjustment(bypass);
        } catch (err) {
            setError(err as Error);
        }
    }, [ track ]);

    // Cleanup on unmount
    useEffect(() => () => {
        if (isEnabled) {
            disable();
        }
    }, [ isEnabled, disable ]);

    return {
        /**
         * Current image adjustment configuration
         */
        config,

        /**
         * Whether image adjustment is currently enabled
         */
        isEnabled,

        /**
         * Enable image adjustment with current config
         */
        enable,

        /**
         * Disable image adjustment
         */
        disable,

        /**
         * Update multiple config values at once
         */
        updateConfig,

        /**
         * Set exposure (-1.0 to 1.0)
         */
        setExposure,

        /**
         * Set contrast (0.0 to 3.0)
         */
        setContrast,

        /**
         * Set saturation (0.0 to 3.0)
         */
        setSaturation,

        /**
         * Set color temperature (-1.0 to 1.0)
         */
        setColorTemperature,

        /**
         * Set bilateral skin smoothing. Pass a partial config; unspecified
         * fields are preserved from the current smoothing state.
         *
         * Ranges: distanceNormalization 2.5–8.0, texelSpacing 1.0–4.0.
         */
        setSmoothing,

        /**
         * Set skin mask options for smoothing. Merges the provided partial
         * into the existing `smoothing.skinMask`.
         *
         * Requires `faceDetection` enabled on the same track; otherwise
         * smoothing no-ops (no whole-frame fallback).
         */
        setSkinMask,

        /**
         * Bypass image adjustment processing without resetting config.
         * When bypassed, the processor returns the original frame unchanged.
         * Useful for before/after comparison.
         */
        setBypass,

        /**
         * Any error that occurred
         */
        error,
    };
}
