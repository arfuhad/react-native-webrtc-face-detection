import { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TextInput } from 'react-native';
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  RTCView,
  MediaStream,
  MediaStreamTrack,
  useFaceDetection,
  useBlinkDetection,
} from 'react-native-webrtc';
import { io, Socket } from 'socket.io-client';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { StatusIndicator } from '@/components/StatusIndicator';
import { colors, spacing, borderRadius } from '@/constants/theme';

const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
type CallStatus = 'idle' | 'searching' | 'paired' | 'connecting' | 'connected';

export default function VideoCallScreen() {
  // Server connection
  const [serverUrl, setServerUrl] = useState('http://localhost:3000');
  const [serverStatus, setServerStatus] = useState<ConnectionStatus>('disconnected');
  const socketRef = useRef<Socket | null>(null);

  // Peer connection
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const [peerId, setPeerId] = useState<string | null>(null);
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [connectionState, setConnectionState] = useState<string>('new');

  // Media streams
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [videoTrack, setVideoTrack] = useState<MediaStreamTrack | null>(null);

  // ICE candidates queue (for candidates received before remote description is set)
  const iceCandidatesQueue = useRef<RTCIceCandidate[]>([]);
  const isNegotiating = useRef(false);

  // Face detection hook
  const {
    detectionResult,
    isEnabled: faceDetectionEnabled,
    enable: enableFaceDetection,
    disable: disableFaceDetection,
  } = useFaceDetection(videoTrack);

  // Blink detection hook
  const {
    blinkCount,
    lastBlinkTime,
    resetCount,
    isEnabled: blinkDetectionEnabled,
    enable: enableBlinkDetection,
    disable: disableBlinkDetection,
    getBlinkRate,
  } = useBlinkDetection(videoTrack);

  // Create peer connection
  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection(configuration);

    pc.addEventListener('connectionstatechange', () => {
      setConnectionState(pc.connectionState);
      if (pc.connectionState === 'connected') {
        setCallStatus('connected');
      } else if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        setCallStatus('idle');
      }
    });

    pc.addEventListener('icecandidate', (event) => {
      if (event.candidate && socketRef.current && peerId) {
        socketRef.current.emit('ice-candidate', {
          candidate: event.candidate,
          to: peerId,
        });
      }
    });

    pc.addEventListener('track', (event) => {
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      }
    });

    return pc;
  }, [peerId]);

  // Handle incoming offer
  const handleOffer = useCallback(async (data: { offer: RTCSessionDescription; from: string }) => {
    try {
      setPeerId(data.from);
      
      const pc = createPeerConnection();
      peerConnectionRef.current = pc;

      // Add local stream tracks
      if (localStream) {
        localStream.getTracks().forEach(track => {
          pc.addTrack(track, localStream);
        });
      }

      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

      // Process queued ICE candidates
      while (iceCandidatesQueue.current.length > 0) {
        const candidate = iceCandidatesQueue.current.shift();
        if (candidate) {
          await pc.addIceCandidate(candidate);
        }
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socketRef.current?.emit('answer', {
        answer: answer,
        to: data.from,
      });

      setCallStatus('connecting');
    } catch (error) {
      console.error('Error handling offer:', error);
      Alert.alert('Error', 'Failed to handle incoming call');
    }
  }, [localStream, createPeerConnection]);

  // Handle incoming answer
  const handleAnswer = useCallback(async (data: { answer: RTCSessionDescription; from: string }) => {
    try {
      const pc = peerConnectionRef.current;
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        
        // Process queued ICE candidates
        while (iceCandidatesQueue.current.length > 0) {
          const candidate = iceCandidatesQueue.current.shift();
          if (candidate) {
            await pc.addIceCandidate(candidate);
          }
        }
      }
    } catch (error) {
      console.error('Error handling answer:', error);
    }
  }, []);

  // Handle incoming ICE candidate
  const handleIceCandidate = useCallback(async (data: { candidate: RTCIceCandidate; from: string }) => {
    try {
      const pc = peerConnectionRef.current;
      if (pc && pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } else {
        // Queue the candidate for later
        iceCandidatesQueue.current.push(new RTCIceCandidate(data.candidate));
      }
    } catch (error) {
      console.error('Error handling ICE candidate:', error);
    }
  }, []);

  // Handle paired event
  const handlePaired = useCallback(async (data: { peerId: string; initiator: boolean }) => {
    try {
      setPeerId(data.peerId);
      setCallStatus('paired');

      if (data.initiator) {
        // We are the initiator, create offer
        const pc = createPeerConnection();
        peerConnectionRef.current = pc;

        // Add local stream tracks
        if (localStream) {
          localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
          });
        }

        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await pc.setLocalDescription(offer);

        socketRef.current?.emit('offer', {
          offer: offer,
          to: data.peerId,
        });

        setCallStatus('connecting');
      }
    } catch (error) {
      console.error('Error handling paired event:', error);
      Alert.alert('Error', 'Failed to establish connection');
    }
  }, [localStream, createPeerConnection]);

  // Handle peer disconnected
  const handlePeerDisconnected = useCallback(() => {
    // Clean up peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    setRemoteStream(null);
    setPeerId(null);
    setCallStatus('idle');
    setConnectionState('new');
    iceCandidatesQueue.current = [];
  }, []);

  // Connect to signaling server
  const connectToServer = useCallback(async () => {
    if (serverStatus === 'connected') return;

    setServerStatus('connecting');

    try {
      // Get local media first
      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });
      setLocalStream(stream);

      const track = stream.getVideoTracks()[0];
      if (track) {
        setVideoTrack(track);
      }

      // Connect to socket
      const socket = io(serverUrl, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 5,
      });

      socket.on('connect', () => {
        setServerStatus('connected');
      });

      socket.on('disconnect', () => {
        setServerStatus('disconnected');
        handlePeerDisconnected();
      });

      socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
        setServerStatus('error');
        Alert.alert('Connection Error', 'Failed to connect to signaling server');
      });

      socket.on('paired', handlePaired);
      socket.on('offer', handleOffer);
      socket.on('answer', handleAnswer);
      socket.on('ice-candidate', handleIceCandidate);
      socket.on('peer-disconnected', handlePeerDisconnected);

      socketRef.current = socket;
    } catch (error) {
      console.error('Failed to connect:', error);
      setServerStatus('error');
      Alert.alert('Error', 'Failed to access camera or connect to server');
    }
  }, [serverUrl, serverStatus, handlePaired, handleOffer, handleAnswer, handleIceCandidate, handlePeerDisconnected]);

  // Disconnect from server
  const disconnectFromServer = useCallback(async () => {
    // Disable detection
    if (faceDetectionEnabled) {
      await disableFaceDetection();
    }
    if (blinkDetectionEnabled) {
      await disableBlinkDetection();
    }

    // Clean up peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Disconnect socket
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    // Stop local stream
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream.release();
      // Clear the ref immediately to prevent double-release from cleanup
      localStreamRef.current = null;
      setLocalStream(null);
      setVideoTrack(null);
    }

    setRemoteStream(null);
    setPeerId(null);
    setServerStatus('disconnected');
    setCallStatus('idle');
    setConnectionState('new');
    iceCandidatesQueue.current = [];
  }, [localStream, faceDetectionEnabled, blinkDetectionEnabled, disableFaceDetection, disableBlinkDetection]);

  // Find a peer
  const findPeer = useCallback(() => {
    if (socketRef.current && serverStatus === 'connected') {
      setCallStatus('searching');
      socketRef.current.emit('find-peer');
    }
  }, [serverStatus]);

  // Find next peer
  const nextPeer = useCallback(() => {
    if (socketRef.current && serverStatus === 'connected') {
      // Clean up current connection
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      setRemoteStream(null);
      iceCandidatesQueue.current = [];
      
      setCallStatus('searching');
      socketRef.current.emit('next-peer');
    }
  }, [serverStatus]);

  // Toggle face detection
  const toggleFaceDetection = useCallback(async () => {
    if (faceDetectionEnabled) {
      await disableFaceDetection();
    } else {
      await enableFaceDetection();
    }
  }, [faceDetectionEnabled, enableFaceDetection, disableFaceDetection]);

  // Toggle blink detection
  const toggleBlinkDetection = useCallback(async () => {
    if (blinkDetectionEnabled) {
      await disableBlinkDetection();
    } else {
      await enableBlinkDetection();
    }
  }, [blinkDetectionEnabled, enableBlinkDetection, disableBlinkDetection]);

  // Use a ref to track stream for cleanup to avoid stale closure
  const localStreamRef = useRef<MediaStream | null>(null);
  
  // Keep ref in sync with state
  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      // Use ref to get current stream value (avoids stale closure)
      const stream = localStreamRef.current;
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream.release();
        localStreamRef.current = null;
      }
    };
  }, []);

  const facesDetected = detectionResult?.faces?.length ?? 0;
  const blinkRate = blinkCount > 0 ? getBlinkRate() : 0;

  const getStatusColor = (status: string): 'success' | 'warning' | 'error' | 'info' => {
    switch (status) {
      case 'connected':
        return 'success';
      case 'connecting':
      case 'searching':
      case 'paired':
        return 'warning';
      case 'disconnected':
      case 'error':
      case 'idle':
        return 'error';
      default:
        return 'info';
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Server Connection */}
      <Card style={styles.serverCard}>
        <Text style={styles.sectionTitle}>Signaling Server</Text>
        <View style={styles.serverInputRow}>
          <TextInput
            style={styles.serverInput}
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="http://localhost:3000"
            placeholderTextColor={colors.textMuted}
            editable={serverStatus === 'disconnected'}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <Button
          title={serverStatus === 'connected' ? 'Disconnect' : serverStatus === 'connecting' ? 'Connecting...' : 'Connect'}
          onPress={serverStatus === 'connected' ? disconnectFromServer : connectToServer}
          variant={serverStatus === 'connected' ? 'danger' : 'primary'}
          disabled={serverStatus === 'connecting'}
        />
      </Card>

      {/* Peer Controls */}
      {serverStatus === 'connected' && (
        <Card style={styles.controlsCard}>
          <Text style={styles.sectionTitle}>Peer Matching</Text>
          <View style={styles.buttonRow}>
            <Button
              title="Find Peer"
              onPress={findPeer}
              variant="primary"
              style={styles.flexButton}
              disabled={callStatus !== 'idle'}
            />
            <Button
              title="Next Peer"
              onPress={nextPeer}
              variant="secondary"
              style={styles.flexButton}
              disabled={callStatus === 'idle' || callStatus === 'searching'}
            />
          </View>
        </Card>
      )}

      {/* Video Previews */}
      <View style={styles.videoContainer}>
        <Card style={styles.videoCard}>
          <Text style={styles.videoLabel}>Local</Text>
          <View style={styles.videoWrapper}>
            {localStream ? (
              <RTCView
                streamURL={localStream.toURL()}
                style={styles.video}
                objectFit="cover"
                mirror={true}
              />
            ) : (
              <View style={styles.placeholder}>
                <Text style={styles.placeholderText}>No Stream</Text>
              </View>
            )}
            {/* Face detection overlay */}
            {faceDetectionEnabled && facesDetected > 0 && (
              <View style={styles.faceOverlay}>
                <Text style={styles.faceCount}>{facesDetected}</Text>
              </View>
            )}
          </View>
        </Card>

        <Card style={styles.videoCard}>
          <Text style={styles.videoLabel}>Remote</Text>
          {remoteStream ? (
            <RTCView
              streamURL={remoteStream.toURL()}
              style={styles.video}
              objectFit="cover"
            />
          ) : (
            <View style={styles.placeholder}>
              <Text style={styles.placeholderText}>
                {callStatus === 'searching' ? 'Searching...' : 'No Peer'}
              </Text>
            </View>
          )}
        </Card>
      </View>

      {/* Connection Status */}
      <Card style={styles.statusCard}>
        <Text style={styles.sectionTitle}>Connection Status</Text>
        <StatusIndicator
          label="Server"
          value={serverStatus}
          status={getStatusColor(serverStatus)}
        />
        <StatusIndicator
          label="Peer"
          value={peerId ? peerId.substring(0, 12) + '...' : 'None'}
          status={peerId ? 'success' : 'info'}
        />
        <StatusIndicator
          label="Call"
          value={callStatus}
          status={getStatusColor(callStatus)}
        />
        <StatusIndicator
          label="WebRTC"
          value={connectionState}
          status={getStatusColor(connectionState)}
        />
      </Card>

      {/* Detection Controls */}
      {localStream && (
        <Card style={styles.controlsCard}>
          <Text style={styles.sectionTitle}>Face Detection (Local)</Text>
          <View style={styles.buttonColumn}>
            <Button
              title={faceDetectionEnabled ? 'Disable Face Detection' : 'Enable Face Detection'}
              onPress={toggleFaceDetection}
              variant={faceDetectionEnabled ? 'secondary' : 'outline'}
            />
            <Button
              title={blinkDetectionEnabled ? 'Disable Blink Detection' : 'Enable Blink Detection'}
              onPress={toggleBlinkDetection}
              variant={blinkDetectionEnabled ? 'secondary' : 'outline'}
            />
            {blinkCount > 0 && (
              <Button
                title="Reset Blink Count"
                onPress={resetCount}
                variant="secondary"
              />
            )}
          </View>
        </Card>
      )}

      {/* Face Details */}
      {detectionResult && detectionResult.faces && detectionResult.faces.length > 0 && (
        <Card style={styles.facesCard}>
          <Text style={styles.sectionTitle}>Face Details</Text>
          {detectionResult.faces.map((face, index) => (
            <View key={index} style={styles.faceDetails}>
              <Text style={styles.faceTitle}>Face {index + 1}</Text>
              
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Confidence:</Text>
                <View style={styles.progressBar}>
                  <View 
                    style={[
                      styles.progressFill, 
                      { width: `${(face.confidence ?? 0) * 100}%` }
                    ]} 
                  />
                </View>
                <Text style={styles.detailValue}>
                  {((face.confidence ?? 0) * 100).toFixed(1)}%
                </Text>
              </View>

              {face.landmarks?.leftEye && (
                <View style={styles.eyeStatus}>
                  <View style={styles.eyeItem}>
                    <Text style={styles.eyeEmoji}>
                      {face.landmarks.leftEye.isOpen ? '👁️' : '😑'}
                    </Text>
                    <Text style={styles.eyeLabel}>Left Eye</Text>
                    <Text style={styles.eyeValue}>
                      {((face.landmarks.leftEye.openProbability ?? 0) * 100).toFixed(0)}%
                    </Text>
                  </View>
                  
                  {face.landmarks?.rightEye && (
                    <View style={styles.eyeItem}>
                      <Text style={styles.eyeEmoji}>
                        {face.landmarks.rightEye.isOpen ? '👁️' : '😑'}
                      </Text>
                      <Text style={styles.eyeLabel}>Right Eye</Text>
                      <Text style={styles.eyeValue}>
                        {((face.landmarks.rightEye.openProbability ?? 0) * 100).toFixed(0)}%
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {face.headPose && (
                <View style={styles.headPose}>
                  <Text style={styles.headPoseTitle}>Head Pose</Text>
                  <View style={styles.poseRow}>
                    <Text style={styles.poseLabel}>Yaw:</Text>
                    <Text style={styles.poseValue}>{(face.headPose.yaw ?? 0).toFixed(1)}°</Text>
                    <Text style={styles.poseLabel}>Pitch:</Text>
                    <Text style={styles.poseValue}>{(face.headPose.pitch ?? 0).toFixed(1)}°</Text>
                    <Text style={styles.poseLabel}>Roll:</Text>
                    <Text style={styles.poseValue}>{(face.headPose.roll ?? 0).toFixed(1)}°</Text>
                  </View>
                </View>
              )}
            </View>
          ))}
        </Card>
      )}

      {/* Blink Statistics */}
      {(blinkDetectionEnabled || blinkCount > 0) && (
        <Card style={styles.blinkCard}>
          <Text style={styles.sectionTitle}>Blink Statistics</Text>
          
          <View style={styles.blinkStats}>
            <View style={styles.blinkStat}>
              <Text style={styles.blinkValue}>{blinkCount}</Text>
              <Text style={styles.blinkLabel}>Total Blinks</Text>
            </View>
            
            <View style={styles.blinkStat}>
              <Text style={styles.blinkValue}>{blinkRate.toFixed(1)}</Text>
              <Text style={styles.blinkLabel}>Blinks/min</Text>
            </View>
          </View>

          {lastBlinkTime && (
            <View style={styles.lastBlink}>
              <Text style={styles.lastBlinkLabel}>Last Blink:</Text>
              <Text style={styles.lastBlinkValue}>
                {new Date(lastBlinkTime).toLocaleTimeString()}
              </Text>
            </View>
          )}
        </Card>
      )}

      {/* Info Card */}
      <Card style={styles.infoCard}>
        <Text style={styles.infoTitle}>About Video Call</Text>
        <Text style={styles.infoText}>
          This screen demonstrates WebRTC video calling with local face detection.
          Connect to a signaling server and find a peer to start a video call.
          Face and blink detection runs locally on your device during the call.
        </Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  serverCard: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  serverInputRow: {
    marginBottom: spacing.sm,
  },
  serverInput: {
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  controlsCard: {
    marginBottom: spacing.md,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  buttonColumn: {
    gap: spacing.sm,
  },
  flexButton: {
    flex: 1,
  },
  videoContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  videoCard: {
    flex: 1,
    padding: spacing.sm,
  },
  videoWrapper: {
    position: 'relative',
  },
  videoLabel: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  video: {
    width: '100%',
    aspectRatio: 3 / 4,
    backgroundColor: '#000',
    borderRadius: borderRadius.sm,
  },
  placeholder: {
    width: '100%',
    aspectRatio: 3 / 4,
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  faceOverlay: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    backgroundColor: 'rgba(0, 217, 255, 0.9)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  faceCount: {
    color: colors.background,
    fontSize: 12,
    fontWeight: '700',
  },
  statusCard: {
    marginBottom: spacing.md,
  },
  facesCard: {
    marginBottom: spacing.md,
  },
  faceDetails: {
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  faceTitle: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  detailLabel: {
    color: colors.textSecondary,
    fontSize: 14,
    width: 90,
  },
  detailValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  progressBar: {
    flex: 1,
    height: 8,
    backgroundColor: colors.surface,
    borderRadius: 4,
    marginHorizontal: spacing.sm,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.success,
    borderRadius: 4,
  },
  eyeStatus: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  eyeItem: {
    alignItems: 'center',
  },
  eyeEmoji: {
    fontSize: 32,
    marginBottom: spacing.xs,
  },
  eyeLabel: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  eyeValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  headPose: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  headPoseTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    marginBottom: spacing.xs,
  },
  poseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  poseLabel: {
    color: colors.textMuted,
    fontSize: 12,
  },
  poseValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '500',
  },
  blinkCard: {
    marginBottom: spacing.md,
  },
  blinkStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: spacing.md,
  },
  blinkStat: {
    alignItems: 'center',
  },
  blinkValue: {
    color: colors.primary,
    fontSize: 36,
    fontWeight: '700',
  },
  blinkLabel: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  lastBlink: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surfaceLight,
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  lastBlinkLabel: {
    color: colors.textSecondary,
    fontSize: 14,
    marginRight: spacing.sm,
  },
  lastBlinkValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  infoCard: {
    marginBottom: spacing.md,
    backgroundColor: colors.surfaceLight,
  },
  infoTitle: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  infoText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
});

