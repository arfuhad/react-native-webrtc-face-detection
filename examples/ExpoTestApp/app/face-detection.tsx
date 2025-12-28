import { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import {
  mediaDevices,
  RTCView,
  MediaStream,
  MediaStreamTrack,
  useFaceDetection,
  useBlinkDetection,
} from 'react-native-webrtc';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { StatusIndicator } from '@/components/StatusIndicator';
import { colors, spacing, borderRadius } from '@/constants/theme';

export default function FaceDetectionScreen() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [videoTrack, setVideoTrack] = useState<MediaStreamTrack | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

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

  const startCamera = useCallback(async () => {
    try {
      const mediaStream = await mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });

      setStream(mediaStream);
      setIsStreaming(true);

      const track = mediaStream.getVideoTracks()[0];
      if (track) {
        setVideoTrack(track);
      }
    } catch (error) {
      console.error('Failed to start camera:', error);
      Alert.alert('Camera Error', 'Failed to access camera. Check permissions.');
    }
  }, []);

  const stopCamera = useCallback(async () => {
    // Disable detection before stopping
    if (faceDetectionEnabled) {
      await disableFaceDetection();
    }
    if (blinkDetectionEnabled) {
      await disableBlinkDetection();
    }

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream.release();
      setStream(null);
      setVideoTrack(null);
      setIsStreaming(false);
    }
  }, [stream, faceDetectionEnabled, blinkDetectionEnabled, disableFaceDetection, disableBlinkDetection]);

  const toggleFaceDetection = useCallback(async () => {
    if (faceDetectionEnabled) {
      await disableFaceDetection();
    } else {
      await enableFaceDetection();
    }
  }, [faceDetectionEnabled, enableFaceDetection, disableFaceDetection]);

  const toggleBlinkDetection = useCallback(async () => {
    if (blinkDetectionEnabled) {
      await disableBlinkDetection();
    } else {
      await enableBlinkDetection();
    }
  }, [blinkDetectionEnabled, enableBlinkDetection, disableBlinkDetection]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream.release();
      }
    };
  }, []);

  const facesDetected = detectionResult?.faces?.length ?? 0;
  const blinkRate = blinkCount > 0 ? getBlinkRate() : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Video Preview */}
      <Card style={styles.videoCard}>
        {stream ? (
          <View style={styles.videoWrapper}>
            <RTCView
              streamURL={stream.toURL()}
              style={styles.video}
              objectFit="cover"
              mirror={true}
            />
            {/* Face detection overlay */}
            {faceDetectionEnabled && facesDetected > 0 && (
              <View style={styles.faceOverlay}>
                <Text style={styles.faceCount}>{facesDetected} face{facesDetected > 1 ? 's' : ''}</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderIcon}>👤</Text>
            <Text style={styles.placeholderText}>Start camera to enable face detection</Text>
          </View>
        )}
      </Card>

      {/* Camera Controls */}
      <Card style={styles.controlsCard}>
        <Text style={styles.sectionTitle}>Camera</Text>
        <Button
          title={isStreaming ? 'Stop Camera' : 'Start Camera'}
          onPress={isStreaming ? stopCamera : startCamera}
          variant={isStreaming ? 'danger' : 'primary'}
        />
      </Card>

      {/* Detection Controls */}
      {isStreaming && (
        <Card style={styles.controlsCard}>
          <Text style={styles.sectionTitle}>Detection Controls</Text>
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

      {/* Detection Status */}
      <Card style={styles.statusCard}>
        <Text style={styles.sectionTitle}>Detection Status</Text>
        <StatusIndicator
          label="Camera"
          value={isStreaming}
          status={isStreaming ? 'success' : 'info'}
        />
        <StatusIndicator
          label="Face Detection"
          value={faceDetectionEnabled}
          status={faceDetectionEnabled ? 'success' : 'info'}
        />
        <StatusIndicator
          label="Blink Detection"
          value={blinkDetectionEnabled}
          status={blinkDetectionEnabled ? 'success' : 'info'}
        />
        <StatusIndicator
          label="Faces Detected"
          value={facesDetected}
          status={facesDetected > 0 ? 'success' : 'warning'}
        />
      </Card>

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

              {face.boundingBox && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Position:</Text>
                  <Text style={styles.detailValue}>
                    ({face.boundingBox.x?.toFixed(0)}, {face.boundingBox.y?.toFixed(0)})
                  </Text>
                </View>
              )}

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
        <Text style={styles.infoTitle}>About Face Detection</Text>
        <Text style={styles.infoText}>
          This screen demonstrates the face detection capabilities of react-native-webrtc.
          The face detection and blink detection hooks provide real-time analysis of faces
          in the video stream, including:
        </Text>
        <Text style={styles.infoList}>• Face position and bounding box</Text>
        <Text style={styles.infoList}>• Detection confidence score</Text>
        <Text style={styles.infoList}>• Eye open/closed state</Text>
        <Text style={styles.infoList}>• Head pose (yaw, pitch, roll)</Text>
        <Text style={styles.infoList}>• Blink detection and counting</Text>
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
  videoWrapper: {
    position: 'relative',
  },
  video: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: '#000',
    borderRadius: borderRadius.lg,
  },
  faceOverlay: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    backgroundColor: 'rgba(0, 217, 255, 0.9)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
  },
  faceCount: {
    color: colors.background,
    fontSize: 14,
    fontWeight: '700',
  },
  placeholder: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderIcon: {
    fontSize: 64,
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
  buttonColumn: {
    gap: spacing.sm,
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
    marginBottom: spacing.sm,
  },
  infoList: {
    color: colors.textSecondary,
    fontSize: 14,
    marginLeft: spacing.sm,
    lineHeight: 22,
  },
});

