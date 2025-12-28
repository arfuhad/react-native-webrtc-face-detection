import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { 
  mediaDevices, 
  RTCView, 
  MediaStream,
  permissions,
} from 'react-native-webrtc';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { StatusIndicator } from '@/components/StatusIndicator';
import { colors, spacing, borderRadius } from '@/constants/theme';

interface MediaDeviceInfo {
  deviceId: string;
  kind: string;
  label: string;
}

export default function CameraScreen() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [videoSettings, setVideoSettings] = useState<any>(null);

  // Check and request permissions on mount
  useEffect(() => {
    checkPermissions();
    enumerateDevices();
  }, []);

  const checkPermissions = async () => {
    try {
      const result = await permissions.query({ name: 'camera' });
      if (result === permissions.RESULT.GRANTED) {
        setHasPermission(true);
      } else {
        const requestResult = await permissions.request({ name: 'camera' });
        setHasPermission(requestResult === true);
      }
    } catch (error) {
      console.error('Permission error:', error);
      setHasPermission(false);
    }
  };

  const enumerateDevices = async () => {
    try {
      const deviceList = await mediaDevices.enumerateDevices();
      setDevices(deviceList as MediaDeviceInfo[]);
    } catch (error) {
      console.error('Failed to enumerate devices:', error);
    }
  };

  const startCamera = useCallback(async () => {
    if (!hasPermission) {
      Alert.alert('Permission Required', 'Camera permission is required to start streaming.');
      return;
    }

    try {
      const mediaStream = await mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      });

      setStream(mediaStream);
      setIsStreaming(true);

      // Get video track settings
      const videoTrack = mediaStream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        setVideoSettings(settings);
      }

      // Refresh devices after getting stream
      enumerateDevices();
    } catch (error) {
      console.error('Failed to start camera:', error);
      Alert.alert('Camera Error', 'Failed to start camera. Please check permissions.');
    }
  }, [hasPermission, facingMode]);

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream.release();
      setStream(null);
      setIsStreaming(false);
      setVideoSettings(null);
    }
  }, [stream]);

  const toggleCamera = useCallback(async () => {
    if (stream) {
      stopCamera();
    }
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
    // Will restart with new facing mode when user presses start again
  }, [stream, stopCamera]);

  const switchCameraWhileStreaming = useCallback(async () => {
    const newFacingMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newFacingMode);
    
    if (isStreaming) {
      stopCamera();
      // Small delay before restarting
      setTimeout(async () => {
        try {
          const mediaStream = await mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: newFacingMode,
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30 },
            },
          });
          setStream(mediaStream);
          setIsStreaming(true);
          
          const videoTrack = mediaStream.getVideoTracks()[0];
          if (videoTrack) {
            setVideoSettings(videoTrack.getSettings());
          }
        } catch (error) {
          console.error('Failed to switch camera:', error);
        }
      }, 100);
    }
  }, [facingMode, isStreaming, stopCamera]);

  const videoDevices = devices.filter(d => d.kind === 'videoinput');
  const audioDevices = devices.filter(d => d.kind === 'audioinput');

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Video Preview */}
      <Card style={styles.videoCard}>
        {stream ? (
          <RTCView
            streamURL={stream.toURL()}
            style={styles.video}
            objectFit="cover"
            mirror={facingMode === 'user'}
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderIcon}>📹</Text>
            <Text style={styles.placeholderText}>
              {hasPermission === false 
                ? 'Camera permission denied' 
                : 'Tap "Start Camera" to begin'}
            </Text>
          </View>
        )}
      </Card>

      {/* Controls */}
      <Card style={styles.controlsCard}>
        <Text style={styles.sectionTitle}>Camera Controls</Text>
        <View style={styles.buttonRow}>
          <Button
            title={isStreaming ? 'Stop Camera' : 'Start Camera'}
            onPress={isStreaming ? stopCamera : startCamera}
            variant={isStreaming ? 'danger' : 'primary'}
            style={styles.flexButton}
          />
          <Button
            title="Switch Camera"
            onPress={switchCameraWhileStreaming}
            variant="outline"
            disabled={!hasPermission}
            style={styles.flexButton}
          />
        </View>
      </Card>

      {/* Status */}
      <Card style={styles.statusCard}>
        <Text style={styles.sectionTitle}>Status</Text>
        <StatusIndicator 
          label="Permission" 
          value={hasPermission === null ? 'Checking...' : hasPermission ? 'Granted' : 'Denied'} 
          status={hasPermission ? 'success' : hasPermission === false ? 'error' : 'warning'}
        />
        <StatusIndicator 
          label="Streaming" 
          value={isStreaming} 
          status={isStreaming ? 'success' : 'info'}
        />
        <StatusIndicator 
          label="Camera" 
          value={facingMode === 'user' ? 'Front' : 'Back'} 
          status="info"
        />
        {videoSettings && (
          <>
            <StatusIndicator 
              label="Resolution" 
              value={`${videoSettings.width || '?'}x${videoSettings.height || '?'}`} 
              status="info"
            />
            <StatusIndicator 
              label="Frame Rate" 
              value={`${videoSettings.frameRate || '?'} fps`} 
              status="info"
            />
          </>
        )}
      </Card>

      {/* Devices */}
      <Card style={styles.devicesCard}>
        <Text style={styles.sectionTitle}>Available Devices</Text>
        
        <Text style={styles.subsectionTitle}>Video Inputs ({videoDevices.length})</Text>
        {videoDevices.length === 0 ? (
          <Text style={styles.noDevices}>No video devices found</Text>
        ) : (
          videoDevices.map((device, index) => (
            <View key={device.deviceId || index} style={styles.deviceItem}>
              <Text style={styles.deviceLabel}>
                {device.label || `Camera ${index + 1}`}
              </Text>
              <Text style={styles.deviceId}>{device.deviceId?.slice(0, 16)}...</Text>
            </View>
          ))
        )}

        <Text style={styles.subsectionTitle}>Audio Inputs ({audioDevices.length})</Text>
        {audioDevices.length === 0 ? (
          <Text style={styles.noDevices}>No audio devices found</Text>
        ) : (
          audioDevices.map((device, index) => (
            <View key={device.deviceId || index} style={styles.deviceItem}>
              <Text style={styles.deviceLabel}>
                {device.label || `Microphone ${index + 1}`}
              </Text>
              <Text style={styles.deviceId}>{device.deviceId?.slice(0, 16)}...</Text>
            </View>
          ))
        )}

        <Button
          title="Refresh Devices"
          onPress={enumerateDevices}
          variant="secondary"
          style={styles.refreshButton}
        />
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
  videoCard: {
    marginBottom: spacing.md,
    padding: 0,
    overflow: 'hidden',
  },
  video: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    borderRadius: borderRadius.lg,
  },
  placeholder: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  placeholderText: {
    color: colors.textSecondary,
    fontSize: 16,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  controlsCard: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flexButton: {
    flex: 1,
  },
  statusCard: {
    marginBottom: spacing.md,
  },
  devicesCard: {
    marginBottom: spacing.md,
  },
  subsectionTitle: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  deviceItem: {
    backgroundColor: colors.surfaceLight,
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.xs,
  },
  deviceLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  deviceId: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  noDevices: {
    color: colors.textMuted,
    fontSize: 14,
    fontStyle: 'italic',
  },
  refreshButton: {
    marginTop: spacing.md,
  },
});

