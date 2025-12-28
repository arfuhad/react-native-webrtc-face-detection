import { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  RTCView,
  MediaStream,
} from 'react-native-webrtc';
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

interface PeerConnectionState {
  connectionState: string;
  iceConnectionState: string;
  iceGatheringState: string;
  signalingState: string;
}

export default function PeerConnectionScreen() {
  // Local peer (offerer)
  const localPeerRef = useRef<RTCPeerConnection | null>(null);
  // Remote peer (answerer) - for loopback testing
  const remotePeerRef = useRef<RTCPeerConnection | null>(null);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localState, setLocalState] = useState<PeerConnectionState | null>(null);
  const [remoteState, setRemoteState] = useState<PeerConnectionState | null>(null);
  const [localIceCandidates, setLocalIceCandidates] = useState<RTCIceCandidate[]>([]);
  const [remoteIceCandidates, setRemoteIceCandidates] = useState<RTCIceCandidate[]>([]);
  const [localSdp, setLocalSdp] = useState<string | null>(null);
  const [remoteSdp, setRemoteSdp] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const updateLocalState = (pc: RTCPeerConnection) => {
    setLocalState({
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      iceGatheringState: pc.iceGatheringState,
      signalingState: pc.signalingState,
    });
  };

  const updateRemoteState = (pc: RTCPeerConnection) => {
    setRemoteState({
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      iceGatheringState: pc.iceGatheringState,
      signalingState: pc.signalingState,
    });
  };

  const startLoopback = useCallback(async () => {
    try {
      // Get local media stream
      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });
      setLocalStream(stream);

      // Create local peer connection (offerer)
      const localPc = new RTCPeerConnection(configuration);
      localPeerRef.current = localPc;

      // Create remote peer connection (answerer)
      const remotePc = new RTCPeerConnection(configuration);
      remotePeerRef.current = remotePc;

      // Set up state update listeners
      const localStateEvents = ['connectionstatechange', 'iceconnectionstatechange', 'icegatheringstatechange', 'signalingstatechange'];
      localStateEvents.forEach(event => {
        localPc.addEventListener(event, () => updateLocalState(localPc));
      });

      const remoteStateEvents = ['connectionstatechange', 'iceconnectionstatechange', 'icegatheringstatechange', 'signalingstatechange'];
      remoteStateEvents.forEach(event => {
        remotePc.addEventListener(event, () => updateRemoteState(remotePc));
      });

      // Handle ICE candidates - exchange between peers
      localPc.addEventListener('icecandidate', (event) => {
        if (event.candidate) {
          setLocalIceCandidates(prev => [...prev, event.candidate!]);
          // In a real app, you'd send this to the remote peer via signaling
          // For loopback, we add it directly to the remote peer
          remotePc.addIceCandidate(event.candidate);
        }
      });

      remotePc.addEventListener('icecandidate', (event) => {
        if (event.candidate) {
          setRemoteIceCandidates(prev => [...prev, event.candidate!]);
          // Add to local peer
          localPc.addIceCandidate(event.candidate);
        }
      });

      // Handle remote stream on the remote peer
      remotePc.addEventListener('track', (event) => {
        if (event.streams && event.streams[0]) {
          setRemoteStream(event.streams[0]);
        }
      });

      // Track connection state
      localPc.addEventListener('connectionstatechange', () => {
        if (localPc.connectionState === 'connected') {
          setIsConnected(true);
        } else if (['disconnected', 'failed', 'closed'].includes(localPc.connectionState)) {
          setIsConnected(false);
        }
      });

      // Add local stream tracks to local peer
      stream.getTracks().forEach(track => {
        localPc.addTrack(track, stream);
      });

      // Create and set local description (offer)
      const offer = await localPc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await localPc.setLocalDescription(offer);
      setLocalSdp(offer.sdp?.substring(0, 200) + '...');

      // Set remote description on remote peer
      await remotePc.setRemoteDescription(offer);

      // Create answer on remote peer
      const answer = await remotePc.createAnswer();
      await remotePc.setLocalDescription(answer);
      setRemoteSdp(answer.sdp?.substring(0, 200) + '...');

      // Set answer on local peer
      await localPc.setRemoteDescription(answer);

      // Initial state update
      updateLocalState(localPc);
      updateRemoteState(remotePc);

    } catch (error) {
      console.error('Failed to start loopback:', error);
      Alert.alert('Error', 'Failed to start peer connection. Check camera permissions.');
    }
  }, []);

  const stopLoopback = useCallback(() => {
    // Close peer connections
    if (localPeerRef.current) {
      localPeerRef.current.close();
      localPeerRef.current = null;
    }
    if (remotePeerRef.current) {
      remotePeerRef.current.close();
      remotePeerRef.current = null;
    }

    // Stop streams
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream.release();
      setLocalStream(null);
    }
    if (remoteStream) {
      remoteStream.getTracks().forEach(track => track.stop());
      setRemoteStream(null);
    }

    // Reset state
    setLocalState(null);
    setRemoteState(null);
    setLocalIceCandidates([]);
    setRemoteIceCandidates([]);
    setLocalSdp(null);
    setRemoteSdp(null);
    setIsConnected(false);
  }, [localStream, remoteStream]);

  const getStateColor = (state: string): 'success' | 'warning' | 'error' | 'info' => {
    switch (state) {
      case 'connected':
      case 'complete':
      case 'stable':
        return 'success';
      case 'connecting':
      case 'checking':
      case 'gathering':
      case 'have-local-offer':
      case 'have-remote-offer':
        return 'warning';
      case 'disconnected':
      case 'failed':
      case 'closed':
        return 'error';
      default:
        return 'info';
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Video Previews */}
      <View style={styles.videoContainer}>
        <Card style={styles.videoCard}>
          <Text style={styles.videoLabel}>Local</Text>
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
              <Text style={styles.placeholderText}>No Stream</Text>
            </View>
          )}
        </Card>
      </View>

      {/* Controls */}
      <Card style={styles.controlsCard}>
        <Text style={styles.sectionTitle}>Loopback Test</Text>
        <Text style={styles.description}>
          Creates two peer connections locally and connects them together to test the WebRTC flow.
        </Text>
        <View style={styles.buttonRow}>
          <Button
            title={isConnected ? 'Disconnect' : 'Start Loopback'}
            onPress={isConnected ? stopLoopback : startLoopback}
            variant={isConnected ? 'danger' : 'primary'}
            style={styles.flexButton}
          />
        </View>
      </Card>

      {/* Local Peer State */}
      {localState && (
        <Card style={styles.stateCard}>
          <Text style={styles.sectionTitle}>Local Peer (Offerer)</Text>
          <StatusIndicator
            label="Connection"
            value={localState.connectionState}
            status={getStateColor(localState.connectionState)}
          />
          <StatusIndicator
            label="ICE Connection"
            value={localState.iceConnectionState}
            status={getStateColor(localState.iceConnectionState)}
          />
          <StatusIndicator
            label="ICE Gathering"
            value={localState.iceGatheringState}
            status={getStateColor(localState.iceGatheringState)}
          />
          <StatusIndicator
            label="Signaling"
            value={localState.signalingState}
            status={getStateColor(localState.signalingState)}
          />
          <StatusIndicator
            label="ICE Candidates"
            value={localIceCandidates.length}
            status="info"
          />
        </Card>
      )}

      {/* Remote Peer State */}
      {remoteState && (
        <Card style={styles.stateCard}>
          <Text style={styles.sectionTitle}>Remote Peer (Answerer)</Text>
          <StatusIndicator
            label="Connection"
            value={remoteState.connectionState}
            status={getStateColor(remoteState.connectionState)}
          />
          <StatusIndicator
            label="ICE Connection"
            value={remoteState.iceConnectionState}
            status={getStateColor(remoteState.iceConnectionState)}
          />
          <StatusIndicator
            label="ICE Gathering"
            value={remoteState.iceGatheringState}
            status={getStateColor(remoteState.iceGatheringState)}
          />
          <StatusIndicator
            label="Signaling"
            value={remoteState.signalingState}
            status={getStateColor(remoteState.signalingState)}
          />
          <StatusIndicator
            label="ICE Candidates"
            value={remoteIceCandidates.length}
            status="info"
          />
        </Card>
      )}

      {/* SDP Info */}
      {(localSdp || remoteSdp) && (
        <Card style={styles.sdpCard}>
          <Text style={styles.sectionTitle}>Session Descriptions</Text>
          
          {localSdp && (
            <View style={styles.sdpSection}>
              <Text style={styles.sdpLabel}>Offer SDP (truncated):</Text>
              <Text style={styles.sdpText}>{localSdp}</Text>
            </View>
          )}
          
          {remoteSdp && (
            <View style={styles.sdpSection}>
              <Text style={styles.sdpLabel}>Answer SDP (truncated):</Text>
              <Text style={styles.sdpText}>{remoteSdp}</Text>
            </View>
          )}
        </Card>
      )}
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
  videoContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  videoCard: {
    flex: 1,
    padding: spacing.sm,
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
  },
  controlsCard: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  description: {
    color: colors.textSecondary,
    fontSize: 14,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flexButton: {
    flex: 1,
  },
  stateCard: {
    marginBottom: spacing.md,
  },
  sdpCard: {
    marginBottom: spacing.md,
  },
  sdpSection: {
    marginBottom: spacing.md,
  },
  sdpLabel: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  sdpText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontFamily: 'monospace',
    backgroundColor: colors.surfaceLight,
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
  },
});

