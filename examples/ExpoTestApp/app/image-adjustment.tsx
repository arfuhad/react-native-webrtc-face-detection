import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import {
  mediaDevices,
  RTCView,
  MediaStream,
  MediaStreamTrack,
  useFaceDetection,
  useImageAdjustment,
  type ImageAdjustmentConfig,
} from 'react-native-webrtc';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { SliderControl } from '@/components/SliderControl';
import { StatusIndicator } from '@/components/StatusIndicator';
import { colors, spacing, borderRadius } from '@/constants/theme';

interface Preset {
  name: string;
  config: ImageAdjustmentConfig;
}

const PRESETS: Preset[] = [
  { name: 'Normal', config: { exposure: 0, contrast: 1, saturation: 1, colorTemperature: 0 } },
  { name: 'Warm', config: { exposure: 0.1, contrast: 1.1, saturation: 1.2, colorTemperature: 0.4 } },
  { name: 'Cool', config: { exposure: 0, contrast: 1.1, saturation: 0.9, colorTemperature: -0.3 } },
  { name: 'Vivid', config: { exposure: 0.1, contrast: 1.4, saturation: 1.8, colorTemperature: 0.1 } },
  { name: 'Noir', config: { exposure: -0.1, contrast: 1.6, saturation: 0, colorTemperature: 0 } },
  { name: 'Bright', config: { exposure: 0.4, contrast: 0.9, saturation: 1.1, colorTemperature: 0.1 } },
];

const BEAUTY_PRESETS: Preset[] = [
  {
    name: 'Beauty Off',
    config: {
      exposure: 0, contrast: 1, saturation: 1, colorTemperature: 0,
      smoothing: { enabled: false, distanceNormalization: 8, texelSpacing: 1 },
    },
  },
  {
    name: 'Beauty L1',
    config: {
      exposure: 0.08, contrast: 0.92, saturation: 0.96, colorTemperature: 0.04,
      smoothing: { enabled: true, distanceNormalization: 6, texelSpacing: 2 },
    },
  },
  {
    name: 'Beauty L2',
    config: {
      exposure: 0.14, contrast: 0.85, saturation: 0.93, colorTemperature: 0.08,
      smoothing: { enabled: true, distanceNormalization: 4, texelSpacing: 3 },
    },
  },
  {
    name: 'Beauty L3',
    config: {
      exposure: 0.20, contrast: 0.78, saturation: 0.90, colorTemperature: 0.12,
      smoothing: { enabled: true, distanceNormalization: 2.5, texelSpacing: 4 },
    },
  },
];

