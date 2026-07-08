# React Native WebRTC with Face Detection

[![npm version](https://img.shields.io/npm/v/react-native-webrtc-face-detection)](https://www.npmjs.com/package/react-native-webrtc-face-detection)
[![npm downloads](https://img.shields.io/npm/dm/react-native-webrtc-face-detection)](https://www.npmjs.com/package/react-native-webrtc-face-detection)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A powerful WebRTC module for React Native with **real-time face detection**, **eye tracking**, and **blink detection** capabilities. Built on top of the excellent [react-native-webrtc](https://github.com/react-native-webrtc/react-native-webrtc) project with enhanced ML-powered features.

## ✨ New Features

This fork extends the original react-native-webrtc with powerful face detection capabilities:

### 🎯 Real-Time Face Detection
- **High-performance on-device processing** using Google ML Kit
- **Cross-platform consistency**: Same ML Kit engine on both iOS and Android
- Detect multiple faces simultaneously with bounding boxes

### 👁️ Eye Tracking
- Real-time eye position tracking
- Left and right eye detection with precise coordinates
- Eye openness probability for each eye

### 😉 Blink Detection
- **Accurate unified blink events** — natural blinks emit one event (`eye: "both"`), winks emit `"left"`/`"right"`
- **EMA probability smoothing** eliminates false blinks from lighting noise
- **Temporal validation** — rejects single-frame noise (< 50ms) and prolonged closure (> 800ms)
- **Debounce cooldown** prevents rapid-fire false sequences
- **Blink confidence score** (0–1) from probability delta, duration, and eye symmetry
- **Adaptive thresholding** — optional per-user calibration for droopy eyelids, glasses, low light
- `useBlinkDetection` React hook with `onBlink` callback, `isCalibrating` state, and fixed blink rate formula

### 📸 Frame Capture on Blink
- **Automatic frame capture** when blink is detected
- Optional **face cropping** with configurable padding
- Configurable **image quality** and **max dimensions**
- Returns **base64 JPEG** for easy display or upload

### 🎣 React Hooks
- `useFaceDetection` - Easy-to-use hook for face detection
- `useBlinkDetection` - Hook for blink detection with customizable settings

### 📐 Head Pose Estimation
- Yaw, pitch, and roll angles
- Head orientation tracking for advanced use cases

### 🎨 Face Detection Overlay
- **Animated bounding boxes** around face, eyes, and mouth
- Real-time **head pose** and **eye status** labels
- **Fully customizable**: colors, sizes, border radii, shapes
- Coordinate mapping with **mirror** and **objectFit** support

### 🖼️ Image Adjustment (Standalone Camera)
- **Real-time exposure, contrast, saturation, and color temperature** controls
- Works as a **standalone camera viewer** - no WebRTC peer connection needed
- Efficient **LUT-based I420 pixel processing** with zero overhead at defaults
- `useImageAdjustment` React hook with individual setters and presets
- Can run **simultaneously with face detection**

## Feature Overview

|  | Android | iOS | tvOS | macOS* | Expo* |
| :- | :-: | :-: | :-: | :-: | :-: |
| Audio/Video | ✅ | ✅ | ✅ | - | ✅ |
| Data Channels | ✅ | ✅ | - | - | ✅ |
| Screen Capture | ✅ | ✅ | - | - | ✅ |
| **Face Detection** | ✅ | ✅ | - | - | ✅ |
| **Eye Tracking** | ✅ | ✅ | - | - | ✅ |
| **Blink Detection** | ✅ | ✅ | - | - | ✅ |
| **Frame Capture** | ✅ | ✅ | - | - | ✅ |
| **Face Overlay** | ✅ | ✅ | - | - | ✅ |
| **Image Adjustment** | ✅ | ✅ | - | - | ✅ |
| Unified Plan | ✅ | ✅ | - | - | ✅ |
| Simulcast | ✅ | ✅ | - | - | ✅ |

> **Expo** - This module includes native code and requires a development build. Use [expo-dev-client](https://docs.expo.dev/development/getting-started/) for Expo projects.

## WebRTC Revision

* Currently used revision: [M124](https://github.com/jitsi/webrtc/tree/M124)
* Supported architectures
  * Android: armeabi-v7a, arm64-v8a, x86, x86_64
  * iOS: arm64, x86_64
  * tvOS: arm64

## 🚀 Getting Started

### Installation

```bash
# npm
npm install react-native-webrtc-face-detection --save

# yarn
yarn add react-native-webrtc-face-detection

# pnpm
pnpm install react-native-webrtc-face-detection
```

### iOS Setup

```bash
cd ios && pod install
```

### Android Setup

No additional setup required - ML Kit is automatically included.

### Platform Requirements

| Platform | Minimum Version | Notes |
|----------|-----------------|-------|
| iOS | 15.5+ | Required by Google ML Kit |
| Android | API 21+ | Standard React Native requirement |
| macOS | 10.13+ | Limited support |
| tvOS | 16.0+ | Limited support |

> **Note**: Face detection features require iOS 15.5+ due to Google ML Kit dependencies. If your app targets older iOS versions, face detection will not be available on those devices.

## 📖 Usage

### Basic Face Detection

```typescript
import { useFaceDetection, RTCView } from 'react-native-webrtc-face-detection';

function VideoCall() {
  const { faces, isDetecting } = useFaceDetection({
    enabled: true,
    trackId: localStream?.getVideoTracks()[0]?.id,
  });

  return (
    <View>
      <RTCView streamURL={localStream?.toURL()} />
      {faces.map((face, index) => (
        <View key={index}>
          <Text>Face detected at: {JSON.stringify(face.boundingBox)}</Text>
          <Text>Left eye open: {face.leftEyeOpenProbability}</Text>
          <Text>Right eye open: {face.rightEyeOpenProbability}</Text>
        </View>
      ))}
    </View>
  );
}
```

### Blink Detection

```typescript
import { useBlinkDetection } from 'react-native-webrtc-face-detection';

function BlinkTracker() {
  const videoTrack = stream?.getVideoTracks()[0] ?? null;

  const { blinkCount, lastBlinkTime, getBlinkRate, enable, disable } = useBlinkDetection(
    videoTrack,
    {
      minBlinkDurationMs: 50,   // reject noise (< 50ms)
      maxBlinkDurationMs: 800,  // reject prolonged closure
      blinkCooldownMs: 300,     // debounce between blinks
    },
    (event) => {
      // 'both' = natural blink, 'left'/'right' = wink
      console.log(`Blink: eye=${event.eye}, confidence=${event.confidence?.toFixed(2)}`);
    }
  );

  useEffect(() => {
    if (videoTrack) enable();
    return () => { disable(); };
  }, [videoTrack]);

  return (
    <>
      <Text>Blinks: {blinkCount}</Text>
      <Text>Rate: {getBlinkRate().toFixed(1)} BPM</Text>
    </>
  );
}
```

### Face Detection Configuration

```typescript
import { configureWebRTC } from 'react-native-webrtc-face-detection';

// Enable face detection feature (call once at app startup)
configureWebRTC({
  enableFaceDetection: true,
});
```

### Blink Capture (Standalone Camera - No WebRTC)

Use face detection with just the camera, without WebRTC peer connections:

```typescript
import { useState, useEffect } from 'react';
import { View, Text, Image } from 'react-native';
import {
  mediaDevices,
  RTCView,
  MediaStream,
  useBlinkDetection,
  configureWebRTC,
} from 'react-native-webrtc-face-detection';

// Enable face detection (call once at app startup)
configureWebRTC({ enableFaceDetection: true });

function BlinkCaptureCamera() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  const videoTrack = stream?.getVideoTracks()[0] ?? null;

  // Blink detection with frame capture
  // Pass onBlink callback to receive faceImage — images are NOT stored in recentBlinks
  const { blinkCount, enable, disable } = useBlinkDetection(
    videoTrack,
    {
      captureOnBlink: true,  // Capture frame on blink
      cropToFace: true,      // Crop to face region
      imageQuality: 0.8,     // JPEG quality (0.0-1.0)
      maxImageWidth: 480,    // Scale down if wider
    },
    (event) => {
      // faceImage is only available in this callback, not in recentBlinks
      if (event.faceImage) setCapturedImage(event.faceImage);
    }
  );

  // Start camera
  useEffect(() => {
    const startCamera = async () => {
      const mediaStream = await mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      setStream(mediaStream);
    };
    startCamera();
    return () => { stream?.release(); };
  }, []);

  // Enable detection when track is ready
  useEffect(() => {
    if (videoTrack) enable();
    return () => { disable(); };
  }, [videoTrack]);

  // capturedImage is set directly in the onBlink callback above

  return (
    <View style={{ flex: 1 }}>
      {stream && (
        <RTCView
          streamURL={stream.toURL()}
          style={{ width: 300, height: 400 }}
          mirror={true}
        />
      )}
      <Text>Blinks: {blinkCount}</Text>
      {capturedImage && (
        <Image
          source={{ uri: `data:image/jpeg;base64,${capturedImage}` }}
          style={{ width: 120, height: 120, borderRadius: 8 }}
        />
      )}
    </View>
  );
}
```

### Video Calling with Face Detection

Full WebRTC video call with face detection overlay:

```typescript
import { useState, useEffect } from 'react';
import { View, Text } from 'react-native';
import {
  RTCPeerConnection,
  RTCView,
  mediaDevices,
  useFaceDetection,
  useBlinkDetection,
  configureWebRTC,
} from 'react-native-webrtc-face-detection';

configureWebRTC({ enableFaceDetection: true });

function VideoCallWithFaceDetection() {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [peerConnection, setPeerConnection] = useState(null);

  const localVideoTrack = localStream?.getVideoTracks()[0] ?? null;

  // Face detection on local video
  const { detectionResult } = useFaceDetection(localVideoTrack);

  // Blink detection with capture
  const { blinkCount, recentBlinks } = useBlinkDetection(localVideoTrack, {
    captureOnBlink: true,
    cropToFace: true,
  });

  useEffect(() => {
    const setupCall = async () => {
      // Get local media
      const stream = await mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: true,
      });
      setLocalStream(stream);

      // Create peer connection
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });

      // Add tracks to connection
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      // Handle remote stream
      pc.ontrack = (event) => setRemoteStream(event.streams[0]);

      setPeerConnection(pc);
      // ... add signaling logic (offer/answer exchange)
    };

    setupCall();
    return () => {
      peerConnection?.close();
      localStream?.release();
    };
  }, []);

  return (
    <View style={{ flex: 1 }}>
      {/* Remote video (full screen) */}
      {remoteStream && (
        <RTCView
          streamURL={remoteStream.toURL()}
          style={{ flex: 1 }}
          objectFit="cover"
        />
      )}

      {/* Local video (picture-in-picture) */}
      {localStream && (
        <RTCView
          streamURL={localStream.toURL()}
          style={{ width: 100, height: 150, position: 'absolute', top: 20, right: 20 }}
          mirror={true}
        />
      )}

      {/* Face detection info */}
      <View style={{ position: 'absolute', bottom: 20, left: 20 }}>
        <Text style={{ color: 'white' }}>
          Faces: {detectionResult?.faces.length ?? 0} | Blinks: {blinkCount}
        </Text>
      </View>
    </View>
  );
}
```

### Standalone Camera with Image Adjustment

Use the camera as a standalone viewer with real-time image controls - no WebRTC peer connection needed:

```typescript
import { useState, useEffect } from 'react';
import { View } from 'react-native';
import {
  mediaDevices,
  RTCView,
  useImageAdjustment,
} from 'react-native-webrtc-face-detection';

function CameraWithAdjustments() {
  const [stream, setStream] = useState(null);
  const videoTrack = stream?.getVideoTracks()[0] ?? null;

  const {
    enable,
    setExposure,
    setContrast,
    setSaturation,
    setColorTemperature,
  } = useImageAdjustment(videoTrack);

  useEffect(() => {
    mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(setStream);
    return () => stream?.release();
  }, []);

  useEffect(() => {
    if (videoTrack) enable();
  }, [videoTrack]);

  return (
    <View style={{ flex: 1 }}>
      {stream && (
        <RTCView streamURL={stream.toURL()} style={{ flex: 1 }} mirror={true} />
      )}
      {/* Connect sliders to setExposure, setContrast, setSaturation, setColorTemperature */}
    </View>
  );
}
```

### Face Detection Overlay

`FaceDetectionOverlay` is a pure UI component — it does **not** require any separate enable step. Just pass the `detectionResult` from `useFaceDetection` and it renders animated bounding boxes. The underlying face detection pipeline (`configureWebRTC` + `useFaceDetection`) must be active to provide the data.

```typescript
import {
  RTCView,
  useFaceDetection,
  FaceDetectionOverlay,
  mediaDevices,
  configureWebRTC,
} from 'react-native-webrtc-face-detection';

configureWebRTC({ enableFaceDetection: true });

function FaceOverlayExample() {
  const [stream, setStream] = useState(null);
  const videoTrack = stream?.getVideoTracks()[0] ?? null;
  const { detectionResult, enable } = useFaceDetection(videoTrack);

  useEffect(() => {
    mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(setStream);
  }, []);

  useEffect(() => { if (videoTrack) enable(); }, [videoTrack]);

  return (
    <View style={{ flex: 1 }}>
      {stream && (
        <View style={{ position: 'relative' }}>
          <RTCView
            streamURL={stream.toURL()}
            style={{ width: '100%', aspectRatio: 4 / 3 }}
            objectFit="cover"
            mirror={true}
          />
          {detectionResult && (
            <FaceDetectionOverlay
              detectionResult={detectionResult}
              mirror={true}
              objectFit="cover"
              config={{
                showFaceBox: true,
                showEyeBoxes: true,
                showMouthBox: true,
                showHeadPose: true,
                showEyeStatus: true,
                // Customize appearance
                faceBoxColor: '#00FF00',
                eyeBoxColor: '#00AAFF',
                eyeClosedColor: '#FF4444',
                mouthBoxColor: '#FF00FF',
                strokeWidth: 2,
                eyeBoxSize: 30,
                eyeBoxBorderRadius: 2,    // Use eyeBoxSize/2 for circles
                faceBoxBorderRadius: 4,
                mouthBoxBorderRadius: 2,
              }}
              style={{
                position: 'absolute',
                top: 0, left: 0, right: 0, bottom: 0,
              }}
            />
          )}
        </View>
      )}
    </View>
  );
}
```

## 📚 Documentation

- [Android Installation](./Documentation/AndroidInstallation.md)
- [iOS Installation](./Documentation/iOSInstallation.md)
- [tvOS Installation](./Documentation/tvOSInstallation.md)
- [Basic Usage](./Documentation/BasicUsage.md)
- [Face Detection Guide](./Documentation/FaceDetection.md)
- [Image Adjustment Guide](./Documentation/ImageAdjustment.md)
- [Step by Step Call Guide](./Documentation/CallGuide.md)
- [Improving Call Reliability](./Documentation/ImprovingCallReliability.md)

## 🔧 API Reference

### Configuration

```typescript
// Image adjustment options
interface ImageAdjustmentConfig {
  exposure?: number;         // -1.0 to 1.0 (default: 0.0)
  contrast?: number;         // 0.0 to 3.0 (default: 1.0)
  saturation?: number;       // 0.0 to 3.0 (default: 1.0)
  colorTemperature?: number; // -1.0 to 1.0 (default: 0.0)
  smoothing?: {
    enabled: boolean;
    distanceNormalization?: number; // 2.5–8.0 (default: 3.0)
    texelSpacing?: number;          // 1.0–4.0 (default: 2.0)
    iterations?: number;            // 1–8 (default: 3)
    mix?: number;                   // 0.0-1.0 (default: 0.0)
    skinBrightness?: number;        // 0.0-1.0 (default: 0.0)
    smoothChroma?: boolean;         // default: true
  }
}

// Face detection options (passed to hooks)
interface FaceDetectionConfig {
  frameSkipCount?: number;        // Process every Nth frame (default: 3)
  blinkThreshold?: number;        // Eye open probability threshold (default: 0.3)
  captureOnBlink?: boolean;       // Capture frame on blink (default: false)
  cropToFace?: boolean;           // Crop to face bounds (default: true)
  imageQuality?: number;          // JPEG quality 0.0-1.0 (default: 0.7)
  maxImageWidth?: number;         // Max image width in pixels (default: 480)

  // Blink validation
  minBlinkDurationMs?: number;    // Minimum blink duration in ms (default: 50)
  maxBlinkDurationMs?: number;    // Maximum blink duration in ms (default: 800)
  blinkCooldownMs?: number;       // Minimum ms between consecutive blinks (default: 300)

  // Adaptive thresholding
  adaptiveThreshold?: boolean;    // Auto-calibrate threshold per user (default: false)
  calibrationDurationMs?: number; // Calibration window in ms (default: 3000)
}
```

### Types

```typescript
interface Face {
  bounds: BoundingBox;
  landmarks?: FaceLandmarks;
  confidence: number;
  trackingId?: number;
  headPose?: HeadPose;
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FaceLandmarks {
  leftEye: EyeData;
  rightEye: EyeData;
  mouth?: MouthData;
  nose?: NoseData;
}

interface MouthData {
  position: { x: number; y: number };
  width: number;
  height: number;
}

interface NoseData {
  position: { x: number; y: number };
}

interface EyeData {
  position: { x: number; y: number };
  isOpen: boolean;
  openProbability: number;  // 0.0 (closed) to 1.0 (open)
  blinkCount: number;
}

interface HeadPose {
  yaw: number;   // Left/right rotation
  pitch: number; // Up/down rotation
  roll: number;  // Tilt rotation
}

interface BlinkEvent {
  timestamp: number;                    // Blink timestamp (ms)
  eye?: 'left' | 'right' | 'both';     // 'both' = natural blink, 'left'/'right' = wink
  trackingId?: number;                  // Face tracking ID
  blinkCount?: number;                  // Total blinks for this eye
  faceImage?: string;                   // Base64 JPEG — only in onBlink callback, not recentBlinks
  faceBounds?: BoundingBox;             // Face bounds at capture time
  duration?: number;                    // Blink duration in ms
  blinkType?: 'blink' | 'wink';        // 'blink' = both eyes, 'wink' = one eye
  confidence?: number;                  // Detection quality score 0.0–1.0
  minOpenProbability?: number;          // Lowest eye probability during closure
}

interface FaceDetectionResult {
  faces: Face[];
  timestamp: number;
  frameWidth: number;
  frameHeight: number;
}

interface FaceDetectionOverlayConfig {
  showFaceBox?: boolean;          // default: true
  showEyeBoxes?: boolean;         // default: true
  showMouthBox?: boolean;         // default: true
  showHeadPose?: boolean;         // default: false
  showEyeStatus?: boolean;        // default: false
  faceBoxColor?: string;          // default: '#00FF00'
  eyeBoxColor?: string;           // default: '#00AAFF'
  eyeClosedColor?: string;        // default: '#FF4444'
  mouthBoxColor?: string;         // default: '#FF00FF'
  strokeWidth?: number;           // default: 2
  animationDuration?: number;     // default: 100 (ms)
  labelColor?: string;            // default: '#FFFFFF'
  labelFontSize?: number;         // default: 10
  labelBackgroundColor?: string;  // default: 'rgba(0, 0, 0, 0.6)'
  eyeBoxSize?: number;            // default: 30
  eyeBoxBorderRadius?: number;    // default: 2
  faceBoxBorderRadius?: number;   // default: 4
  mouthBoxBorderRadius?: number;  // default: 2
}
```

### Hooks

| Hook | Signature | Description |
|------|-----------|-------------|
| `useFaceDetection` | `(track, config?)` | Returns detected faces and detection state |
| `useBlinkDetection` | `(track, config?, onBlink?)` | Tracks blinks; returns `blinkCount`, `recentBlinks`, `isCalibrating`, `getBlinkRate`, `enable`, `disable`, `resetCount`, `error` |
| `useImageAdjustment` | `(track, config?)` | Controls exposure, contrast, saturation, color temperature |

#### `useBlinkDetection` return values

| Value | Type | Description |
|-------|------|-------------|
| `blinkCount` | `number` | Total blinks detected |
| `lastBlinkTime` | `number \| null` | Timestamp of last blink (ms) |
| `recentBlinks` | `BlinkEvent[]` | Last 10 blinks (without `faceImage`) |
| `isEnabled` | `boolean` | Whether detection is active |
| `isCalibrating` | `boolean` | True during adaptive threshold calibration |
| `enable` | `() => Promise<void>` | Start blink detection |
| `disable` | `() => Promise<void>` | Stop blink detection |
| `resetCount` | `() => void` | Reset blink counter |
| `getBlinkRate` | `() => number` | Current blink rate in BPM |
| `error` | `Error \| null` | Last error, if any |

### Components

| Component | Description |
|-----------|-------------|
| `RTCView` | Video rendering component |
| `RTCPIPView` | Picture-in-Picture video view |
| `FaceDetectionOverlay` | Animated face/eye/mouth bounding box overlay |
| `ScreenCapturePickerView` | Screen capture picker (iOS) |

## 📁 Example Projects

Check out the [examples](./examples) directory for complete working examples:

- **ExpoTestApp** - Full-featured Expo example with face detection demo
- **GumTestApp** - Basic getUserMedia example

## 🙏 Acknowledgements

This project is a fork of [react-native-webrtc](https://github.com/react-native-webrtc/react-native-webrtc) by the React Native WebRTC Community. We are grateful for their excellent work in bringing WebRTC to React Native.

### Original Project Credits
- **Repository**: [react-native-webrtc/react-native-webrtc](https://github.com/react-native-webrtc/react-native-webrtc)
- **Community**: [React Native WebRTC Discourse](https://react-native-webrtc.discourse.group/)
- **WebRTC**: Built on [Jitsi's WebRTC builds](https://github.com/jitsi/webrtc)

### What's Added in This Fork
- Real-time face detection using Google ML Kit (iOS & Android)
- Eye tracking with openness probability
- **Accurate blink detection** — unified events (`eye: "both"/"left"/"right"`), no double-counting
- **EMA probability smoothing** — eliminates false blinks from frame noise
- **Temporal validation** — min/max duration filtering (defaults: 50ms–800ms)
- **Blink debounce cooldown** — prevents rapid-fire false sequences (default: 300ms)
- **Blink confidence scoring** — weighted composite of probability delta, duration, and eye symmetry
- **Adaptive thresholding** — optional per-user calibration for variable conditions
- **Frame capture on blink** with face cropping (image delivered via `onBlink` callback)
- Head pose estimation
- Mouth and nose landmark detection
- `useFaceDetection` and `useBlinkDetection` hooks
- `FaceDetectionOverlay` component with fully customizable appearance
- Face detection processor architecture for Android and iOS
- Real-time image adjustment (exposure, contrast, saturation, color temperature)
- **Advanced Bilateral Skin Smoothing** (Beauty filter) with texture preservation
- **Targeted Skin Brightening** for a radiant "glow" effect
- `useImageAdjustment` hook for standalone camera control
- LUT-based I420 video frame processing with zero overhead at defaults

## 🔒 Privacy & Biometric Data

This library processes **biometric data** (faces, eye state) and can capture and export
face imagery. Detection runs **fully on-device** via Google ML Kit — no frames or landmarks
are sent to any network by this library — but you remain responsible for how you handle the
results:

- **Consent**: Obtain explicit user consent before enabling face detection or `captureOnBlink`.
  Biometric processing is regulated under laws such as **GDPR** (special-category data),
  **BIPA** (Illinois), and **CCPA/CPRA**.
- **`captureOnBlink` output**: `BlinkEvent.faceImage` is a base64 JPEG of the user's face.
  Do not log it, and transmit/store it only over secure channels with a clear retention policy.
- **ML Kit Terms**: Use of ML Kit is subject to the
  [Google ML Kit Terms of Service](https://developers.google.com/ml-kit/terms).
- **Minimize**: Keep `enableFaceDetection` opt-in (it is off by default) and disable detection
  when it is not needed.

## 🏷️ Versioning

This package's major version tracks the underlying **WebRTC** build (e.g. `124.x` ships on
JitsiWebRTC / `org.jitsi:webrtc` 124). The **minor/patch** components track this library's own
feature and fix releases. As a result the version does **not** follow strict SemVer against the
face-detection API surface — review the release notes when upgrading a minor version.

## 📄 License

MIT License - see the [LICENSE](./LICENSE) file for details.

This project is based on [react-native-webrtc](https://github.com/react-native-webrtc/react-native-webrtc) which is also MIT licensed.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📬 Support

- **Issues**: [GitHub Issues](https://github.com/arfuhad/react-native-webrtc-face-detection/issues)
- **Original WebRTC Community**: [Discourse Forum](https://react-native-webrtc.discourse.group/)
