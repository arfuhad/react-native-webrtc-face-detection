# Expo WebRTC Test App

A comprehensive test application for `react-native-webrtc` built with Expo and expo-dev-client.

## Features

This app tests the following `react-native-webrtc` capabilities:

### Camera Screen
- Start/stop camera with `mediaDevices.getUserMedia()`
- Display video stream using `RTCView`
- Toggle front/back camera
- Enumerate available media devices
- View video track settings (resolution, frame rate)

### Peer Connection Screen
- Create RTCPeerConnection instances
- Loopback test (local-to-local peer connection)
- SDP offer/answer exchange
- ICE candidate gathering
- Monitor connection states

### Face Detection Screen
- Real-time face detection using `useFaceDetection` hook
- Blink detection using `useBlinkDetection` hook
- Face confidence scores
- Eye open/closed state detection
- Head pose tracking (yaw, pitch, roll)
- Blink counting and rate calculation

## Prerequisites

- Node.js 18+
- Expo CLI (`npm install -g expo-cli`)
- For iOS: Xcode 15+, CocoaPods
- For Android: Android Studio, JDK 17+

## Setup

1. Install dependencies:

```bash
cd examples/ExpoTestApp
npm install
```

2. Add app icons (optional but recommended):

Place these files in the `assets/` folder:
- `icon.png` (1024x1024)
- `splash.png` (1284x2778)
- `adaptive-icon.png` (1024x1024)

## Running the App

This app uses `expo-dev-client` because `react-native-webrtc` includes native modules that are not available in Expo Go.

### iOS

```bash
# Generate native iOS project
npx expo prebuild --platform ios

# Run on iOS simulator or device
npx expo run:ios
```

### Android

```bash
# Generate native Android project
npx expo prebuild --platform android

# Run on Android emulator or device
npx expo run:android
```

### Development Mode

After the initial build, you can start the development server:

```bash
npm start
# or
npx expo start --dev-client
```

## Troubleshooting

### Camera not working

1. Ensure camera permissions are granted in device settings
2. For iOS simulator, camera is not available - test on a real device
3. Check that `configureWebRTC({ enableFaceDetection: true })` is called

### Build errors

1. Clean and rebuild:
```bash
npx expo prebuild --clean
```

2. For iOS, run:
```bash
cd ios && pod install && cd ..
```

### Metro bundler issues

If you get module resolution errors, try:
```bash
npx expo start --clear
```

## Project Structure

```
ExpoTestApp/
├── app/
│   ├── _layout.tsx          # Tab navigation layout
│   ├── index.tsx            # Camera test screen
│   ├── peer-connection.tsx  # P2P connection test
│   └── face-detection.tsx   # Face detection test
├── components/
│   ├── Button.tsx           # Styled button component
│   ├── Card.tsx             # Card container component
│   └── StatusIndicator.tsx  # Status display component
├── constants/
│   └── theme.ts             # Theme colors and spacing
├── app.json                 # Expo configuration
├── metro.config.js          # Metro bundler config
├── package.json             # Dependencies
└── tsconfig.json            # TypeScript config
```

## Local Package Development

This app links to the parent `react-native-webrtc` package using a local file reference. Any changes to the package source files will be reflected after a Metro reload.

The `metro.config.js` is configured to:
- Watch the parent package directory for changes
- Resolve modules from both project and workspace node_modules

