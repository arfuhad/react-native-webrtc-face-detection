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
      smoothing: { enabled: false, distanceNormalization: 3, texelSpacing: 2, iterations: 4, mix: 0, skinBrightness: 0, smoothChroma: true },
    },
  },
  {
    name: 'Smooth Only',
    config: {
      exposure: 0, contrast: 1, saturation: 1, colorTemperature: 0,
      smoothing: { enabled: true, distanceNormalization: 2.5, texelSpacing: 2, iterations: 4, mix: 0, skinBrightness: 0, smoothChroma: true },
    },
  },
  {
    name: 'Subtle',
    config: {
      exposure: 0.05, contrast: 0.95, saturation: 0.98, colorTemperature: 0.02,
      smoothing: { enabled: true, distanceNormalization: 3.5, texelSpacing: 2, iterations: 2, mix: 0.3, skinBrightness: 0.05, smoothChroma: true },
    },
  },
  {
    name: 'Medium',
    config: {
      exposure: 0.1, contrast: 0.9, saturation: 0.95, colorTemperature: 0.05,
      smoothing: { enabled: true, distanceNormalization: 3, texelSpacing: 2.5, iterations: 4, mix: 0.2, skinBrightness: 0.1, smoothChroma: true },
    },
  },
  {
    name: 'Flawless',
    config: {
      exposure: 0.15, contrast: 0.85, saturation: 0.92, colorTemperature: 0.1,
      smoothing: { enabled: true, distanceNormalization: 2.5, texelSpacing: 3, iterations: 6, mix: 0.15, skinBrightness: 0.2, smoothChroma: true },
    },
  },
  {
    name: 'Porcelain',
    config: {
      exposure: 0.2, contrast: 0.8, saturation: 0.9, colorTemperature: 0.15,
      smoothing: { enabled: true, distanceNormalization: 2, texelSpacing: 3.5, iterations: 8, mix: 0.1, skinBrightness: 0.25, smoothChroma: true },
    },
  },
];

