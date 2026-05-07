import { NativeModules, Platform } from 'react-native';
const { WebRTCModule } = NativeModules;

if (WebRTCModule === null) {
    throw new Error(`WebRTC native module not found.\n${Platform.OS === 'ios' ?
        'Try executing the "pod install" command inside your projects ios folder.' :
        'Try executing the "npm install" command inside your projects folder.'
    }`);
}

import { setupNativeEvents } from './EventEmitter';
import type {
    FaceDetectionConfig,
    FaceDetectionResult,
    Face,
    BoundingBox,
    FaceLandmarks,
    EyeData,
    HeadPose,
    BlinkEvent,
    MouthData,
    NoseData,
    FaceDetectionOverlayConfig,
} from './FaceDetection.types';
import type {
    ImageAdjustmentConfig,
    ImageAdjustmentSkinMaskConfig,
    ImageAdjustmentSmoothingConfig,
} from './ImageAdjustment.types';
import Logger from './Logger';
import mediaDevices from './MediaDevices';
import MediaStream from './MediaStream';
import MediaStreamTrack, { type MediaTrackSettings } from './MediaStreamTrack';
import MediaStreamTrackEvent from './MediaStreamTrackEvent';
import permissions from './Permissions';
import RTCAudioSession from './RTCAudioSession';
import RTCErrorEvent from './RTCErrorEvent';
import RTCIceCandidate from './RTCIceCandidate';
import RTCPIPView, { startIOSPIP, stopIOSPIP } from './RTCPIPView';
import RTCPeerConnection from './RTCPeerConnection';
import RTCRtpReceiver from './RTCRtpReceiver';
import RTCRtpSender from './RTCRtpSender';
import RTCRtpTransceiver from './RTCRtpTransceiver';
import RTCSessionDescription from './RTCSessionDescription';
import RTCView, { type RTCVideoViewProps, type RTCIOSPIPOptions } from './RTCView';
import ScreenCapturePickerView from './ScreenCapturePickerView';
import { configureWebRTC, type WebRTCConfig } from './WebRTCModuleConfig';
import FaceDetectionOverlay from './components/FaceDetectionOverlay';
import { useBlinkDetection } from './hooks/useBlinkDetection';
import { useFaceDetection } from './hooks/useFaceDetection';
import { useImageAdjustment } from './hooks/useImageAdjustment';

Logger.enable(`${Logger.ROOT_PREFIX}:*`);

// Add listeners for the native events early, since they are added asynchronously.
setupNativeEvents();

export {
    RTCIceCandidate,
    RTCPeerConnection,
    RTCSessionDescription,
    RTCView,
    RTCPIPView,
    ScreenCapturePickerView,
    RTCRtpTransceiver,
    RTCRtpReceiver,
    RTCRtpSender,
    RTCErrorEvent,
    RTCAudioSession,
    MediaStream,
    MediaStreamTrack,
    type MediaTrackSettings,
    type RTCVideoViewProps,
    type RTCIOSPIPOptions,
    mediaDevices,
    permissions,
    registerGlobals,
    startIOSPIP,
    stopIOSPIP,
    // Configuration
    configureWebRTC,
    type WebRTCConfig,
    // Face Detection
    useFaceDetection,
    useBlinkDetection,
    FaceDetectionOverlay,
    type FaceDetectionConfig,
    type FaceDetectionResult,
    type Face,
    type BoundingBox,
    type FaceLandmarks,
    type EyeData,
    type HeadPose,
    type BlinkEvent,
    type MouthData,
    type NoseData,
    type FaceDetectionOverlayConfig,
    // Image Adjustment
    useImageAdjustment,
    type ImageAdjustmentConfig,
    type ImageAdjustmentSmoothingConfig,
    type ImageAdjustmentSkinMaskConfig,
};

declare const global: any;

function registerGlobals(): void {
    // Should not happen. React Native has a global navigator object.
    if (typeof global.navigator !== 'object') {
        throw new Error('navigator is not an object');
    }

    if (!global.navigator.mediaDevices) {
        global.navigator.mediaDevices = {};
    }

    global.navigator.mediaDevices.getUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
    global.navigator.mediaDevices.getDisplayMedia = mediaDevices.getDisplayMedia.bind(mediaDevices);
    global.navigator.mediaDevices.enumerateDevices = mediaDevices.enumerateDevices.bind(mediaDevices);

    global.RTCIceCandidate = RTCIceCandidate;
    global.RTCPeerConnection = RTCPeerConnection;
    global.RTCRtpReceiver = RTCRtpReceiver;
    global.RTCRtpSender = RTCRtpReceiver;
    global.RTCSessionDescription = RTCSessionDescription;
    global.MediaStream = MediaStream;
    global.MediaStreamTrack = MediaStreamTrack;
    global.MediaStreamTrackEvent = MediaStreamTrackEvent;
    global.RTCRtpTransceiver = RTCRtpTransceiver;
    global.RTCRtpReceiver = RTCRtpReceiver;
    global.RTCRtpSender = RTCRtpSender;
    global.RTCErrorEvent = RTCErrorEvent;
}
