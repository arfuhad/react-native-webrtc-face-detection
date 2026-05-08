# Image Adjustment Guide

React Native WebRTC includes real-time image adjustment capabilities for video tracks, allowing you to control exposure, contrast, saturation, and color temperature directly on the camera feed. All processing is done on-device using efficient I420 (YUV) pixel manipulation with pre-computed lookup tables.

## Table of Contents

- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Skin Smoothing](#skin-smoothing)
- [API Reference](#api-reference)
- [React Hooks](#react-hooks)
- [Examples](#examples)
- [Performance](#performance)
- [Using with Face Detection](#using-with-face-detection)
- [Standalone Camera Viewer](#standalone-camera-viewer)
- [Troubleshooting](#troubleshooting)

## Getting Started

### 1. Basic Usage with Hooks

The simplest way to use image adjustment is with the `useImageAdjustment` hook:

```javascript
import { useState, useEffect } from 'react';
import { View, Slider } from 'react-native';
import { mediaDevices, RTCView, useImageAdjustment } from 'react-native-webrtc-face-detection';

function CameraWithAdjustments() {
  const [stream, setStream] = useState(null);
  const videoTrack = stream?.getVideoTracks()[0] ?? null;

  const {
    config,
    isEnabled,
    enable,
    disable,
    setExposure,
    setContrast,
    setSaturation,
    setColorTemperature,
  } = useImageAdjustment(videoTrack);

  useEffect(() => {
    mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      .then(setStream);
    return () => stream?.release();
  }, []);

  useEffect(() => {
    if (videoTrack) {
      enable();
      return () => disable();
    }
  }, [videoTrack]);

  return (
    <View>
      {stream && <RTCView streamURL={stream.toURL()} style={{ flex: 1 }} mirror={true} />}
      <Slider value={config.exposure} onValueChange={setExposure} minimumValue={-1} maximumValue={1} />
      <Slider value={config.contrast} onValueChange={setContrast} minimumValue={0} maximumValue={3} />
      <Slider value={config.saturation} onValueChange={setSaturation} minimumValue={0} maximumValue={3} />
      <Slider value={config.colorTemperature} onValueChange={setColorTemperature} minimumValue={-1} maximumValue={1} />
    </View>
  );
}
```

### 2. Direct API Usage

You can also use the MediaStreamTrack methods directly:

```javascript
const track = stream.getVideoTracks()[0];

// Enable with initial config
await track.enableImageAdjustment({
  exposure: 0.2,
  contrast: 1.3,
  saturation: 1.1,
  colorTemperature: 0.1,
});

// Update settings later
await track.updateImageAdjustment({
  exposure: 0.5,
  contrast: 1.0,
});

// Disable
await track.disableImageAdjustment();
```

## Configuration

### ImageAdjustmentConfig

| Property | Type | Range | Default | Description |
|----------|------|-------|---------|-------------|
| `exposure` | number | -1.0 to 1.0 | 0.0 | Brightness adjustment. Negative darkens, positive brightens. |
| `contrast` | number | 0.0 to 3.0 | 1.0 | Contrast adjustment. Below 1.0 reduces, above 1.0 increases. |
| `saturation` | number | 0.0 to 3.0 | 1.0 | Color intensity. 0.0 is grayscale, above 1.0 is vivid. |
| `colorTemperature` | number | -1.0 to 1.0 | 0.0 | Color cast. Negative is cooler (blue), positive is warmer (orange). |

All fields are optional. Omitted fields use their default values.

## Skin Smoothing

Edge-preserving bilateral smoothing applied to the luminance (Y) plane, with optional chroma (U/V) smoothing. Smooths skin texture and hides blemishes while preserving high-contrast edges (eyes, lips, hair, glasses).

### How It Works

A bilateral filter considers both spatial distance and luminance similarity when blending pixels. Neighbors that are far away or have very different luminance contribute less, preserving sharp edges while smoothing low-contrast skin texture.

**Multi-pass iteration**: Running the bilateral kernel multiple times compounds the smoothing effect. Each iteration runs a horizontal + vertical pass. More iterations = stronger smoothing while edges stay sharp at each step.

**Chroma smoothing**: A 3x3 box blur on U/V planes reduces skin discoloration (redness, dark spots). Very cheap at ~0.05ms/frame since chroma is quarter-resolution.

### Skin Smoothing Configuration

| Property | Type | Range | Default | Description |
|----------|------|-------|---------|-------------|
| `smoothing.enabled` | boolean | - | `false` | Gate the smoothing stage |
| `smoothing.distanceNormalization` | number | 1.0–8.0 | `3.0` | Range-similarity divisor. Larger = stronger smoothing, fewer edges preserved |
| `smoothing.texelSpacing` | number | 1.0–4.0 | `2.0` | Spatial sampling step. Larger = wider blur kernel |
| `smoothing.iterations` | number | 1–8 | `3` | Number of full bilateral passes. Primary control for smoothing strength |
| `smoothing.smoothChroma` | boolean | - | `true` | Apply 3x3 box blur on U/V planes to reduce skin discoloration |
| `smoothing.skinMask` | object | - | - | Skin mask config (requires face detection) |

### Beauty Presets

```typescript
const BEAUTY_PRESETS = {
  subtle: {
    smoothing: { enabled: true, distanceNormalization: 3.5, texelSpacing: 2, iterations: 2, smoothChroma: true },
  },
  medium: {
    smoothing: { enabled: true, distanceNormalization: 3, texelSpacing: 2.5, iterations: 3, smoothChroma: true },
  },
  strong: {
    smoothing: { enabled: true, distanceNormalization: 2.5, texelSpacing: 3, iterations: 4, smoothChroma: true },
  },
};
```

### Performance Tradeoffs

| Iterations | Quality | 720p (ms/frame) | 1080p (ms/frame) |
|-----------|---------|-----------------|-------------------|
| 1 | Barely visible | ~1 | ~3 |
| 2 | Subtle | ~2 | ~6 |
| **3 (default)** | **Noticeable** | **~3** | **~9** |
| 4 | Strong | ~4 | ~12 |
| 6 | Flawless | ~6 | ~18 |
| 8 | Maximum | ~8 | ~24 |

At 30fps the frame budget is ~33ms. Reduce iterations or resolution on lower-end devices.

## API Reference

### MediaStreamTrack Methods

#### `enableImageAdjustment(config?)`

Enable image adjustment on a video track.

```javascript
await videoTrack.enableImageAdjustment({
  exposure: 0.3,
  contrast: 1.2,
});
```

**Parameters:**
- `config` (optional): `Partial<ImageAdjustmentConfig>` - Initial adjustment values

**Returns:** `Promise<void>`

**Throws:** Error if track is not a local video track

#### `updateImageAdjustment(config)`

Update adjustment values without re-enabling. Must be called after `enableImageAdjustment`.

```javascript
await videoTrack.updateImageAdjustment({
  saturation: 0.5,
  colorTemperature: -0.3,
});
```

**Parameters:**
- `config`: `Partial<ImageAdjustmentConfig>` - Values to update

**Returns:** `Promise<void>`

**Throws:** Error if image adjustment is not enabled

#### `disableImageAdjustment()`

Disable image adjustment and reset to defaults.

```javascript
await videoTrack.disableImageAdjustment();
```

**Returns:** `Promise<void>`

#### `isImageAdjustmentEnabled`

Check if image adjustment is currently enabled.

```javascript
if (videoTrack.isImageAdjustmentEnabled) {
  console.log('Image adjustment is active');
}
```

**Returns:** `boolean`

## React Hooks

### useImageAdjustment

```javascript
const {
  config,             // Current ImageAdjustmentConfig state
  isEnabled,          // Whether adjustment is active
  enable,             // Enable with current config
  disable,            // Disable and reset
  updateConfig,       // Update multiple values at once
  setExposure,        // Set exposure value
  setContrast,        // Set contrast value
  setSaturation,      // Set saturation value
  setColorTemperature,// Set color temperature value
  error,              // Any error that occurred
} = useImageAdjustment(videoTrack, initialConfig?);
```

**Parameters:**
- `videoTrack`: `MediaStreamTrack | null` - The video track to adjust
- `initialConfig` (optional): `Partial<ImageAdjustmentConfig>` - Initial config values

The hook automatically cleans up on unmount.

## Examples

### Standalone Camera Viewer with Custom Settings

No WebRTC peer connection needed - just camera preview with adjustments:

```javascript
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';
import {
  mediaDevices,
  RTCView,
  MediaStream,
  useImageAdjustment,
} from 'react-native-webrtc-face-detection';

function StandaloneCameraViewer() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoTrack = stream?.getVideoTracks()[0] ?? null;

  const {
    config,
    isEnabled,
    enable,
    disable,
    setExposure,
    setContrast,
    setSaturation,
    setColorTemperature,
  } = useImageAdjustment(videoTrack, {
    exposure: 0,
    contrast: 1,
    saturation: 1,
    colorTemperature: 0,
  });

  useEffect(() => {
    const startCamera = async () => {
      const s = await mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
      setStream(s);
    };
    startCamera();
    return () => stream?.release();
  }, []);

  useEffect(() => {
    if (videoTrack) enable();
    return () => { disable(); };
  }, [videoTrack]);

  return (
    <View style={styles.container}>
      {stream && (
        <RTCView
          streamURL={stream.toURL()}
          style={styles.video}
          objectFit="cover"
          mirror={true}
        />
      )}

      <View style={styles.controls}>
        <Text>Exposure: {config.exposure.toFixed(2)}</Text>
        <Slider
          value={config.exposure}
          onValueChange={setExposure}
          minimumValue={-1}
          maximumValue={1}
          step={0.05}
        />

        <Text>Contrast: {config.contrast.toFixed(2)}</Text>
        <Slider
          value={config.contrast}
          onValueChange={setContrast}
          minimumValue={0}
          maximumValue={3}
          step={0.05}
        />

        <Text>Saturation: {config.saturation.toFixed(2)}</Text>
        <Slider
          value={config.saturation}
          onValueChange={setSaturation}
          minimumValue={0}
          maximumValue={3}
          step={0.05}
        />

        <Text>Color Temperature: {config.colorTemperature.toFixed(2)}</Text>
        <Slider
          value={config.colorTemperature}
          onValueChange={setColorTemperature}
          minimumValue={-1}
          maximumValue={1}
          step={0.05}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  video: { flex: 1 },
  controls: { padding: 16, backgroundColor: '#000' },
});
```

### Preset-Based Adjustments

```javascript
const presets = {
  normal: { exposure: 0, contrast: 1, saturation: 1, colorTemperature: 0 },
  warm: { exposure: 0.1, contrast: 1.1, saturation: 1.2, colorTemperature: 0.4 },
  cool: { exposure: 0, contrast: 1.1, saturation: 0.9, colorTemperature: -0.3 },
  vivid: { exposure: 0.1, contrast: 1.4, saturation: 1.8, colorTemperature: 0.1 },
  noir: { exposure: -0.1, contrast: 1.6, saturation: 0, colorTemperature: 0 },
  bright: { exposure: 0.4, contrast: 0.9, saturation: 1.1, colorTemperature: 0.1 },
};

// Apply a preset
const { updateConfig } = useImageAdjustment(videoTrack);
updateConfig(presets.warm);
```

## Performance

### How It Works

Image adjustment processes every video frame using pre-computed lookup tables (LUTs):

1. **LUT Generation**: When you change config values, three 256-byte lookup tables are computed (one each for Y, U, V channels)
2. **Per-Frame Processing**: Each frame's I420 buffer is transformed using simple array lookups - no floating-point math per pixel
3. **Short-Circuit**: When all values are at defaults, the original frame is returned untouched with zero overhead

### Performance Characteristics

| Resolution | Pixels/Frame | Typical Processing Time |
|-----------|-------------|------------------------|
| 480p (640x480) | 460,800 | < 1ms |
| 720p (1280x720) | 1,382,400 | ~1-2ms |
| 1080p (1920x1080) | 3,110,400 | ~3-5ms |

At 30fps with 720p, image adjustment adds roughly 1-2ms per frame - well within the 33ms frame budget.

**With skin smoothing enabled** (4 iterations), add ~4ms at 720p or ~12ms at 1080p. Chroma smoothing adds ~0.05ms. See [Performance Tradeoffs](#performance-tradeoffs) for details.

### Best Practices

1. **Disable when not needed**: Call `disableImageAdjustment()` when the user isn't actively adjusting
2. **Debounce slider updates**: When using sliders, consider debouncing `updateImageAdjustment` calls to avoid overwhelming the bridge
3. **Use defaults short-circuit**: If all values are at defaults, the processor returns the original frame with no processing overhead

## Using with Face Detection

Image adjustment and face detection can run simultaneously. The effects are chained in the video processor pipeline:

```javascript
import {
  useFaceDetection,
  useImageAdjustment,
} from 'react-native-webrtc-face-detection';

function CameraWithBoth() {
  const videoTrack = stream?.getVideoTracks()[0] ?? null;

  // Both hooks can be active on the same track
  const faceDetection = useFaceDetection(videoTrack);
  const imageAdjustment = useImageAdjustment(videoTrack);

  useEffect(() => {
    if (videoTrack) {
      faceDetection.enable();
      imageAdjustment.enable();
    }
    return () => {
      faceDetection.disable();
      imageAdjustment.disable();
    };
  }, [videoTrack]);

  // Both work independently - enabling/disabling one doesn't affect the other
}
```

The active effects are tracked internally, so disabling one effect won't remove the other.

## Standalone Camera Viewer

This library can be used as a standalone camera viewer without any WebRTC peer connections. Just use `getUserMedia` + `RTCView`:

```javascript
// No RTCPeerConnection needed!
const stream = await mediaDevices.getUserMedia({ video: true });

// Display camera feed
<RTCView streamURL={stream.toURL()} style={{ flex: 1 }} />

// Apply adjustments
const track = stream.getVideoTracks()[0];
await track.enableImageAdjustment({ exposure: 0.3, contrast: 1.2 });

// Switch cameras
await track.applyConstraints({ facingMode: 'environment' });

// Change resolution
await track.applyConstraints({ width: 1920, height: 1080 });
```

## Troubleshooting

### Adjustments Not Visible

**Problem**: `enableImageAdjustment()` resolves but no visual change

**Possible causes:**
1. All values are at defaults (short-circuit optimization)
2. Track is a remote track (not supported)

**Solutions:**
- Set non-default values: `{ exposure: 0.3, contrast: 1.5 }`
- Verify the track is local: `track.remote === false`

### Performance Issues

**Problem**: Frame rate drops when adjustment is enabled

**Solutions:**
- Lower camera resolution: `{ width: 640, height: 480 }`
- Reduce frame rate: `{ frameRate: 15 }`
- Disable when not actively adjusting
- Reduce smoothing iterations: `{ iterations: 2 }`
- Disable chroma smoothing: `{ smoothChroma: false }`

### Smoothing Not Visible

**Problem**: Skin smoothing enabled but no visible effect

**Possible causes:**
1. Only 1 iteration (very subtle)
2. Face detection not enabled (skin mask requires a detected face)
3. `distanceNormalization` too low (below 3 preserves too many edges)

**Solutions:**
- Increase iterations to 3-4
- Enable face detection on the same track
- Increase `distanceNormalization` to 5-6

### Smoothing Looks Artificial

**Problem**: Skin looks too smooth or plasticky

**Solutions:**
- Reduce iterations to 2-3
- Increase `distanceNormalization` to 5-6 to preserve more edges
- Reduce `texelSpacing` to 1.5-2 to narrow the kernel

### Cannot Enable on Remote Track

**Problem**: `enableImageAdjustment()` throws "not supported for remote tracks"

**Explanation**: Image adjustment operates on the video capture pipeline before encoding. Remote tracks have already been decoded and cannot be modified in this way.

### Values Out of Range

The processor clamps all values to valid pixel ranges (0-255), so out-of-range config values won't crash but may produce unexpected results. Stick to the documented ranges:
- `exposure`: -1.0 to 1.0
- `contrast`: 0.0 to 3.0
- `saturation`: 0.0 to 3.0
- `colorTemperature`: -1.0 to 1.0

## Additional Resources

- [Face Detection Guide](./FaceDetection.md)
- [Basic Usage Guide](./BasicUsage.md)
- [Example App](../examples/ExpoTestApp/)
contrast`: 0.0 to 3.0
- `saturation`: 0.0 to 3.0
- `colorTemperature`: -1.0 to 1.0

## Additional Resources

- [Face Detection Guide](./FaceDetection.md)
- [Basic Usage Guide](./BasicUsage.md)
- [Example App](../examples/ExpoTestApp/)
