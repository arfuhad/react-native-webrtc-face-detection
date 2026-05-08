/**
 * Skin-targeted masking configuration for bilateral smoothing. When present
 * on the parent smoothing config, the smoothing pass is restricted to a
 * feathered skin mask derived from ML Kit face detection (bbox + eye/mouth
 * landmarks). Requires `faceDetection` to be enabled on the same track;
 * without a detected face the smoothing pass no-ops rather than falling
 * back to whole-frame smoothing.
 */
export interface ImageAdjustmentSkinMaskConfig {
    /**
     * Feather radius in pixels along the mask edge. 0 = auto (derived from face height).
     * Default: 0 (auto).
     */
    feather?: number;
    /**
     * Preserve detail around the eyes (no smoothing in eye region). Default: true.
     */
    eyeProtect?: boolean;
    /**
     * Preserve detail around the mouth / lips. Default: true.
     */
    mouthProtect?: boolean;
}

/**
 * Edge-preserving bilateral smoothing applied to the luminance (Y) plane
 * before tone-mapping. Intended for skin softening without blurring
 * high-contrast edges (eyelashes, glasses frames, face silhouettes).
 *
 * Runs as a native shader pass (Metal on iOS, OpenGL ES on Android).
 * Face detection runs on raw pre-smoothing pixels, so landmarks and
 * blink detection are unaffected by this stage.
 */
export interface ImageAdjustmentSmoothingConfig {
    /**
     * Gate the smoothing stage. When false, the stage is skipped entirely
     * and produces a zero-overhead pass-through.
     */
    enabled: boolean;

    /**
     * Range-similarity divisor. Larger values widen the tolerance for
     * luminance difference, producing stronger smoothing with less edge
     * preservation. Smaller values preserve more edges.
     * Range: 1.0 to 8.0. Default: 3.0.
     */
    distanceNormalization: number;

    /**
     * Spatial sampling step in texels. Effectively widens the blur kernel
     * without increasing tap count. Larger values produce a softer look.
     * Range: 1.0 to 4.0. Default: 2.0.
     */
    texelSpacing: number;

    /**
     * Number of full bilateral passes (horizontal + vertical each).
     * More iterations compound the smoothing effect while preserving
     * edges at each step. This is the primary control for smoothing strength.
     * Range: 1 to 8. Default: 4.
     *
     * Performance: each iteration adds ~1ms at 720p, ~3ms at 1080p.
     * Use 2-3 on low-end devices or 1080p video; 4-6 for strong smoothing.
     */
    iterations?: number;

    /**
     * Texture preservation (Mix). Blends a percentage of the original
     * luminance back into the smoothed result to maintain natural skin
     * texture and prevent a "plastic" look.
     * Range: 0.0 (full smooth) to 1.0 (no smooth). Default: 0.0.
     */
    mix?: number;

    /**
     * Targeted skin brightening. Applies a brightness gain specifically
     * to pixels within the skin mask. Creates a "glow" effect.
     * Range: 0.0 to 1.0. Default: 0.0.
     */
    skinBrightness?: number;

    /**
     * Apply mild chroma (U/V plane) smoothing to reduce skin discoloration.
     * Uses a CPU-based 3x3 box blur on the half-resolution chroma planes.
     * Very cheap (~0.05ms at 720p). Default: true.
     */
    smoothChroma?: boolean;

    /**
     * Skin mask configuration. Requires `faceDetection` to be enabled on the same track,
     * otherwise smoothing no-ops (it will NOT fall back to whole-frame smoothing).
     */
    skinMask?: ImageAdjustmentSkinMaskConfig;
}

/**
 * Configuration options for image adjustment processing
 */
export interface ImageAdjustmentConfig {
    /**
     * Exposure adjustment applied to the luminance (Y) plane.
     * Range: -1.0 to 1.0, where 0.0 is no change.
     * Negative values darken the image, positive values brighten it.
     * @default 0.0
     */
    exposure?: number;

    /**
     * Contrast adjustment applied to the luminance (Y) plane.
     * Range: 0.0 to 3.0, where 1.0 is no change.
     * Values below 1.0 reduce contrast, above 1.0 increase it.
     * @default 1.0
     */
    contrast?: number;

    /**
     * Saturation adjustment applied to the chrominance (U/V) planes.
     * Range: 0.0 to 3.0, where 1.0 is no change.
     * 0.0 produces a grayscale image, values above 1.0 increase color intensity.
     * @default 1.0
     */
    saturation?: number;

    /**
     * Color temperature adjustment applied to the chrominance (U/V) planes.
     * Range: -1.0 to 1.0, where 0.0 is no change.
     * Negative values shift toward cooler (blue) tones,
     * positive values shift toward warmer (yellow/orange) tones.
     * @default 0.0
     */
    colorTemperature?: number;

    /**
     * Optional edge-preserving skin smoothing pass applied to the Y plane
     * before tone-mapping. Omit or set `enabled: false` for zero overhead.
     */
    smoothing?: ImageAdjustmentSmoothingConfig;
}
