# Face Detection Guide

React Native WebRTC now includes comprehensive face detection and eye tracking capabilities, including blink detection, powered by native ML frameworks (iOS Vision Framework and Android ML Kit).

## Table of Contents

- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [React Hooks](#react-hooks)
- [Examples](#examples)
- [Performance Optimization](#performance-optimization)
- [Platform Considerations](#platform-considerations)
- [Troubleshooting](#troubleshooting)

## Getting Started

### 1. Enable Face Detection

Face detection is opt-in for performance reasons. Enable it at app startup:

```javascript
import { configureWebRTC } from 'react-native-webrtc';

// At app initialization
configureWebRTC({
  enableFaceDetection: true,
});
```

### 2. Basic Usage with Hooks

The simplest way to use face detection is with the provided React hooks:

```javascript
import { useState, useEffect } from 'react';
import { mediaDevices, useFaceDetection, RTCView } from 'react-native-webrtc';

function MyComponent() {
  const [stream, setStream] = useState(null);
  const videoTrack = stream?.getVideoTracks()[0];
  
  const { detectionResult, enable, disable } = useFaceDetection(videoTrack);

  useEffect(() => {
    // Get camera stream
    mediaDevices.getUserMedia({ video: true })
      .then(setStream);
  }, []);

  useEffect(() => {
    if (videoTrack) {
      enable();
      return () => disable();
    }
  }, [videoTrack]);

  return (
    <View>
      {stream && (
        <RTCView streamURL={stream.toURL()} style={{ flex: 1 }} />
      )}
      {detectionResult && (
        <Text>Detected {detectionResult.faces.length} faces</Text>
      )}
    </View>
  );
}
```

## Configuration

### Module Configuration

```javascript
import { configureWebRTC } from 'react-native-webrtc';

configureWebRTC({
  enableFaceDetection: true,  // Enable face detection features
  enableScreenCapture: false, // Optionally disable screen capture
});
```

### Face Detection Configuration

Configure face detection behavior per track:

```javascript
const config = {
  frameSkipCount: 3,      // Process every 3rd frame (default: 3)
  blinkThreshold: 0.21,   // Eye aspect ratio threshold for blinks (default: 0.21 iOS, 0.3 Android)
};

await videoTrack.enableFaceDetection(config);
```

## API Reference

### MediaStreamTrack Methods

#### `enableFaceDetection(config?)`

Enable face detection on a video track.

```javascript
await videoTrack.enableFaceDetection({
  frameSkipCount: 3,
  blinkThreshold: 0.21,
});
```

**Parameters:**
- `config` (optional): Configuration object
  - `frameSkipCount`: Process every Nth frame (default: 3)
  - `blinkThreshold`: Threshold for blink detection (default: 0.21 iOS, 0.3 Android)

**Returns:** Promise<void>

**Throws:** Error if face detection is disabled in module config or track is not a video track

#### `disableFaceDetection()`

Disable face detection on a video track.

```javascript
await videoTrack.disableFaceDetection();
```

**Returns:** Promise<void>

#### `isFaceDetectionEnabled`

Check if face detection is currently enabled.

```javascript
if (videoTrack.isFaceDetectionEnabled) {
  console.log('Face detection is active');
}
```

**Returns:** boolean

### Event Listeners

#### `facedetected` Event

Fired when faces are detected in a frame.

```javascript
videoTrack.addEventListener('facedetected', (event) => {
  const { faces, timestamp, frameWidth, frameHeight } = event.detail;
  console.log(`Detected ${faces.length} faces at ${timestamp}`);
});
```

#### `blinkdetected` Event

Fired when a blink is detected.

```javascript
videoTrack.addEventListener('blinkdetected', (event) => {
  const { timestamp, eye, trackingId } = event.detail;
  console.log(`Blink detected at ${timestamp}`);
});
```

## React Hooks

### useFaceDetection

Hook for comprehensive face detection.

```javascript
const {
  detectionResult,  // Latest detection result
  isEnabled,        // Whether detection is active
  enable,           // Enable detection function
  disable,          // Disable detection function
  error,            // Any error that occurred
} = useFaceDetection(videoTrack, config);
```

**Example:**

```javascript
function FaceDetectionComponent() {
  const [stream, setStream] = useState(null);
  const videoTrack = stream?.getVideoTracks()[0];
  
  const { detectionResult, isEnabled, enable, disable } = useFaceDetection(videoTrack);

  useEffect(() => {
    enable();
    return () => disable();
  }, [videoTrack]);

  return (
    <View>
      {detectionResult?.faces.map((face, index) => (
        <View key={index}>
          <Text>Face {index + 1}:</Text>
          <Text>Confidence: {(face.confidence * 100).toFixed(1)}%</Text>
          <Text>Left Eye: {face.landmarks.leftEye.isOpen ? 'Open' : 'Closed'}</Text>
          <Text>Right Eye: {face.landmarks.rightEye.isOpen ? 'Open' : 'Closed'}</Text>
        </View>
      ))}
    </View>
  );
}
```

### useBlinkDetection

Hook specifically for blink detection and tracking.

```javascript
const {
  blinkCount,       // Total blinks detected
  lastBlinkTime,    // Timestamp of last blink
  recentBlinks,     // Array of recent blink events
  isEnabled,        // Whether detection is active
  enable,           // Enable detection function
  disable,          // Disable detection function
  resetCount,       // Reset blink counter
  getBlinkRate,     // Get blinks per minute
  error,            // Any error that occurred
} = useBlinkDetection(videoTrack, config);
```

**Example:**

```javascript
function BlinkCounter() {
  const [stream, setStream] = useState(null);
  const videoTrack = stream?.getVideoTracks()[0];
  
  const {
    blinkCount,
    lastBlinkTime,
    getBlinkRate,
    enable,
    resetCount,
  } = useBlinkDetection(videoTrack);

  useEffect(() => {
    enable();
  }, [videoTrack]);

  return (
    <View>
      <Text>Total Blinks: {blinkCount}</Text>
      <Text>Blink Rate: {getBlinkRate().toFixed(1)} blinks/min</Text>
      {lastBlinkTime && (
        <Text>Last Blink: {new Date(lastBlinkTime).toLocaleTimeString()}</Text>
      )}
      <Button title="Reset" onPress={resetCount} />
    </View>
  );
}
```

## Examples

### Complete Example with All Features

```javascript
import React, { useState, useEffect } from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import {
  mediaDevices,
  RTCView,
  useFaceDetection,
  useBlinkDetection,
  configureWebRTC,
} from 'react-native-webrtc';

// Configure at app startup
configureWebRTC({ enableFaceDetection: true });

function FaceDetectionDemo() {
  const [stream, setStream] = useState(null);
  const videoTrack = stream?.getVideoTracks()[0];

  const faceDetection = useFaceDetection(videoTrack, {
    frameSkipCount: 3,
  });

  const blinkDetection = useBlinkDetection(videoTrack);

  useEffect(() => {
    // Get camera
    mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      .then(setStream)
      .catch(console.error);

    return () => {
      stream?.release();
    };
  }, []);

  const toggleFaceDetection = async () => {
    if (faceDetection.isEnabled) {
      await faceDetection.disable();
    } else {
      await faceDetection.enable();
    }
  };

  const toggleBlinkDetection = async () => {
    if (blinkDetection.isEnabled) {
      await blinkDetection.disable();
    } else {
      await blinkDetection.enable();
    }
  };

  return (
    <View style={styles.container}>
      {stream && (
        <RTCView
          streamURL={stream.toURL()}
          style={styles.video}
          mirror={true}
        />
      )}

      <View style={styles.overlay}>
        <Text style={styles.title}>Face Detection Demo</Text>

        {/* Face Detection Info */}
        {faceDetection.detectionResult && (
          <View>
            <Text style={styles.text}>
              Faces: {faceDetection.detectionResult.faces.length}
            </Text>
            {faceDetection.detectionResult.faces.map((face, i) => (
              <View key={i} style={styles.faceInfo}>
                <Text style={styles.text}>Face {i + 1}:</Text>
                <Text style={styles.subText}>
                  Confidence: {(face.confidence * 100).toFixed(0)}%
                </Text>
                <Text style={styles.subText}>
                  Left Eye: {face.landmarks.leftEye.isOpen ? '👁️' : '😑'}
                  ({(face.landmarks.leftEye.openProbability * 100).toFixed(0)}%)
                </Text>
                <Text style={styles.subText}>
                  Right Eye: {face.landmarks.rightEye.isOpen ? '👁️' : '😑'}
                  ({(face.landmarks.rightEye.openProbability * 100).toFixed(0)}%)
                </Text>
                {face.headPose && (
                  <>
                    <Text style={styles.subText}>
                      Yaw: {face.headPose.yaw.toFixed(1)}°
                    </Text>
                    <Text style={styles.subText}>
                      Pitch: {face.headPose.pitch.toFixed(1)}°
                    </Text>
                  </>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Blink Detection Info */}
        <View style={styles.blinkInfo}>
          <Text style={styles.text}>
            Blinks: {blinkDetection.blinkCount}
          </Text>
          <Text style={styles.text}>
            Rate: {blinkDetection.getBlinkRate().toFixed(1)} /min
          </Text>
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          <Button
            title={faceDetection.isEnabled ? 'Disable Face' : 'Enable Face'}
            onPress={toggleFaceDetection}
          />
          <Button
            title={blinkDetection.isEnabled ? 'Disable Blink' : 'Enable Blink'}
            onPress={toggleBlinkDetection}
          />
          <Button
            title="Reset Blinks"
            onPress={blinkDetection.resetCount}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  video: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 50,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 15,
    borderRadius: 10,
  },
  title: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 10 },
  text: { fontSize: 14, color: '#fff', marginVertical: 2 },
  subText: { fontSize: 12, color: '#ccc', marginLeft: 10 },
  faceInfo: { borderLeftWidth: 2, borderLeftColor: '#4CAF50', paddingLeft: 10, marginVertical: 5 },
  blinkInfo: { marginTop: 10, borderTopWidth: 1, borderTopColor: '#555', paddingTop: 10 },
  controls: { marginTop: 15, gap: 10 },
});

export default FaceDetectionDemo;
```

## Performance Optimization

### Frame Processing Rate

By default, face detection processes every 3rd frame. Adjust based on your needs:

```javascript
// More frequent detection (higher CPU usage)
await videoTrack.enableFaceDetection({ frameSkipCount: 1 });

// Less frequent detection (lower CPU usage)
await videoTrack.enableFaceDetection({ frameSkipCount: 5 });
```

### Best Practices

1. **Enable only when needed**: Turn off face detection when not in use
2. **Choose appropriate frame rate**: Balance accuracy vs performance
3. **Use local tracks only**: Face detection works on local video tracks only
4. **Handle errors gracefully**: Wrap detection calls in try-catch blocks
5. **Clean up on unmount**: Always disable detection when component unmounts

```javascript
useEffect(() => {
  if (videoTrack) {
    enable();
    return () => disable(); // Cleanup
  }
}, [videoTrack]);
```

### Performance Tips

- **iOS**: Uses Vision framework with hardware acceleration
- **Android**: Uses ML Kit with Google Play Services
- **Memory**: Keep frameSkipCount at 3 or higher for optimal memory usage
- **Battery**: Higher frameSkipCount = better battery life

## Platform Considerations

### iOS (Vision Framework)

- **Requirements**: iOS 11.0+
- **Accuracy**: High accuracy with facial landmarks
- **Blink Detection**: Uses Eye Aspect Ratio (EAR) algorithm
- **Performance**: Hardware-accelerated on A-series chips
- **Privacy**: All processing is on-device

### Android (ML Kit)

- **Requirements**: Android 5.0+ (API 21+)
- **Accuracy**: High accuracy with ML Kit's ACCURATE mode
- **Blink Detection**: Uses eye open probability (0.0 - 1.0)
- **Performance**: Optimized with Google Play Services
- **Dependency**: Requires Google Play Services

### Detection Differences

| Feature | iOS | Android |
|---------|-----|---------|
| Face Detection | ✅ | ✅ |
| Eye Landmarks | ✅ | ✅ |
| Blink Detection | ✅ (EAR) | ✅ (Probability) |
| Head Pose | ✅ | ✅ |
| Multiple Faces | ✅ | ✅ |
| Face Tracking | ✅ | ✅ |

## Troubleshooting

### Face Detection Not Working

**Problem**: `enableFaceDetection()` throws an error

**Solution**: Ensure face detection is enabled in module config:
```javascript
configureWebRTC({ enableFaceDetection: true });
```

### No Faces Detected

**Possible causes:**
1. Poor lighting conditions
2. Face partially out of frame
3. Camera not facing user
4. frameSkipCount too high

**Solutions:**
- Improve lighting
- Ensure face is fully visible
- Use front camera: `{ video: { facingMode: 'user' } }`
- Lower frameSkipCount

### High CPU Usage

**Problem**: App is slow or battery drains quickly

**Solution**: Increase frameSkipCount:
```javascript
await videoTrack.enableFaceDetection({ frameSkipCount: 5 });
```

### Blinks Not Detected

**Problem**: Blink count stays at 0

**Causes:**
1. Threshold too sensitive
2. Eyes not fully closing
3. Detection not enabled

**Solutions:**
- Adjust blink threshold (lower = more sensitive)
- Ensure proper lighting
- Verify detection is enabled: `isEnabled === true`

### Android Build Errors

**Problem**: ML Kit dependency issues

**Solution**: Ensure Google Play Services is available:
```gradle
dependencies {
    implementation 'com.google.mlkit:face-detection:16.1.6'
}
```

### iOS Build Errors

**Problem**: Vision framework not found

**Solution**: Ensure minimum iOS version is set to 11.0+ in Podfile:
```ruby
platform :ios, '11.0'
```

## Additional Resources

- [iOS Vision Framework Documentation](https://developer.apple.com/documentation/vision)
- [Android ML Kit Face Detection](https://developers.google.com/ml-kit/vision/face-detection)
- [Basic Usage Guide](./BasicUsage.md)
- [Example App](../examples/GumTestApp/App.js)

## Support

For issues, questions, or feature requests, please visit:
- [GitHub Issues](https://github.com/react-native-webrtc/react-native-webrtc/issues)
- [Discourse Community](https://react-native-webrtc.discourse.group/)