export default function ImageAdjustmentScreen() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [videoTrack, setVideoTrack] = useState<MediaStreamTrack | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activePreset, setActivePreset] = useState<string>('Normal');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [resolution, setResolution] = useState<'480p' | '720p' | '1080p'>('720p');

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
    setBypass,
    error,
  } = useImageAdjustment(videoTrack);

  const {
    isEnabled: faceDetectionEnabled,
    enable: enableFaceDetection,
    disable: disableFaceDetection,
  } = useFaceDetection(videoTrack);

  const smoothing = config.smoothing ?? { enabled: false, distanceNormalization: 3, texelSpacing: 2, iterations: 3, mix: 0, skinBrightness: 0, smoothChroma: true };
  const skinMask = smoothing.skinMask ?? { feather: 0, eyeProtect: true, mouthProtect: true };

  const resMap = {
    '480p': { width: 640, height: 480 },
    '720p': { width: 1280, height: 720 },
    '1080p': { width: 1920, height: 1080 },
  };

  const startCamera = useCallback(async () => {
    try {
      const res = resMap[resolution];
      const mediaStream = await mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: res.width },
          height: { ideal: res.height },
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
  }, [resolution]);

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
        distanceNormalization: 3,
        texelSpacing: 2,
        iterations: 4,
        smoothChroma: true,
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
                <Text style={styles.pillText}>x{smoothing.iterations ?? 4}</Text>
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
        {isStreaming && isEnabled && (
          <Pressable
            onPressIn={() => setBypass(true)}
            onPressOut={() => setBypass(false)}
            style={({ pressed }) => [
              styles.holdButton,
              pressed && styles.holdButtonPressed,
            ]}
          >
            <Text style={styles.holdButtonText}>
              {'Hold to Compare'}
            </Text>
          </Pressable>
        )}
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
        <View style={styles.backdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setSheetOpen(false)}
          />
          <View style={styles.sheet}>
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
              bounces={false}
              keyboardShouldPersistTaps="handled"
            >
              <Card style={styles.controlsCard}>
                <Text style={styles.sectionTitle}>Pipeline</Text>
                <Text style={styles.quickLabel}>Resolution (restart camera to apply)</Text>
                <View style={styles.quickButtonRow}>
                  {(['480p', '720p', '1080p'] as const).map(r => (
                    <Button
                      key={r}
                      title={r}
                      onPress={() => setResolution(r)}
                      variant={resolution === r ? 'primary' : 'outline'}
                      style={styles.quickButton}
                    />
                  ))}
                </View>
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
                      <Text style={styles.quickLabel}>Quick Iterations</Text>
                      <View style={styles.quickButtonRow}>
                        {[1, 2, 3, 4, 6, 8].map(n => (
                          <Button
                            key={n}
                            title={String(n)}
                            onPress={() => setSmoothing({ iterations: n })}
                            variant={(smoothing.iterations ?? 4) === n ? 'primary' : 'outline'}
                            style={styles.quickButton}
                          />
                        ))}
                      </View>
                      <SliderControl
                        label="Distance Normalization"
                        value={smoothing.distanceNormalization}
                        onValueChange={v => setSmoothing({ distanceNormalization: v })}
                        minimumValue={1}
                        maximumValue={8}
                      />
                      <SliderControl
                        label="Texel Spacing"
                        value={smoothing.texelSpacing}
                        onValueChange={v => setSmoothing({ texelSpacing: v })}
                        minimumValue={1}
                        maximumValue={4}
                      />
                      <SliderControl
                        label="Iterations"
                        value={smoothing.iterations ?? 4}
                        onValueChange={v => setSmoothing({ iterations: Math.round(v) })}
                        minimumValue={1}
                        maximumValue={8}
                        step={1}
                      />
                      <SliderControl
                        label="Texture Preservation (Mix)"
                        value={smoothing.mix ?? 0}
                        onValueChange={v => setSmoothing({ mix: v })}
                        minimumValue={0}
                        maximumValue={1}
                        step={0.01}
                      />
                      <SliderControl
                        label="Skin Brightness (Glow)"
                        value={smoothing.skinBrightness ?? 0}
                        onValueChange={v => setSmoothing({ skinBrightness: v })}
                        minimumValue={0}
                        maximumValue={1}
                        step={0.01}
                      />
                      <View style={styles.toggleRow}>
                        <Text style={styles.toggleLabel}>Chroma Smoothing</Text>
                        <Button
                          title={smoothing.smoothChroma !== false ? 'On' : 'Off'}
                          onPress={() => setSmoothing({ smoothChroma: smoothing.smoothChroma === false })}
                          variant={smoothing.smoothChroma !== false ? 'primary' : 'outline'}
                          style={styles.toggleButton}
                        />
                      </View>
                    </>
                  )}
                  <Text style={styles.hintText}>
                    Larger distance normalization = stronger smoothing, fewer edges preserved.
                    Larger texel spacing = wider blur. More iterations = stronger smoothing (1-8).
                    Chroma smoothing reduces skin discoloration.
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
                        <StatusIndicator
                          label="Iterations"
                          value={smoothing.iterations ?? 4}
                          status="warning"
                        />
                        <StatusIndicator
                          label="Mix (Texture)"
                          value={(smoothing.mix ?? 0).toFixed(2)}
                          status={smoothing.mix ? 'warning' : 'info'}
                        />
                        <StatusIndicator
                          label="Skin Brightness"
                          value={(smoothing.skinBrightness ?? 0).toFixed(2)}
                          status={smoothing.skinBrightness ? 'warning' : 'info'}
                        />
                        <StatusIndicator
                          label="Chroma Smooth"
                          value={smoothing.smoothChroma !== false}
                          status={smoothing.smoothChroma !== false ? 'success' : 'info'}
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
                <Text style={styles.infoList}>{'\u2022'} Skin Smoothing — multi-pass bilateral blur (Metal / GLES) gated by face-detected skin mask</Text>
                <Text style={styles.infoList}>{'\u2022'} Texture Preservation (Mix) — blends original texture back for a natural "flawless" look</Text>
                <Text style={styles.infoList}>{'\u2022'} Skin Brightness — targeted glow within the skin region</Text>
                <Text style={styles.infoList}>{'\u2022'} Chroma Smoothing — 3x3 box blur on U/V planes to reduce skin discoloration</Text>
              </Card>
            </ScrollView>
          </View>
        </View>
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
  holdButton: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.sm,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  holdButtonPressed: {
    backgroundColor: 'rgba(239,68,68,0.3)',
    borderColor: colors.error,
  },
  holdButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
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
  quickLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  quickButtonRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  quickButton: {
    flex: 1,
    minWidth: 0,
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
