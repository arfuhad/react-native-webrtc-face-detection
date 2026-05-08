# Technical Documentation: react-native-webrtc-face-detection

**Version:** 124.1.1 | **WebRTC:** M124 (Jitsi) | **ML Kit:** v16.1.6 (Android) / v8.0.0 (iOS)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Source Structure](#3-source-structure)
4. [API Reference](#4-api-reference)
5. [Face Detection Types](#5-face-detection-types)
6. [Native Module Bridge](#6-native-module-bridge)
7. [Face Detection Pipeline](#7-face-detection-pipeline)
8. [Blink Detection Algorithm](#8-blink-detection-algorithm)
9. [Video Effects Pipeline](#9-video-effects-pipeline)
10. [Frame Capture](#10-frame-capture)
11. [Event System](#11-event-system)
12. [Configuration System](#12-configuration-system)
13. [Build System](#13-build-system)
14. [Platform Details](#14-platform-details)
15. [Performance Considerations](#15-performance-considerations)

---

## 1. Overview

A React Native library providing full WebRTC capabilities with integrated ML Kit-based face detection, eye tracking, and blink detection. Built on the original `react-native-webrtc` with significant ML enhancements.

### Platform Support

| Feature          | Android (API 24+) | iOS (15.5+) | tvOS (16.0+) | macOS (10.13+) | Expo |
|------------------|--------------------|-------------|--------------|----------------|------|
| Audio/Video      | Yes                | Yes         | Yes          | Yes            | Yes  |
| Data Channels    | Yes                | Yes         | Yes          | Yes            | Yes  |
| Screen Capture   | Yes                | Yes         | No           | Yes            | Yes  |
| Face Detection   | Yes                | Yes         | No           | No             | Yes  |
| Eye Tracking     | Yes                | Yes         | No           | No             | Yes  |
| Blink Detection  | Yes                | Yes         | No           | No             | Yes  |
| Frame Capture    | Yes                | Yes         | No           | No             | Yes  |

### Package Entry Points

| Field          | Path                        |
|----------------|-----------------------------|
| `main`         | `lib/commonjs/index.js`     |
| `module`       | `lib/module/index.js`       |
| `types`        | `lib/typescript/index.d.ts` |
| `react-native` | `src/index.ts`              |
| `source`       | `src/index.ts`              |

---

## 2. Architecture

```
+--------------------------------------------------------------------+
|                        React Native App                            |
|  +--------------------------------------------------------------+  |
|  |  JS/TS Layer (src/)                                          |  |
|  |                                                              |  |
|  |  +-------------------+   +--------------------------------+  |  |
|  |  | React Hooks       |   | Core WebRTC Classes            |  |  |
|  |  | useFaceDetection  |   | RTCPeerConnection              |  |  |
|  |  | useBlinkDetection |   | MediaStream / MediaStreamTrack |  |  |
|  |  +---------+---------+   | mediaDevices                   |  |  |
|  |            |             +---------------+----------------+  |  |
|  |            v                             |                   |  |
|  |  +-------------------+                   |                   |  |
|  |  | EventEmitter.ts   |<-- NativeEventEmitter                 |  |
|  |  | (16 native events)|                   |                   |  |
|  |  +-------------------+                   |                   |  |
|  +------------------------------------------+-------------------+  |
|                             |                                      |
|             NativeModules.WebRTCModule                              |
|                             |                                      |
|  +--------------------------v-----------------------------------+  |
|  |  Native Bridge Layer                                         |  |
|  |  iOS: WebRTCModule : RCTEventEmitter<RCTBridgeModule>        |  |
|  |  Android: WebRTCModule extends ReactContextBaseJavaModule    |  |
|  +--------------------------+-----------------------------------+  |
|                             |                                      |
|  +--------------------------v-----------------------------------+  |
|  |  Video Effects Pipeline                                      |  |
|  |  VideoEffectProcessor -> [FaceDetectionProcessor, ...]       |  |
|  |  ProcessorProvider (static registry by name)                 |  |
|  +--------------------------+-----------------------------------+  |
|                             |                                      |
|  +--------------------------v-----------------------------------+  |
|  |  ML Kit Face Detection                                       |  |
|  |  iOS: MLKFaceDetector (Google ML Kit via CocoaPods)          |  |
|  |  Android: com.google.mlkit FaceDetector (Maven)              |  |
|  +--------------------------------------------------------------+  |
+--------------------------------------------------------------------+
```

### Data Flow

1. Camera frames flow through the **VideoEffectProcessor** pipeline
2. **FaceDetectionProcessor** intercepts frames (every Nth frame based on `frameSkipCount`)
3. Frames are converted to ML Kit input format and processed asynchronously
4. Detection results are emitted as native events (`faceDetected`, `blinkDetected`)
5. Events relay through `NativeEventEmitter` to JS `EventEmitter`
6. React hooks or direct event listeners consume the results
7. The original frame continues to the rendering pipeline unmodified (non-blocking)

---

## 3. Source Structure

```
react-native-webrtc/
├── src/                                    # 43 TS/TSX files
│   ├── index.ts                            # All public exports + registerGlobals()
│   ├── hooks/
│   │   ├── useFaceDetection.ts             # Face detection React hook
│   │   └── useBlinkDetection.ts            # Blink detection React hook
│   ├── FaceDetection.types.ts              # Type definitions for face/blink detection
│   ├── WebRTCModuleConfig.ts               # Feature flags configuration
│   ├── EventEmitter.ts                     # Native event bridge (16 events)
│   ├── RTCPeerConnection.ts                # Peer connection wrapper
│   ├── RTCSessionDescription.ts            # SDP wrapper
│   ├── RTCIceCandidate.ts                  # ICE candidate wrapper
│   ├── RTCView.ts                          # Native video view component
│   ├── RTCPIPView.tsx                      # Picture-in-picture wrapper
│   ├── MediaStream.ts                      # Media stream container
│   ├── MediaStreamTrack.ts                 # Track class (face detection bridge)
│   ├── MediaDevices.ts                     # getUserMedia/getDisplayMedia/enumerateDevices
│   ├── getUserMedia.ts                     # getUserMedia implementation
│   ├── getDisplayMedia.ts                  # Screen capture implementation
│   ├── Permissions.ts                      # Permission management
│   ├── RTCDataChannel.ts                   # Data channel wrapper
│   ├── RTCRtpTransceiver.ts                # RTP transceiver
│   ├── RTCRtpSender.ts                     # RTP sender
│   ├── RTCRtpReceiver.ts                   # RTP receiver
│   ├── RTCRtpParameters.ts                 # RTP parameters base
│   ├── RTCRtpSendParameters.ts             # Send parameters with encodings
│   ├── RTCRtpReceiveParameters.ts          # Receive parameters
│   ├── RTCRtpEncodingParameters.ts         # Encoding config (bitrate, framerate)
│   ├── RTCRtpCodecParameters.ts            # Codec parameters
│   ├── RTCRtpCodecCapability.ts            # Codec capability
│   ├── RTCRtpCapabilities.ts               # RTP capabilities
│   ├── RTCRtpHeaderExtension.ts            # RTP header extension
│   ├── RTCAudioSession.ts                  # iOS CallKit audio session
│   ├── RTCUtil.ts                          # Utilities (UUID, deepClone, normalization)
│   ├── Logger.ts                           # Debug logging (debug package)
│   ├── Constraints.ts                      # Media constraint types
│   ├── ScreenCapturePickerView.ts          # Screen capture UI
│   ├── RTCErrorEvent.ts                    # Error event class
│   ├── RTCTrackEvent.ts                    # Track event class
│   ├── RTCDataChannelEvent.ts              # Data channel event class
│   ├── RTCIceCandidateEvent.ts             # ICE candidate event class
│   ├── MediaStreamTrackEvent.ts            # Track add/remove event class
│   ├── MediaStreamError.ts                 # Stream error class
│   ├── MediaStreamErrorEvent.ts            # Stream error event class
│   └── MessageEvent.ts                     # Data channel message event
├── ios/RCTWebRTC/                          # 53 Objective-C files
│   ├── WebRTCModule.{h,m}                  # Main bridge module
│   ├── WebRTCModule+RTCPeerConnection.{h,m}# Peer connection methods
│   ├── WebRTCModule+RTCMediaStream.{h,m}   # Media stream methods
│   ├── WebRTCModule+RTCDataChannel.{h,m}   # Data channel methods
│   ├── WebRTCModule+Transceivers.{h,m}     # Transceiver methods
│   ├── WebRTCModule+Permissions.{h,m}      # Permission handling
│   ├── WebRTCModule+RTCAudioSession.{h,m}  # Audio session (CallKit)
│   ├── WebRTCModule+VideoTrackAdapter.{h,m}# Mute detection
│   ├── videoEffects/
│   │   ├── FaceDetectionProcessor.{h,m}    # ML Kit face detection
│   │   ├── VideoEffectProcessor.{h,m}      # Processor chain runner
│   │   ├── ProcessorProvider.{h,m}         # Processor registry
│   │   ├── VideoFrameProcessor*.{h,m}      # Processor protocol/interface
│   │   └── EyeState.{h,m}                 # Per-face eye state tracking
│   ├── VideoCaptureController.{h,m}        # Camera capture management
│   ├── ScreenCaptureController.{h,m}       # Screen capture
│   ├── I420Converter.{h,m}                 # I420->BGRA via Accelerate
│   ├── RTCVideoViewManager.{h,m}           # RTCView native manager
│   ├── PIPController.{h,m}                 # Picture-in-picture
│   ├── DataChannelWrapper.{h,m}            # Data channel ObjC wrapper
│   └── SerializeUtils.{h,m}               # Serialization helpers
├── android/src/main/java/com/oney/WebRTCModule/  # 35 Java files
│   ├── WebRTCModule.java                   # Main bridge module
│   ├── WebRTCModulePackage.java            # React package registration
│   ├── WebRTCModuleOptions.java            # Module options
│   ├── GetUserMediaImpl.java               # getUserMedia implementation
│   ├── CameraCaptureController.java        # Camera management
│   ├── AbstractVideoCaptureController.java # Base capture controller
│   ├── PeerConnectionObserver.java         # Peer connection observer
│   ├── DataChannelWrapper.java             # Data channel wrapper
│   ├── VideoTrackAdapter.java              # Mute detection
│   ├── MediaProjectionService.java         # Screen capture service
│   ├── DisplayUtils.java                   # Display utilities
│   ├── videoEffects/
│   │   ├── FaceDetectionProcessor.java     # ML Kit face detection
│   │   ├── FaceDetectionProcessorFactory.java # Singleton factory
│   │   ├── VideoEffectProcessor.java       # Processor chain runner
│   │   ├── VideoFrameProcessor.java        # Processor interface
│   │   ├── VideoFrameProcessorFactoryInterface.java # Factory interface
│   │   ├── ProcessorProvider.java          # Processor registry
│   │   └── EyeState.java                  # Per-face eye state tracking
│   └── org/webrtc/
│       ├── Camera1Helper.java              # Camera1 API helper
│       └── Camera2Helper.java              # Camera2 API helper
├── Documentation/                          # 8 guides
│   ├── FaceDetection.md                    # Face detection usage guide
│   ├── BasicUsage.md                       # Getting started
│   ├── CallGuide.md                        # WebRTC call setup guide
│   ├── ImprovingCallReliability.md         # Reliability tips
│   ├── AndroidInstallation.md              # Android setup
│   ├── iOSInstallation.md                  # iOS setup
│   ├── tvOSInstallation.md                 # tvOS setup
│   └── BuildingWebRTC.md                   # Building WebRTC from source
├── examples/
│   ├── ExpoTestApp/                        # Expo example with face detection
│   ├── GumTestApp/                         # Basic getUserMedia example
│   └── GumTestApp_macOS/                   # macOS example
├── apple/
│   ├── WebRTC.xcframework/                 # Pre-built WebRTC framework (macOS/tvOS)
│   └── WebRTC.dSYMs/                       # Debug symbols
├── tools/
│   ├── format.sh                           # Code formatting
│   └── release.sh                          # Release script
├── package.json                            # NPM package config
├── tsconfig.json                           # TypeScript config
├── react-native-webrtc-face-detection.podspec # iOS CocoaPods spec
└── .github/workflows/                      # CI/CD
    ├── ci.yml                              # Lint
    ├── android_ci.yml                      # Android build
    └── ios_ci.yml                          # iOS build
```

---

## 4. API Reference

All public exports from `src/index.ts`:

### 4.1 Core WebRTC Classes

#### RTCPeerConnection

The main WebRTC peer connection class wrapping the native implementation.

```typescript
class RTCPeerConnection {
    constructor(configuration?: RTCConfiguration);

    // Properties
    localDescription: RTCSessionDescription | null;
    remoteDescription: RTCSessionDescription | null;
    signalingState: 'stable' | 'have-local-offer' | 'have-remote-offer' | 'have-local-pranswer' | 'have-remote-pranswer' | 'closed';
    iceGatheringState: 'new' | 'gathering' | 'complete';
    connectionState: 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';
    iceConnectionState: 'new' | 'checking' | 'connected' | 'completed' | 'failed' | 'disconnected' | 'closed';

    // Signaling
    createOffer(options?: RTCOfferOptions): Promise<RTCSessionDescription>;
    createAnswer(): Promise<RTCSessionDescription>;
    setLocalDescription(sessionDescription?: RTCSessionDescription): Promise<void>;
    setRemoteDescription(sessionDescription: RTCSessionDescription): Promise<void>;
    setConfiguration(configuration: RTCConfiguration): void;
    addIceCandidate(candidate: RTCIceCandidate): Promise<void>;

    // Tracks & Streams
    addTrack(track: MediaStreamTrack, ...streams: MediaStream[]): RTCRtpSender;
    removeTrack(sender: RTCRtpSender): void;
    getSenders(): RTCRtpSender[];
    getReceivers(): RTCRtpReceiver[];
    getTransceivers(): RTCRtpTransceiver[];
    addTransceiver(trackOrKind: MediaStreamTrack | string, init?: object): RTCRtpTransceiver;

    // Data Channels
    createDataChannel(label: string, options?: object): RTCDataChannel;

    // Lifecycle
    close(): void;

    // Events: connectionstatechange, icecandidate, icecandidateerror,
    //   iceconnectionstatechange, icegatheringstatechange, negotiationneeded,
    //   signalingstatechange, datachannel, track, error
}
```

**RTCConfiguration:**
```typescript
type RTCConfiguration = {
    bundlePolicy?: 'balanced' | 'max-compat' | 'max-bundle';
    iceCandidatePoolSize?: number;
    iceServers?: RTCIceServer[];
    iceTransportPolicy?: 'all' | 'relay';
    rtcpMuxPolicy?: 'negotiate' | 'require';
};
```

#### MediaStream

```typescript
class MediaStream {
    constructor();
    constructor(stream: MediaStream);
    constructor(tracks: MediaStreamTrack[]);

    readonly id: string;
    readonly active: boolean;

    addTrack(track: MediaStreamTrack): void;
    removeTrack(track: MediaStreamTrack): void;
    getTracks(): MediaStreamTrack[];
    getTrackById(trackId: string): MediaStreamTrack | undefined;
    getAudioTracks(): MediaStreamTrack[];
    getVideoTracks(): MediaStreamTrack[];
    clone(): MediaStream;
    toURL(): string;
    release(): void;
}
```

#### MediaStreamTrack

```typescript
class MediaStreamTrack {
    readonly id: string;
    readonly kind: 'audio' | 'video';
    enabled: boolean;
    readonly muted: boolean;
    readonly readyState: 'live' | 'ended';
    readonly remote: boolean;

    // Constraints
    getConstraints(): object;
    getSettings(): MediaTrackSettings;
    applyConstraints(constraints: object): Promise<void>;

    // Video-specific
    _switchCamera(): void;
    _setVideoEffect(name: string): void;
    _setVideoEffects(effects: string[]): void;

    // Audio-specific
    _setVolume(volume: number): void;

    // Face Detection
    enableFaceDetection(config?: FaceDetectionConfig): Promise<void>;
    disableFaceDetection(): Promise<void>;
    readonly isFaceDetectionEnabled: boolean;

    // Lifecycle
    stop(): void;
    release(): void;

    // Events: ended, mute, unmute, facedetected, blinkdetected
}
```

#### RTCSessionDescription

```typescript
class RTCSessionDescription {
    readonly sdp: string;
    readonly type: string | null;
    constructor(info: { sdp: string; type: string | null });
    toJSON(): { sdp: string; type: string | null };
}
```

#### RTCIceCandidate

```typescript
class RTCIceCandidate {
    readonly candidate: string;
    readonly sdpMLineIndex: number | null;
    readonly sdpMid: string | null;
    constructor(info: { candidate: string; sdpMLineIndex?: number; sdpMid?: string });
    toJSON(): object;
}
```

#### RTCDataChannel

```typescript
class RTCDataChannel {
    readonly id: number;
    readonly label: string;
    readonly ordered: boolean;
    readonly maxPacketLifeTime: number;
    readonly maxRetransmits: number;
    readonly protocol: string;
    readonly negotiated: boolean;
    readonly readyState: 'connecting' | 'open' | 'closing' | 'closed';
    bufferedAmount: number;
    binaryType: 'arraybuffer';  // Only supported type
    bufferedAmountLowThreshold: number;

    send(data: string | ArrayBuffer | ArrayBufferView): void;
    close(): void;

    // Events: open, close, closing, message, error, bufferedamountlow
}
```

### 4.2 RTP Stack

#### RTCRtpTransceiver

```typescript
class RTCRtpTransceiver {
    readonly mid: string | null;
    readonly stopped: boolean;
    direction: 'sendonly' | 'recvonly' | 'sendrecv' | 'inactive';
    readonly currentDirection: string | null;
    readonly sender: RTCRtpSender;
    readonly receiver: RTCRtpReceiver;

    setCodecPreferences(codecs: RTCRtpCodecCapability[]): void;
    stop(): void;
}
```

#### RTCRtpSender

```typescript
class RTCRtpSender {
    readonly id: string;
    readonly track: MediaStreamTrack | null;

    replaceTrack(track: MediaStreamTrack | null): Promise<void>;
    getParameters(): RTCRtpSendParameters;
    setParameters(parameters: RTCRtpSendParameters): Promise<void>;
    getStats(): Promise<Map<string, any>>;
    static getCapabilities(kind: 'audio' | 'video'): RTCRtpCapabilities;
}
```

#### RTCRtpReceiver

```typescript
class RTCRtpReceiver {
    readonly id: string;
    readonly track: MediaStreamTrack;

    getParameters(): RTCRtpReceiveParameters;
    getStats(): Promise<Map<string, any>>;
    static getCapabilities(kind: 'audio' | 'video'): RTCRtpCapabilities;
}
```

#### RTP Parameter Types

```typescript
interface RTCRtpEncodingParameters {
    active: boolean;
    rid?: string;
    maxFramerate?: number;
    maxBitrate?: number;
    scaleResolutionDownBy?: number;
}

interface RTCRtpCodecParameters {
    payloadType: number;
    clockRate: number;
    mimeType: string;
    channels?: number;
    sdpFmtpLine?: string;
}

interface RTCRtpHeaderExtension {
    id: number;
    uri: string;
    encrypted: boolean;
}
```

### 4.3 React Hooks

#### useFaceDetection

```typescript
function useFaceDetection(
    track: MediaStreamTrack | null,
    config?: FaceDetectionConfig
): {
    detectionResult: FaceDetectionResult | null;
    isEnabled: boolean;
    enable: () => Promise<void>;
    disable: () => Promise<void>;
    error: Error | null;
};
```

Enables ML Kit face detection on a video track. Listens to `faceDetected` native events. Auto-disables on unmount. Only works with video tracks (`track.kind === 'video'`).

#### useBlinkDetection

```typescript
function useBlinkDetection(
    track: MediaStreamTrack | null,
    config?: FaceDetectionConfig
): {
    blinkCount: number;
    lastBlinkTime: number | null;
    recentBlinks: BlinkEvent[];   // Last 10 blink events
    isEnabled: boolean;
    enable: () => Promise<void>;
    disable: () => Promise<void>;
    resetCount: () => void;
    getBlinkRate: () => number;   // Blinks per minute
    error: Error | null;
};
```

Enables blink detection (face detection under the hood). Listens to `blinkDetected` native events. Tracks blink count, recent events, and calculates blink rate. Auto-disables on unmount.

### 4.4 UI Components

#### RTCView

Native video rendering component.

```typescript
interface RTCVideoViewProps extends ViewProps {
    streamURL?: string;
    mirror?: boolean;
    objectFit?: 'contain' | 'cover';  // Default: 'cover'
    zOrder?: number;
    iosPIP?: RTCIOSPIPOptions;
    onDimensionsChange?: (event: { width: number; height: number }) => void;
}

interface RTCIOSPIPOptions {
    enabled?: boolean;              // Default: true
    preferredSize?: { width: number; height: number };
    startAutomatically?: boolean;   // Default: true
    stopAutomatically?: boolean;    // Default: true
}
```

#### RTCPIPView

Picture-in-picture wrapper extending RTCView. Exports `startIOSPIP(ref)` and `stopIOSPIP(ref)` functions.

#### ScreenCapturePickerView

Native screen capture picker UI component (macOS/iOS).

### 4.5 Utility Exports

#### mediaDevices (singleton)

```typescript
const mediaDevices: {
    getUserMedia(constraints: { audio?: boolean | object; video?: boolean | object }): Promise<MediaStream>;
    getDisplayMedia(): Promise<MediaStream>;  // Requires enableScreenCapture config
    enumerateDevices(): Promise<MediaDeviceInfo[]>;
};
```

#### permissions (singleton)

```typescript
const permissions: {
    RESULT: { DENIED: string; GRANTED: string; PROMPT: string };
    query(permissionDesc: { name: 'camera' | 'microphone' }): Promise<string>;
    request(permissionDesc: { name: 'camera' | 'microphone' }): Promise<boolean>;
};
```

#### configureWebRTC

```typescript
function configureWebRTC(config: WebRTCConfig): void;
```

Must be called at app startup before using gated features. See [Configuration System](#12-configuration-system).

#### registerGlobals

```typescript
function registerGlobals(): void;
```

Polyfills `navigator.mediaDevices` (getUserMedia, getDisplayMedia, enumerateDevices) and registers WebRTC classes as globals (RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, MediaStream, MediaStreamTrack, etc.).

#### RTCAudioSession (iOS only)

```typescript
class RTCAudioSession {
    static audioSessionDidActivate(): void;   // CallKit integration
    static audioSessionDidDeactivate(): void;
}
```

---

## 5. Face Detection Types

Defined in `src/FaceDetection.types.ts`:

### FaceDetectionConfig

```typescript
interface FaceDetectionConfig {
    frameSkipCount?: number;    // Process every Nth frame. Default: 3
    blinkThreshold?: number;    // Eye open probability threshold. Default: 0.21 (iOS) / 0.3 (Android)
    captureOnBlink?: boolean;   // Capture frame on blink. Default: false
    cropToFace?: boolean;       // Crop captured image to face. Default: true
    imageQuality?: number;      // JPEG quality 0.0-1.0. Default: 0.7
    maxImageWidth?: number;     // Max capture width in px. Default: 480
}
```

### FaceDetectionResult

```typescript
interface FaceDetectionResult {
    faces: Face[];              // Array of detected faces
    timestamp: number;          // Detection time (ms)
    frameWidth: number;         // Video frame width
    frameHeight: number;        // Video frame height
}
```

### Face

```typescript
interface Face {
    bounds: BoundingBox;        // Face location in frame
    landmarks: FaceLandmarks;   // Eye data
    confidence: number;         // Detection confidence 0.0-1.0
    trackingId?: number;        // Stable ID across frames
    headPose?: HeadPose;        // Head rotation angles
}
```

### BoundingBox

```typescript
interface BoundingBox {
    x: number;                  // Top-left X
    y: number;                  // Top-left Y
    width: number;
    height: number;
}
```

### FaceLandmarks

```typescript
interface FaceLandmarks {
    leftEye: EyeData;
    rightEye: EyeData;
}
```

### EyeData

```typescript
interface EyeData {
    position: { x: number; y: number };  // Eye center in frame
    isOpen: boolean;                      // Derived from probability vs threshold
    openProbability: number;              // 0.0 = closed, 1.0 = open
    blinkCount: number;                   // Cumulative blinks for this eye
}
```

### HeadPose

```typescript
interface HeadPose {
    yaw: number;    // Left-right rotation (degrees). Negative = left, Positive = right
    pitch: number;  // Up-down rotation (degrees). Negative = down, Positive = up
    roll: number;   // Tilt rotation (degrees). Negative = left, Positive = right
}
```

### BlinkEvent

```typescript
interface BlinkEvent {
    timestamp: number;          // Blink time (ms)
    eye?: 'left' | 'right';    // Which eye blinked
    trackingId?: number;        // Face tracking ID
    blinkCount?: number;        // Cumulative count for this eye
    faceImage?: string;         // Base64 JPEG (when captureOnBlink enabled)
    faceBounds?: BoundingBox;   // Face location (when captureOnBlink enabled)
}
```

---

## 6. Native Module Bridge

### 6.1 iOS Bridge

**File:** `ios/RCTWebRTC/WebRTCModule.m`

**Class:** `WebRTCModule : RCTEventEmitter<RCTBridgeModule>`

The iOS module is organized using Objective-C categories for modularity:

| Category File                            | Responsibility                     |
|------------------------------------------|------------------------------------|
| `WebRTCModule+RTCPeerConnection.m`       | Peer connection lifecycle          |
| `WebRTCModule+RTCMediaStream.m`          | Stream creation and management     |
| `WebRTCModule+RTCDataChannel.m`          | Data channel operations            |
| `WebRTCModule+Transceivers.m`            | RTP transceiver management         |
| `WebRTCModule+Permissions.m`             | Camera/microphone permissions      |
| `WebRTCModule+RTCAudioSession.m`         | CallKit audio session              |
| `WebRTCModule+VideoTrackAdapter.m`       | Video track mute detection         |

**Key properties:**
- `RTCPeerConnectionFactory *peerConnectionFactory`
- `NSMutableDictionary<NSNumber *, RTCPeerConnection *> *peerConnections`
- `NSMutableDictionary<NSString *, RTCMediaStream *> *localStreams`
- `NSMutableDictionary<NSString *, RTCMediaStreamTrack *> *localTracks`
- `FaceDetectionProcessor *faceDetectionProcessor`
- `dispatch_queue_t workerQueue` (serial, QOS_CLASS_USER_INITIATED)

**Exported face detection methods:**
```objc
RCT_EXPORT_METHOD(enableFaceDetection:(NSString *)trackId
                  config:(NSDictionary *)config
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXPORT_METHOD(disableFaceDetection:(NSString *)trackId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
```

### 6.2 Android Bridge

**File:** `android/src/main/java/com/oney/WebRTCModule/WebRTCModule.java`

**Class:** `WebRTCModule extends ReactContextBaseJavaModule`

**Annotation:** `@ReactModule(name = "WebRTCModule")`

**Key properties:**
- `PeerConnectionFactory mFactory`
- `SparseArray<PeerConnectionObserver> mPeerConnectionObservers`
- `Map<String, MediaStream> localStreams`
- `GetUserMediaImpl getUserMediaImpl`
- `FaceDetectionProcessorFactory faceDetectionProcessorFactory`

**Exported face detection methods:**
```java
@ReactMethod
public void enableFaceDetection(String trackId, ReadableMap config, Promise promise)

@ReactMethod
public void disableFaceDetection(String trackId, Promise promise)
```

**Module registration:** `WebRTCModulePackage implements ReactPackage` creates both `WebRTCModule` and `RTCVideoViewManager`.

### 6.3 Event Emission

- **iOS:** `[self sendEventWithName:@"faceDetected" body:eventData]` (inherited from RCTEventEmitter)
- **Android:** `reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit("faceDetected", eventData)`
- **JS relay:** `NativeEventEmitter(WebRTCModule)` -> JS `EventEmitter` (see [Event System](#11-event-system))

---

## 7. Face Detection Pipeline

### 7.1 iOS Pipeline

```
Camera
  │
  v
RTCCameraVideoCapturer
  │
  v
VideoEffectProcessor (RTCVideoCapturerDelegate)
  │
  ├── Returns frame immediately to RTCVideoSource (non-blocking)
  │
  └── FaceDetectionProcessor.capturer:didCaptureVideoFrame:
        │
        ├── Frame skip check (every Nth frame)
        ├── isProcessing guard
        │
        v
      pixelBufferFromFrame:
        ├── RTCCVPixelBuffer → CVPixelBufferRetain (fast path)
        └── I420Buffer → I420Converter (Accelerate vImage) → BGRA CVPixelBuffer
              │
              v
        dispatch_async(processingQueue) {   // GCD serial queue
              │
              v
          CVPixelBuffer → CIImage → CGImage → UIImage
              │
              v
          MLKVisionImage (orientation: UIImageOrientationRight)
              │
              v
          MLKFaceDetector.resultsInImage:completion:
              │
              v
          processFaceResults:
              ├── Extract bounds, confidence, trackingId, headPose
              ├── Process left/right eyes → blink state machine
              ├── Emit "faceDetected" event
              └── Emit "blinkDetected" event (on blink transition)
        }
```

**Key iOS details:**
- Processing queue: `dispatch_queue_create("com.webrtc.facedetection", DISPATCH_QUEUE_SERIAL)`
- Image conversion uses CIContext for GPU-accelerated operations
- I420Converter uses Accelerate framework's vImage for fast buffer conversion
- CVPixelBuffer explicitly retained/released for memory safety

### 7.2 Android Pipeline

```
Camera
  │
  v
VideoCapturer (CameraVideoCapturer)
  │
  v
VideoEffectProcessor (VideoProcessor)
  │
  ├── Returns frame immediately to VideoSink (non-blocking)
  │
  └── FaceDetectionProcessor.process(frame, textureHelper)
        │
        ├── Frame skip check (every Nth frame)
        ├── AtomicBoolean isProcessing guard
        │
        ├── I420Buffer path (fast):
        │     └── createInputImageFromI420Buffer → InputImage
        │
        └── TextureBuffer path:
              ├── frame.retain()
              ├── frame.getBuffer().toI420()  // Texture → I420
              ├── frame.release()
              ├── I420 → NV21 (manual Y/UV interleaving)
              └── InputImage.fromByteArray(nv21, width, height, rotation, NV21)
                    │
                    v
              faceDetectionHandler.post {    // Dedicated HandlerThread
                    │
                    v
                FaceDetector.process(inputImage)
                    │
                    v
                processFaceResults:
                    ├── Extract boundingBox, confidence, trackingId, eulerAngles
                    ├── Process left/right eyes → blink state machine
                    ├── Emit "faceDetected" event
                    └── Emit "blinkDetected" event (on blink transition)
              }
```

**Key Android details:**
- Processing thread: `HandlerThread("FaceDetectionThread")` with dedicated Handler
- Separate `EglBase` context for texture operations (independent from rendering)
- `YuvConverter` handles TextureBuffer → I420 conversion
- I420 → NV21 conversion: copies Y plane, then interleaves V and U planes
- Frame retain/release prevents premature garbage collection during async processing

### 7.3 ML Kit Configuration (Both Platforms)

```
FaceDetectorOptions:
  performanceMode:    FAST
  landmarkMode:       ALL
  classificationMode: ALL    (enables eye open probability)
  contourMode:        NONE
  minFaceSize:        0.15
  trackingEnabled:    true
```

---

## 8. Blink Detection Algorithm

Both platforms use the same state machine logic, tracked per-face via `trackingId`:

```
EyeState per face (keyed by trackingId):
  ┌──────────────────────────────────────────┐
  │  wasOpen: boolean                        │
  │  isOpen: boolean                         │
  │  blinkCount: int                         │
  │  currentProbability: float               │
  └──────────────────────────────────────────┘

Update cycle (each processed frame):
  1. wasOpen = isOpen
  2. isOpen = (openProbability > blinkThreshold)

  Transitions:
  ┌─────────────────────────────────────────────────────┐
  │  Open → Closed  (wasOpen && !isOpen)                │
  │    → Store current pixel buffer for frame capture   │
  │                                                     │
  │  Closed → Open  (!wasOpen && isOpen)                │
  │    → blinkCount++                                   │
  │    → Emit "blinkDetected" event                     │
  │    → If captureOnBlink: encode stored frame         │
  │      as base64 JPEG and include in event            │
  └─────────────────────────────────────────────────────┘
```

**Default thresholds:**
- iOS: `blinkThreshold = 0.3` (eye open probability)
- Android: `blinkThreshold = 0.3` (eye open probability)
- TS types document: `0.21 (iOS) / 0.3 (Android)` — the iOS native code defaults to 0.3 after ML Kit migration

**Frame stored at Open→Closed** (not Closed→Open) so the captured image shows the face with eyes closing, which is more useful than the frame when eyes reopen.

---

## 9. Video Effects Pipeline

### Architecture

Both platforms use a processor registry pattern:

```
ProcessorProvider (static registry)
  │
  ├── "faceDetection" → FaceDetectionProcessor
  └── "imageAdjustment" → ImageAdjustmentProcessor

VideoEffectProcessor (chain runner)
  │
  ├── Receives raw frame from camera capturer
  ├── Passes frame through FaceDetectionProcessor (metadata only)
  ├── Passes frame through ImageAdjustmentProcessor (pixel manipulation)
  └── Sends (possibly modified) frame to video source/sink
```

### ImageAdjustment & Skin Smoothing

The `ImageAdjustmentProcessor` performs pixel manipulation on the I420 frame using a multi-stage pipeline:

1. **Bilateral Smoothing (GPU)**: 
   - Runs a separable 9-tap bilateral filter on the Y (luminance) plane.
   - Compound effect: default 3 passes (up to 8).
   - **Metal (iOS)**: Separable compute kernel (`bilateralSeparable`).
   - **OpenGL ES (Android)**: Separable fragment shader.
   - **Texture Preservation (Mix)**: Blends original luminance back ($m \cdot original + (1-m) \cdot smooth$).
   - **Skin Brightening**: Targeted gain applied within the skin mask.

2. **Skin Masking**: 
   - Uses the latest face result from `FaceResultCache`.
   - Generates a grayscale coverage mask using `SkinMaskBuilder`.
   - Protects eyes/mouth by "punching holes" in the mask using landmark coordinates.
   - Smoothing is applied proportionally to mask value (0.0 to 1.0).

3. **LUT-based Tone Mapping (CPU)**: 
   - Three 256-byte LUTs (Y, U, V) generated from exposure, contrast, saturation, and color temperature.
   - Per-pixel lookup: $dst[val] = LUT[val]$.
   - Zero-math processing for maximum efficiency.

### iOS Implementation

- **ProcessorProvider:** `static NSMutableDictionary<NSString *, NSObject<VideoFrameProcessorDelegate> *>`
  - `+getProcessor:(NSString *)name`
  - `+addProcessor:(NSObject<VideoFrameProcessorDelegate> *)processor forName:(NSString *)name`
  - `+removeProcessor:(NSString *)name`

- **VideoFrameProcessorDelegate protocol:**
  - `-(RTCVideoFrame *)capturer:(RTCVideoCapturer *)capturer didCaptureVideoFrame:(RTCVideoFrame *)frame`

- **VideoEffectProcessor:** Implements `RTCVideoCapturerDelegate`, iterates through processors

### Android Implementation

- **ProcessorProvider:** `static Map<String, VideoFrameProcessorFactoryInterface>`
  - `getProcessor(String name)` — calls `factory.build()`
  - `addProcessor(String name, VideoFrameProcessorFactoryInterface factory)`
  - `removeProcessor(String name)`

- **VideoFrameProcessor interface:**
  - `VideoFrame process(VideoFrame frame, SurfaceTextureHelper textureHelper)`

- **FaceDetectionProcessorFactory:** Singleton pattern — `build()` returns same instance

---

## 10. Frame Capture

When `captureOnBlink` is enabled, a base64 JPEG image is captured and included in `BlinkEvent.faceImage`.

### Capture Timing

1. At **Open→Closed** transition: store the current frame buffer
2. At **Closed→Open** transition (blink confirmed): encode the stored frame

### iOS Capture Flow

```
Stored CVPixelBuffer
  → CVPixelBufferLockBaseAddress
  → CIImage(cvPixelBuffer:)
  → Crop to face bounds (15% padding) if cropToFace
  → Scale down if width > maxImageWidth
  → CIContext.createCGImage
  → UIImage(cgImage:)
  → UIImageJPEGRepresentation(image, imageQuality)
  → base64EncodedString
```

### Android Capture Flow

```
Stored NV21 byte[]
  → YuvImage(nv21, ImageFormat.NV21, width, height, null)
  → compressToJpeg(fullRect, 100, outputStream)
  → BitmapFactory.decodeByteArray → Bitmap
  → Crop to face bounds (15% padding) if cropToFace
  → Scale down if width > maxImageWidth (Bitmap.createScaledBitmap)
  → Bitmap.compress(JPEG, imageQuality * 100, outputStream)
  → Base64.encodeToString(bytes, Base64.NO_WRAP)
```

### Configuration

| Parameter      | Default | Description                               |
|----------------|---------|-------------------------------------------|
| captureOnBlink | false   | Enable/disable frame capture              |
| cropToFace     | true    | Crop to face bounding box (15% padding)   |
| imageQuality   | 0.7     | JPEG compression quality (0.0 - 1.0)     |
| maxImageWidth  | 480     | Max width in pixels (maintains aspect ratio) |

---

## 11. Event System

### Native Events (16 total)

Defined in `src/EventEmitter.ts`:

| Event Name                              | Emitted By              | Payload Type                |
|-----------------------------------------|-------------------------|-----------------------------|
| `peerConnectionSignalingStateChanged`   | PeerConnection          | `{ id, signalingState }`    |
| `peerConnectionStateChanged`            | PeerConnection          | `{ id, connectionState }`   |
| `peerConnectionOnRenegotiationNeeded`   | PeerConnection          | `{ id }`                    |
| `peerConnectionIceConnectionChanged`    | PeerConnection          | `{ id, iceConnectionState }`|
| `peerConnectionIceGatheringChanged`     | PeerConnection          | `{ id, iceGatheringState }` |
| `peerConnectionGotICECandidate`         | PeerConnection          | `{ id, candidate, ... }`   |
| `peerConnectionDidOpenDataChannel`      | PeerConnection          | `{ id, dataChannel }`      |
| `peerConnectionOnRemoveTrack`           | PeerConnection          | `{ id, senderId }`         |
| `peerConnectionOnTrack`                 | PeerConnection          | `{ id, track, ... }`       |
| `dataChannelStateChanged`              | DataChannel             | `{ id, peerConnectionId, state }` |
| `dataChannelReceiveMessage`            | DataChannel             | `{ id, peerConnectionId, data, type }` |
| `dataChannelDidChangeBufferedAmount`   | DataChannel             | `{ id, peerConnectionId, bufferedAmount }` |
| `mediaStreamTrackMuteChanged`          | VideoTrackAdapter       | `{ trackId, muted }`       |
| `mediaStreamTrackEnded`               | MediaStreamTrack        | `{ trackId }`              |
| `faceDetected`                         | FaceDetectionProcessor  | `FaceDetectionResult`       |
| `blinkDetected`                        | FaceDetectionProcessor  | `BlinkEvent`                |

### Event Relay Architecture

```
Native Module (iOS/Android)
  │  sendEvent / emit
  v
NativeEventEmitter(WebRTCModule)          // React Native built-in
  │  addListener for each of 16 events
  v
JS EventEmitter (react-native internal)   // Re-emission layer
  │
  v
Component Subscriptions                   // Per-listener lifecycle management
  addListener(listener, eventName, handler)
  removeListener(listener)
```

The relay layer (`src/EventEmitter.ts`) decouples native event subscriptions from component lifecycles. The `_subscriptions` Map tracks subscriptions per listener object for clean teardown.

---

## 12. Configuration System

### 12.1 Module-Level Configuration

**File:** `src/WebRTCModuleConfig.ts`

```typescript
interface WebRTCConfig {
    enableScreenCapture?: boolean;   // Default: true
    enableFaceDetection?: boolean;   // Default: false (opt-in for performance)
}
```

Call `configureWebRTC()` at app startup:
```typescript
import { configureWebRTC } from 'react-native-webrtc-face-detection';

configureWebRTC({
    enableFaceDetection: true,
});
```

Feature gating: `MediaStreamTrack.enableFaceDetection()` checks `isFeatureEnabled('enableFaceDetection')` and throws if disabled.

### 12.2 Per-Track Face Detection Config

Passed to `enableFaceDetection(config)` or to React hooks:

| Parameter      | Type    | Default         | Range       | Description                            |
|----------------|---------|-----------------|-------------|----------------------------------------|
| frameSkipCount | number  | 3               | 1+          | Process every Nth frame                |
| blinkThreshold | number  | 0.21 (iOS) / 0.3 (Android) | 0.0 - 1.0 | Eye open probability threshold |
| captureOnBlink | boolean | false           | -           | Enable frame capture on blink          |
| cropToFace     | boolean | true            | -           | Crop captured image to face bounds     |
| imageQuality   | number  | 0.7             | 0.0 - 1.0  | JPEG compression quality               |
| maxImageWidth  | number  | 480             | 1+          | Maximum capture image width (px)       |

### 12.3 Config Flow

```
JS: track.enableFaceDetection(config)
  → NativeModules.WebRTCModule.enableFaceDetection(trackId, config)
    → Native: FaceDetectionProcessor properties set
      → frameSkipCount, blinkThreshold, captureOnBlink, etc.
    → Native: processor.isEnabled = true
```

---

## 13. Build System

### 13.1 react-native-builder-bob

Builds the TypeScript source into three output formats:

| Target     | Output Directory     | Usage                              |
|------------|----------------------|------------------------------------|
| commonjs   | `lib/commonjs/`     | Node.js / Metro bundler (main)     |
| module     | `lib/module/`        | ES modules (module field)          |
| typescript | `lib/typescript/`    | Type declarations (.d.ts)          |

Source: `src/` → Output: `lib/`

### 13.2 TypeScript Configuration

```json
{
    "compilerOptions": {
        "target": "es6",
        "module": "commonjs",
        "strict": true,
        "jsx": "react-native",
        "moduleResolution": "node",
        "lib": ["es2015", "esnext"],
        "noImplicitAny": false,
        "esModuleInterop": true
    },
    "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

### 13.3 ESLint

**Config:** `src/.eslintrc.cjs`

- Parser: `@typescript-eslint/parser`
- Extends: `eslint:recommended`, `@typescript-eslint/recommended`
- Plugins: `@typescript-eslint`, `eslint-plugin-import`
- Key rules:
  - 4-space indentation
  - Single quotes
  - Semicolons required
  - Max line length: 120 characters
  - Import ordering: builtins/external → parent → sibling → index

### 13.4 Pre-commit Hooks

- **Husky v7:** Git hooks in `.husky/`
- **lint-staged:** `"**/*": "prettier --write --ignore-unknown"`
- Runs Prettier on all staged files before commit

### 13.5 CI/CD (GitHub Actions)

| Workflow          | Trigger          | Runner        | Steps                                      |
|-------------------|------------------|---------------|--------------------------------------------|
| `ci.yml`          | Pull requests    | ubuntu-latest | npm install → npm run lint                 |
| `android_ci.yml`  | Push/PR to master| ubuntu-latest | Java 17 → npm install → gradlew assembleDebug |
| `ios_ci.yml`      | Push/PR to master| macos-latest  | npm install → pod install → xcodebuild     |

### 13.6 NPM Scripts

| Script         | Command                                  | Purpose                   |
|----------------|------------------------------------------|---------------------------|
| `build`        | `bob build`                              | Build all targets         |
| `clean`        | `rm -rf lib`                             | Remove build output       |
| `lint`         | `eslint --max-warnings 0 . && tsc --noEmit` | Lint + type check     |
| `lintfix`      | `eslint --max-warnings 0 --fix . && tsc --noEmit` | Auto-fix + type check |
| `typecheck`    | `tsc --noEmit`                           | Type checking only        |
| `format`       | `tools/format.sh`                        | Run Prettier              |
| `prepare`      | `husky install && bob build`             | Post-install setup        |
| `prepublishOnly`| `npm run clean && npm run build`        | Pre-publish cleanup       |
| `release`      | `npm publish`                            | Publish to NPM            |

---

## 14. Platform Details

### 14.1 iOS

**Podspec:** `react-native-webrtc-face-detection.podspec`

| Setting            | Value                                |
|--------------------|--------------------------------------|
| iOS minimum        | 15.5 (required by Google ML Kit)     |
| macOS minimum      | 10.13                                |
| tvOS minimum       | 16.0                                 |
| WebRTC dependency  | JitsiWebRTC ~124.0.0                |
| ML Kit dependency  | GoogleMLKit/FaceDetection ~8.0.0    |
| Frameworks         | AudioToolbox, AVFoundation, CoreAudio, CoreGraphics, CoreVideo, GLKit, VideoToolbox |
| Libraries          | c, sqlite3, stdc++                   |

**Threading model:**
- Main module: `dispatch_queue_t workerQueue` (serial, QOS_CLASS_USER_INITIATED)
- Face detection: `dispatch_queue_create("com.webrtc.facedetection", DISPATCH_QUEUE_SERIAL)`
- Non-blocking: frames return immediately, processing async on serial queue

**Image conversion:**
- I420 → BGRA: `I420Converter` using Accelerate framework's `vImage`
- Pixel buffer → UIImage: `CIContext` for GPU-accelerated rendering
- Camera orientation: `UIImageOrientationRight` for MLKVisionImage

**System pressure handling:**
- KVO observer on `AVCaptureDevice.systemPressureState`
- Throttles to 15fps under pressure, resets when pressure drops

### 14.2 Android

**Build config:** `android/build.gradle`

| Setting            | Value                                      |
|--------------------|--------------------------------------------|
| compileSdkVersion  | 24                                         |
| minSdkVersion      | 24                                         |
| targetSdkVersion   | 24                                         |
| Java version       | 1.8                                        |
| WebRTC dependency  | org.jitsi:webrtc:124.+                    |
| ML Kit dependency  | com.google.mlkit:face-detection:16.1.6    |
| AndroidX           | androidx.core:core:1.7.0                  |

**Threading model:**
- Face detection: `HandlerThread("FaceDetectionThread")` with dedicated `Handler`
- Concurrent guard: `AtomicBoolean isProcessing`
- Non-blocking: `process()` returns frame immediately, detection runs on HandlerThread

**EGL context:**
- Separate `EglBase` context created for texture operations
- Independent from rendering EGL context to avoid conflicts
- `YuvConverter` uses this context for TextureBuffer → I420 conversion

**Buffer format conversion:**
- TextureBuffer → I420: `frame.getBuffer().toI420()` (synchronous)
- I420 → NV21: Manual conversion — copy Y plane, interleave V and U planes
- NV21 → InputImage: `InputImage.fromByteArray(nv21, width, height, rotation, NV21)`

**Video encoder/decoder:**
- Hardware: `HardwareVideoEncoderFactory` + `HardwareVideoDecoderFactory` (with EGL)
- Software fallback: `SoftwareVideoEncoderFactory` + `SoftwareVideoDecoderFactory`
- Combined: `DefaultVideoEncoderFactory` / `DefaultVideoDecoderFactory`

---

## 15. Performance Considerations

### Frame Skipping

The `frameSkipCount` parameter controls how many frames to skip between ML Kit processing calls. Higher values reduce CPU usage at the cost of detection latency.

| frameSkipCount | At 30fps camera | Effective detection rate |
|----------------|-----------------|------------------------|
| 1              | Every frame     | 30 detections/sec      |
| 2              | Every 2nd frame | 15 detections/sec      |
| 3 (default)    | Every 3rd frame | 10 detections/sec      |
| 5              | Every 5th frame | 6 detections/sec       |

### Non-Blocking Design

Both platforms return the original frame immediately to the rendering pipeline. Face detection runs asynchronously:
- **iOS:** `dispatch_async` to serial GCD queue
- **Android:** `Handler.post` to dedicated HandlerThread

This ensures face detection never drops video frames or adds rendering latency.

### Concurrent Processing Guard

Both platforms prevent overlapping ML Kit calls:
- **iOS:** `BOOL isProcessing` flag checked before dispatch
- **Android:** `AtomicBoolean isProcessing` with compare-and-set

If a previous detection is still running when a new frame arrives, the frame is skipped.

### Memory Management

- **iOS:** `CVPixelBufferRetain` / `CVPixelBufferRelease` for safe async buffer access
- **Android:** `frame.retain()` / `frame.release()` to prevent GC during async processing; NV21 byte arrays are copied (not referenced) for safe async use

### Image Conversion Cost

The most expensive operations in the pipeline:
- **iOS:** I420 → BGRA conversion via Accelerate vImage (only for I420 input frames)
- **Android:** TextureBuffer → I420 → NV21 conversion (involves GPU readback + format interleaving)

For camera input, iOS typically receives `RTCCVPixelBuffer` (fast path — no conversion needed), while Android may receive `TextureBuffer` (requires full conversion pipeline).

### Battery Optimization

To reduce battery drain:
- Increase `frameSkipCount` (fewer ML Kit calls per second)
- Disable `captureOnBlink` when not needed (avoids JPEG encoding overhead)
- Disable face detection entirely when not in use (`disable()` or `disableFaceDetection()`)
- Use `useFaceDetection`/`useBlinkDetection` hooks which auto-disable on component unmount

### Image Adjustment & Smoothing Performance

| Component | Operation | Typical Time (720p) | Typical Time (1080p) | Backend |
|-----------|-----------|-------------------|--------------------|---------|
| **LUTs**  | Tone Mapping | ~1.5ms | ~3.5ms | CPU |
| **Bilateral** | 1 iteration | ~1.0ms | ~3.0ms | GPU (Metal/GLES) |
| **Bilateral** | 3 iterations | ~3.0ms | ~9.0ms | GPU (Metal/GLES) |
| **Bilateral** | 8 iterations | ~8.0ms | ~24.0ms | GPU (Metal/GLES) |
| **Chroma** | 3x3 Blur | < 0.1ms | < 0.2ms | CPU |

**Optimizations:**
- **Zero-Copy GPU Path:** On iOS, bilateral smoothing runs as a Metal Compute shader. On Android, it runs via OpenGL ES fragment shaders. Both use zero-copy texture bindings when possible.
- **Scratch Buffer Re-use:** To avoid memory fragmentation and `malloc` overhead at 30fps, both platforms use persistent, pre-allocated scratch buffers that only resize when the input resolution changes.
- **GL State Isolation (Android):** Uses `GlStateRestore` to ensure our internal GLES passes don't leak state (bindings, viewports, etc.) into the shared WebRTC context.