export default function ImageAdjustmentScreen() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [videoTrack, setVideoTrack] = useState<MediaStreamTrack | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activePreset, setActivePreset] = useState<string>('Normal');
  const [sheetOpen, setSheetOpen] = useState(false);

  const {
    config,
    isEnabled,
    enable,
    disable,
    updateConfig,
    setExposure,
    setContrast,
    setSaturation,
    setColorTemperature,
    setSmoothing,
    setSkinMask,
    error,
  } = useImageAdjustment(videoTrack);

  const {
    isEnabled: faceDetectionEnabled,
    enable: enableFaceDetection,
    disable: disableFaceDetection,
  } = useFaceDetection(videoTrack);

  const smoothing = config.smoothing ?? { enabled: false, distanceNormalization: 8, texelSpacing: 1 };
  const skinMask = smoothing.skinMask ?? { feather: 0, eyeProtect: true, mouthProtect: true };

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
    } catch (err) {
      console.error('Failed to start camera:', err);
      Alert.alert('Camera Error', 'Failed to access camera. Check permissions.');
    }
  }, []);

  const stopCamera = useCallback(async () => {
    if (isEnabled) {
      await disable();
    }

    if (faceDetectionEnabled) {
      await disableFaceDetection();
    }

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream.release();
      setStream(null);
      setVideoTrack(null);
      setIsStreaming(false);
    }
  }, [stream, isEnabled, disable, faceDetectionEnabled, disableFaceDetection]);

  const toggleAdjustment = useCallback(async () => {
    if (isEnabled) {
      await disable();
    } else {
      if (!faceDetectionEnabled) {
        await enableFaceDetection();
      }
      await enable();
    }
  }, [isEnabled, enable, disable, faceDetectionEnabled, enableFaceDetection]);

  const applyPreset = useCallback(async (preset: Preset) => {
    setActivePreset(preset.name);
    await updateConfig(preset.config);
  }, [updateConfig]);

  const resetToDefaults = useCallback(async () => {
    setActivePreset('Normal');
    await updateConfig({
      exposure: 0,
      contrast: 1,
      saturation: 1,
      colorTemperature: 0,
      smoothing: {
        enabled: false,
        distanceNormalization: 8,
        texelSpacing: 1,
        skinMask: { feather: 0, eyeProtect: true, mouthProtect: true },
      },
    });
  }, [updateConfig]);

  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream.release();
      }
    };
  }, []);

  return (
    <View style={styles.container}>
      {/* Full-bleed camera */}
      <View style={styles.videoContainer}>
        {stream ? (
          <RTCView
            streamURL={stream.toURL()}
            style={styles.video}
            objectFit="cover"
            mirror={true}
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderIcon}>🎨</Text>
            <Text style={styles.placeholderText}>
              Start camera to test image adjustments
            </Text>
          </View>
        )}

        {/* Top-right status pills */}
        {isStreaming && (
          <View style={styles.statusPillRow} pointerEvents="none">
            {isEnabled && (
              <View style={[styles.pill, styles.pillActive]}>
                <Text style={styles.pillText}>Adjust</Text>
              </View>
            )}
            {smoothing.enabled && (
              <View style={[styles.pill, styles.pillActive]}>
                <Text style={styles.pillText}>Smooth</Text>
              </View>
            )}
            {faceDetectionEnabled && (
              <View style={[styles.pill, styles.pillActive]}>
                <Text style={styles.pillText}>Face</Text>
              </View>
            )}
          </View>
        )}

        {/* Error toast */}
        {error && (
          <View style={styles.errorToast}>
            <Text style={styles.errorToastText}>{error.message}</Text>
          </View>
        )}
      </View>

      {/* Floating bottom bar */}
      <View style={styles.bottomBar}>
        <Button
          title={isStreaming ? 'Stop' : 'Start Camera'}
          onPress={isStreaming ? stopCamera : startCamera}
          variant={isStreaming ? 'danger' : 'primary'}
          style={styles.bottomBarButton}
        />
        {isStreaming && (
          <Button
            title="Adjustments"
            onPress={() => setSheetOpen(true)}
            variant="secondary"
            style={styles.bottomBarButton}
          />
        )}
      </View>

      {/* Bottom sheet modal */}
      <Modal
        visible={sheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setSheetOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => { /* swallow */ }}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Image Adjustments</Text>
              <Pressable
                onPress={() => setSheetOpen(false)}
                style={styles.sheetClose}
                hitSlop={12}
              >
                <Text style={styles.sheetCloseText}>Close</Text>
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.sheetContent}
              showsVerticalScrollIndicator={false}
            >
              <Card style={styles.controlsCard}>
                <Text style={styles.sectionTitle}>Pipeline</Text>
                <Button
                  title={isEnabled ? 'Disable Adjustments' : 'Enable Adjustments'}
                  onPress={toggleAdjustment}
                  variant={isEnabled ? 'secondary' : 'primary'}
                />
                <Text style={styles.hintText}>
                  Enabling auto-attaches face detection first so skin-mask smoothing has landmarks.
                </Text>
              </Card>

              {isEnabled && (
                <Card style={styles.controlsCard}>
                  <Text style={styles.sectionTitle}>Controls</Text>

                  <SliderControl
                    label="Exposure"
                    value={config.exposure}
                    onValueChange={setExposure}
                    minimumValue={-1}
                    maximumValue={1}
                  />

                  <SliderControl
                    label="Contrast"
                    value={config.contrast}
                    onValueChange={setContrast}
                    minimumValue={0}
                    maximumValue={3}
                  />

                  <SliderControl
                    label="Saturation"
                    value={config.saturation}
                    onValueChange={setSaturation}
                    minimumValue={0}
                    maximumValue={3}
                  />

                  <SliderControl
                    label="Color Temperature"
                    value={config.colorTemperature}
                    onValueChange={setColorTemperature}
                    minimumValue={-1}
                    maximumValue={1}
                    minimumTrackColor="#4488ff"
                    maximumTrackColor="#ff8844"
                  />

                  <Button
                    title="Reset to Defaults"
                    onPress={resetToDefaults}
                    variant="secondary"
                  />
                </Card>
              )}

              {isEnabled && (
                <Card style={styles.controlsCard}>
                  <Text style={styles.sectionTitle}>Skin Smoothing (Bilateral)</Text>
                  <Button
                    title={smoothing.enabled ? 'Disable Smoothing' : 'Enable Smoothing'}
                    onPress={() => setSmoothing({ enabled: !smoothing.enabled })}
                    variant={smoothing.enabled ? 'secondary' : 'outline'}
                  />
                  {smoothing.enabled && (
                    <>
                      <SliderControl
                        label="Distance Normalization"
                        value={smoothing.distanceNormalization}
                        onValueChange={v => setSmoothing({ distanceNormalization: v })}
                        minimumValue={2.5}
                        maximumValue={8}
                      />
                      <SliderControl
                        label="Texel Spacing"
                        value={smoothing.texelSpacing}
                        onValueChange={v => setSmoothing({ texelSpacing: v })}
                        minimumValue={1}
                        maximumValue={4}
                      />
                    </>
                  )}
                  <Text style={styles.hintText}>
                    Larger distance normalization = stronger smoothing, fewer edges preserved.
                    Larger texel spacing = wider blur.
                  </Text>
                </Card>
              )}

              {isEnabled && smoothing.enabled && (
                <Card style={styles.controlsCard}>
                  <Text style={styles.sectionTitle}>Skin Mask</Text>
                  <View style={styles.toggleRow}>
                    <Text style={styles.toggleLabel}>Eye Protect</Text>
                    <Button
                      title={skinMask.eyeProtect ? 'On' : 'Off'}
                      onPress={() => setSkinMask({ eyeProtect: !skinMask.eyeProtect })}
                      variant={skinMask.eyeProtect ? 'primary' : 'outline'}
                      style={styles.toggleButton}
                    />
                  </View>
                  <View style={styles.toggleRow}>
                    <Text style={styles.toggleLabel}>Mouth Protect</Text>
                    <Button
                      title={skinMask.mouthProtect ? 'On' : 'Off'}
                      onPress={() => setSkinMask({ mouthProtect: !skinMask.mouthProtect })}
                      variant={skinMask.mouthProtect ? 'primary' : 'outline'}
                      style={styles.toggleButton}
                    />
                  </View>
                  <SliderControl
                    label="Feather (0 = auto)"
                    value={skinMask.feather ?? 0}
                    onValueChange={v => setSkinMask({ feather: Math.round(v) })}
                    minimumValue={0}
                    maximumValue={40}
                    step={1}
                  />
                  <Text style={styles.hintText}>
                    Face detection is
                    {faceDetectionEnabled ? ' active' : ' inactive'}. Without a detected face,
                    smoothing no-ops (no whole-frame fallback).
                  </Text>
                </Card>
              )}

              {isEnabled && (
                <Card style={styles.controlsCard}>
                  <Text style={styles.sectionTitle}>Beauty Presets</Text>
                  <View style={styles.presetGrid}>
                    {BEAUTY_PRESETS.map(preset => (
                      <Button
                        key={preset.name}
                        title={preset.name}
                        onPress={() => applyPreset(preset)}
                        variant={activePreset === preset.name ? 'primary' : 'outline'}
                        style={styles.presetButton}
                      />
                    ))}
                  </View>
                </Card>
              )}

              {isEnabled && (
                <Card style={styles.controlsCard}>
                  <Text style={styles.sectionTitle}>Tone Presets</Text>
                  <View style={styles.presetGrid}>
                    {PRESETS.map(preset => (
                      <Button
                        key={preset.name}
                        title={preset.name}
                        onPress={() => applyPreset(preset)}
                        variant={activePreset === preset.name ? 'primary' : 'outline'}
                        style={styles.presetButton}
                      />
                    ))}
                  </View>
                </Card>
              )}

              <Card style={styles.statusCard}>
                <Text style={styles.sectionTitle}>Status</Text>
                <StatusIndicator
                  label="Camera"
                  value={isStreaming}
                  status={isStreaming ? 'success' : 'info'}
                />
                <StatusIndicator
                  label="Image Adjustment"
                  value={isEnabled}
                  status={isEnabled ? 'success' : 'info'}
                />
                {isEnabled && (
                  <>
                    <StatusIndicator
                      label="Exposure"
                      value={config.exposure.toFixed(2)}
                      status={config.exposure !== 0 ? 'warning' : 'info'}
                    />
                    <StatusIndicator
                      label="Contrast"
                      value={config.contrast.toFixed(2)}
                      status={config.contrast !== 1 ? 'warning' : 'info'}
                    />
                    <StatusIndicator
                      label="Saturation"
                      value={config.saturation.toFixed(2)}
                      status={config.saturation !== 1 ? 'warning' : 'info'}
                    />
                    <StatusIndicator
                      label="Color Temp"
                      value={config.colorTemperature.toFixed(2)}
                      status={config.colorTemperature !== 0 ? 'warning' : 'info'}
                    />
                    <StatusIndicator
                      label="Smoothing"
                      value={smoothing.enabled}
                      status={smoothing.enabled ? 'success' : 'info'}
                    />
                    {smoothing.enabled && (
                      <>
                        <StatusIndicator
                          label="Distance Norm"
                          value={smoothing.distanceNormalization.toFixed(2)}
                          status="warning"
                        />
                        <StatusIndicator
                          label="Texel Spacing"
                          value={smoothing.texelSpacing.toFixed(2)}
                          status="warning"
                        />
                      </>
                    )}
                  </>
                )}
              </Card>

              <Card style={styles.infoCard}>
                <Text style={styles.infoTitle}>About Image Adjustment</Text>
                <Text style={styles.infoText}>
                  Adjustments apply in real-time using pre-computed lookup tables on the
                  I420 (YUV) video frames:
                </Text>
                <Text style={styles.infoList}>{'\u2022'} Exposure — brightness (Y plane)</Text>
                <Text style={styles.infoList}>{'\u2022'} Contrast — tonal range (Y plane)</Text>
                <Text style={styles.infoList}>{'\u2022'} Saturation — color intensity (U/V planes)</Text>
                <Text style={styles.infoList}>{'\u2022'} Color Temperature — warm/cool shift (U/V planes)</Text>
                <Text style={styles.infoList}>{'\u2022'} Skin Smoothing — bilateral blur (Metal / GLES) gated by face-detected skin mask</Text>
              </Card>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  videoContainer: {
    flex: 1,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  video: {
    flex: 1,
    backgroundColor: '#000',
  },
  placeholder: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderIcon: {
    fontSize: 72,
    marginBottom: spacing.md,
  },
  placeholderText: {
    color: colors.textSecondary,
    fontSize: 16,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  statusPillRow: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    gap: spacing.xs,
  },
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  pillActive: {
    backgroundColor: 'rgba(0,217,255,0.85)',
  },
  pillText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  errorToast: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    top: spacing.md,
    backgroundColor: 'rgba(239,68,68,0.92)',
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  errorToastText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  bottomBar: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  bottomBarButton: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: '85%',
    paddingBottom: spacing.md,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  sheetClose: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  sheetCloseText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  sheetContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
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
  hintText: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  toggleLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  toggleButton: {
    minWidth: 80,
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  presetButton: {
    minWidth: '30%',
    flexGrow: 1,
  },
  statusCard: {
    marginBottom: spacing.md,
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
