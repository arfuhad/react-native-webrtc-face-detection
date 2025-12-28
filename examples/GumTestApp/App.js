/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 * @flow strict-local
 */

import React, {useState, useRef, useEffect} from 'react';
import {
  Button,
  SafeAreaView,
  StyleSheet,
  View,
  Text,
  StatusBar,
  ScrollView,
} from 'react-native';
import { Colors } from 'react-native/Libraries/NewAppScreen';
import {
  mediaDevices,
  startIOSPIP,
  stopIOSPIP,
  RTCPIPView,
  configureWebRTC,
  useFaceDetection,
  useBlinkDetection,
} from 'react-native-webrtc';


const App = () => {
  const view = useRef()
  const [stream, setStream] = useState(null);
  const [videoTrack, setVideoTrack] = useState(null);
  
  // Configure WebRTC to enable face detection
  useEffect(() => {
    configureWebRTC({
      enableFaceDetection: true,
      enableScreenCapture: true,
    });
  }, []);

  // Face detection hooks
  const { detectionResult, isEnabled: faceDetectionEnabled, enable: enableFaceDetection, disable: disableFaceDetection } = useFaceDetection(videoTrack);
  const { blinkCount, lastBlinkTime, resetCount, isEnabled: blinkDetectionEnabled, enable: enableBlinkDetection, disable: disableBlinkDetection, getBlinkRate } = useBlinkDetection(videoTrack);

  const start = async () => {
    console.log('start');
    if (!stream) {
      try {
        const s = await mediaDevices.getUserMedia({ video: true });
        setStream(s);
        const track = s.getVideoTracks()[0];
        setVideoTrack(track);
      } catch(e) {
        console.error(e);
      }
    }
  };

  const startPIP = () => {
    startIOSPIP(view);
  };

  const stopPIP = () => {
    stopIOSPIP(view);
  };

  const stop = () => {
    console.log('stop');
    if (stream) {
      stream.release();
      setStream(null);
      setVideoTrack(null);
    }
  };

  const toggleFaceDetection = async () => {
    if (faceDetectionEnabled) {
      await disableFaceDetection();
    } else {
      await enableFaceDetection();
    }
  };

  const toggleBlinkDetection = async () => {
    if (blinkDetectionEnabled) {
      await disableBlinkDetection();
    } else {
      await enableBlinkDetection();
    }
  };
  let pipOptions = {
    startAutomatically: true,
    fallbackView: (<View style={{ height: 50, width: 50, backgroundColor: 'red' }} />),
    preferredSize: {
      width: 400,
      height: 800,
    }
  }

  return (
    <>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={styles.body}>
        {
          stream &&
          <RTCPIPView
              ref={view}
              streamURL={stream.toURL()}
              style={styles.stream}
              iosPIP={pipOptions} >
          </RTCPIPView>
        }
        
        {/* Face Detection Info */}
        {stream && (
          <View style={styles.infoPanel}>
            <ScrollView>
              <Text style={styles.infoTitle}>Face Detection Demo</Text>
              
              <Text style={styles.infoText}>
                Face Detection: {faceDetectionEnabled ? '✅ ON' : '❌ OFF'}
              </Text>
              
              {detectionResult && (
                <>
                  <Text style={styles.infoText}>
                    Faces Detected: {detectionResult.faces.length}
                  </Text>
                  {detectionResult.faces.map((face, index) => (
                    <View key={index} style={styles.faceInfo}>
                      <Text style={styles.infoText}>
                        Face {index + 1}:
                      </Text>
                      <Text style={styles.infoSubText}>
                        • Confidence: {(face.confidence * 100).toFixed(1)}%
                      </Text>
                      <Text style={styles.infoSubText}>
                        • Left Eye: {face.landmarks?.leftEye?.isOpen ? '👁️ Open' : '😑 Closed'} 
                        ({(face.landmarks?.leftEye?.openProbability * 100).toFixed(0)}%)
                      </Text>
                      <Text style={styles.infoSubText}>
                        • Right Eye: {face.landmarks?.rightEye?.isOpen ? '👁️ Open' : '😑 Closed'}
                        ({(face.landmarks?.rightEye?.openProbability * 100).toFixed(0)}%)
                      </Text>
                      {face.landmarks?.leftEye && (
                        <Text style={styles.infoSubText}>
                          • Left Eye Blinks: {face.landmarks.leftEye.blinkCount}
                        </Text>
                      )}
                      {face.landmarks?.rightEye && (
                        <Text style={styles.infoSubText}>
                          • Right Eye Blinks: {face.landmarks.rightEye.blinkCount}
                        </Text>
                      )}
                    </View>
                  ))}
                </>
              )}
              
              <Text style={styles.infoText}>
                Total Blinks: {blinkCount}
              </Text>
              
              {lastBlinkTime && (
                <Text style={styles.infoText}>
                  Last Blink: {new Date(lastBlinkTime).toLocaleTimeString()}
                </Text>
              )}
              
              {blinkCount > 0 && (
                <Text style={styles.infoText}>
                  Blink Rate: {getBlinkRate().toFixed(1)} blinks/min
                </Text>
              )}
            </ScrollView>
          </View>
        )}

        <View style={styles.footer}>
          <Button title="Start Camera" onPress={start} />
          <Button title="Stop Camera" onPress={stop} />
          {stream && (
            <>
              <Button
                title={faceDetectionEnabled ? "Disable Face Detection" : "Enable Face Detection"}
                onPress={toggleFaceDetection}
              />
              <Button
                title={blinkDetectionEnabled ? "Disable Blink Detection" : "Enable Blink Detection"}
                onPress={toggleBlinkDetection}
              />
              {blinkCount > 0 && (
                <Button title="Reset Blink Count" onPress={resetCount} />
              )}
              <Button title="Start PIP" onPress={startPIP} />
              <Button title="Stop PIP" onPress={stopPIP} />
            </>
          )}
        </View>
      </SafeAreaView>
    </>
  );
};

const styles = StyleSheet.create({
  body: {
    backgroundColor: Colors.white,
    ...StyleSheet.absoluteFill
  },
  stream: {
    flex: 1
  },
  infoPanel: {
    position: 'absolute',
    top: 50,
    left: 10,
    right: 10,
    maxHeight: 300,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 10,
    padding: 15,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
  },
  infoText: {
    fontSize: 14,
    color: '#fff',
    marginVertical: 3,
  },
  infoSubText: {
    fontSize: 12,
    color: '#ccc',
    marginLeft: 10,
    marginVertical: 2,
  },
  faceInfo: {
    borderLeftWidth: 2,
    borderLeftColor: '#4CAF50',
    paddingLeft: 10,
    marginVertical: 5,
  },
  footer: {
    backgroundColor: Colors.lighter,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 5,
  },
});

export default App;
