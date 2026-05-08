# Multi-pass Bilateral Skin Smoothing

## Overview

The bilateral smoothing system uses an edge-preserving bilateral filter to smooth skin while preserving high-contrast edges (eyes, lips, hair, glasses). The filter runs as a GPU compute pass on the Y (luminance) plane, with optional CPU-based chroma (U/V) smoothing to also reduce skin discoloration.

The key to effective skin smoothing is **multi-pass iteration** — running the bilateral kernel multiple times compounds the smoothing effect while preserving edges at each step. To achieve a **flawless Jeeliz-style look**, we combine multi-pass smoothing with **texture preservation (mix)** and **targeted skin brightening**.

## Configuration

```typescript
interface ImageAdjustmentSmoothingConfig {
    enabled: boolean;
    distanceNormalization: number;  // 2.5–8.0, edge preservation
    texelSpacing: number;           // 1.0–4.0, kernel spatial width
    iterations: number;             // 1–8, default 4, smoothing strength
    mix: number;                    // 0.0-1.0, texture preservation (0 = full smooth, 1 = original)
    skinBrightness: number;         // 0.0-1.0, targeted brightening within mask
    smoothChroma: boolean;          // default true, U/V plane smoothing
    skinMask?: ImageAdjustmentSkinMaskConfig;
}
```

### Parameters

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| `enabled` | boolean | `false` | Gate the smoothing stage |
| `distanceNormalization` | 1.0–8.0 | `3.0` | Range-similarity divisor. Larger = wider tolerance = stronger smoothing |
| `texelSpacing` | 1.0–4.0 | `2.0` | Spatial sampling step in texels. Larger = wider blur kernel |
| `iterations` | 1–8 | `4` | Number of full bilateral passes. Primary smoothing strength |
| `mix` | 0.0–1.0 | `0.0` | **Texture Preservation**. Blends original skin texture back in. 0.2-0.3 is recommended to avoid "plastic" skin. |
| `skinBrightness` | 0.0–1.0 | `0.0` | **Flawless Glow**. Targeted brightening of the skin region within the mask. |
| `smoothChroma` | boolean | `true` | Apply 3x3 box blur on U/V planes to reduce skin discoloration |

### Beauty Presets

```typescript
const BEAUTY_PRESETS = [
  {
    name: 'Beauty Off',
    smoothing: { enabled: false, distanceNormalization: 8, texelSpacing: 1, iterations: 4, mix: 0, skinBrightness: 0, smoothChroma: true },
  },
  {
    name: 'Subtle',
    smoothing: { enabled: true, distanceNormalization: 3.5, texelSpacing: 2, iterations: 2, mix: 0.3, skinBrightness: 0.05, smoothChroma: true },
  },
  {
    name: 'Medium',
    smoothing: { enabled: true, distanceNormalization: 3, texelSpacing: 2.5, iterations: 4, mix: 0.2, skinBrightness: 0.1, smoothChroma: true },
  },
  {
    name: 'Flawless', // Jeeliz-style
    smoothing: { enabled: true, distanceNormalization: 2.5, texelSpacing: 3, iterations: 6, mix: 0.15, skinBrightness: 0.2, smoothChroma: true },
  },
  {
    name: 'Porcelain',
    smoothing: { enabled: true, distanceNormalization: 2, texelSpacing: 3.5, iterations: 8, mix: 0.1, skinBrightness: 0.25, smoothChroma: true },
  },
];
```

## How It Works

### Texture Preservation (Mix)
Pure bilateral smoothing can sometimes look "too perfect" or plastic. By using the `mix` parameter, we blend a small percentage of the original luminance back into the smoothed result. This restores fine, natural skin pores while the underlying blemishes remain hidden by the multi-pass blur.

### Targeted Skin Brightening
Flawless skin often appears slightly more luminous. The `skinBrightness` parameter applies a targeted gain only to the pixels identified by the skin mask. This creates a "glow" effect without overexposing the entire scene.

### Multi-pass Iteration
Running the bilateral filter multiple times compounds the effect. For a truly blemish-free look, **6-8 iterations** are recommended on high-end devices.

## Performance Tradeoffs

Each iteration adds GPU overhead. 

| Iterations | Quality | 720p (ms) | 1080p (ms) | Notes |
|-----------|---------|-----------|------------|-------|
| 4 | Standard | ~4 | ~12 | Good balance |
| 6 | Flawless | ~6 | ~18 | High-end look |
| 8 | Maximum | ~8 | ~24 | Heavy load |
