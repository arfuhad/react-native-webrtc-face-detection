# React Native WebRTC with Face Detection

[![npm version](https://img.shields.io/npm/v/react-native-webrtc-face-detection)](https://www.npmjs.com/package/react-native-webrtc-face-detection)
[![npm downloads](https://img.shields.io/npm/dm/react-native-webrtc-face-detection)](https://www.npmjs.com/package/react-native-webrtc-face-detection)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A powerful WebRTC module for React Native with **real-time face detection**, **eye tracking**, and **blink detection** capabilities. Built on top of the excellent [react-native-webrtc](https://github.com/react-native-webrtc/react-native-webrtc) project with enhanced ML-powered features.

## ✨ New Features

This fork extends the original react-native-webrtc with powerful face detection capabilities:

### 🎯 Real-Time Face Detection
- **High-performance on-device processing** using native ML frameworks
- **iOS**: Powered by Apple's Vision Framework
- **Android**: Powered by Google ML Kit
- Detect multiple faces simultaneously with bounding boxes

### 👁️ Eye Tracking
- Real-time eye position tracking
- Left and right eye detection with precise coordinates
- Eye openness probability for each eye

### 😉 Blink Detection
- Accurate blink detection with configurable thresholds
- Blink event callbacks for real-time interaction
- `useBlinkDetection` React hook for easy integration

### 🎣 React Hooks
- `useFaceDetection` - Easy-to-use hook for face detection
- `useBlinkDetection` - Hook for blink detection with customizable settings

### 📐 Head Pose Estimation
- Yaw, pitch, and roll angles
- Head orientation tracking for advanced use cases

## Feature Overview

|  | Android | iOS | tvOS | macOS* | Expo* |
| :- | :-: | :-: | :-: | :-: | :-: |
| Audio/Video | ✅ | ✅ | ✅ | - | ✅ |
| Data Channels | ✅ | ✅ | - | - | ✅ |
| Screen Capture | ✅ | ✅ | - | - | ✅ |
| **Face Detection** | ✅ | ✅ | - | - | ✅ |
| **Eye Tracking** | ✅ | ✅ | - | - | ✅ |
| **Blink Detection** | ✅ | ✅ | - | - | ✅ |
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
  const { blinkCount, lastBlinkTime } = useBlinkDetection({
    enabled: true,
    trackId: videoTrackId,
    onBlink: (event) => {
      console.log('Blink detected!', event);
    },
  });

  return <Text>Blinks: {blinkCount}</Text>;
}
```

### Face Detection Configuration

```typescript
import { configureWebRTC } from 'react-native-webrtc-face-detection';

// Configure face detection settings
configureWebRTC({
  faceDetection: {
    enabled: true,
    minFaceSize: 0.1, // Minimum face size as ratio of frame
    maxFaces: 5, // Maximum number of faces to detect
    trackingEnabled: true, // Enable face tracking
  },
});
```

## 📚 Documentation

- [Android Installation](./Documentation/AndroidInstallation.md)
- [iOS Installation](./Documentation/iOSInstallation.md)
- [tvOS Installation](./Documentation/tvOSInstallation.md)
- [Basic Usage](./Documentation/BasicUsage.md)
- [Face Detection Guide](./Documentation/FaceDetection.md)
- [Step by Step Call Guide](./Documentation/CallGuide.md)
- [Improving Call Reliability](./Documentation/ImprovingCallReliability.md)

## 🔧 API Reference

### Types

```typescript
interface Face {
  boundingBox: BoundingBox;
  landmarks?: FaceLandmarks;
  leftEyeOpenProbability?: number;
  rightEyeOpenProbability?: number;
  smilingProbability?: number;
  headPose?: HeadPose;
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface HeadPose {
  yaw: number;   // Left/right rotation
  pitch: number; // Up/down rotation
  roll: number;  // Tilt rotation
}

interface BlinkEvent {
  timestamp: number;
  eye: 'left' | 'right' | 'both';
  duration?: number;
}
```

### Hooks

| Hook | Description |
|------|-------------|
| `useFaceDetection` | Returns detected faces and detection state |
| `useBlinkDetection` | Tracks blinks with configurable callbacks |

### Components

| Component | Description |
|-----------|-------------|
| `RTCView` | Video rendering component |
| `RTCPIPView` | Picture-in-Picture video view |
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
- Real-time face detection using native ML frameworks
- Eye tracking with openness probability
- Blink detection with React hooks
- Head pose estimation
- `useFaceDetection` and `useBlinkDetection` hooks
- Face detection processor architecture for Android and iOS

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

- **Issues**: [GitHub Issues](https://github.com/arfuhad/react-native-webrtc/issues)
- **Original WebRTC Community**: [Discourse Forum](https://react-native-webrtc.discourse.group/)
