import { EventTarget, Event, defineEventAttribute } from 'event-target-shim/index';
import { NativeModules } from 'react-native';

import { MediaTrackConstraints } from './Constraints';
import { addListener, removeListener } from './EventEmitter';
import { FaceDetectionConfig, FaceDetectionResult, BlinkEvent } from './FaceDetection.types';
import { ImageAdjustmentConfig } from './ImageAdjustment.types';
import Logger from './Logger';
import { deepClone, normalizeConstraints } from './RTCUtil';
import { isFeatureEnabled } from './WebRTCModuleConfig';

const log = new Logger('pc');
const { WebRTCModule } = NativeModules;


type MediaStreamTrackState = 'live' | 'ended';

export type MediaStreamTrackInfo = {
    id: string;
    kind: string;
    remote: boolean;
    constraints: object;
    enabled: boolean;
    settings: object;
    peerConnectionId: number;
    readyState: MediaStreamTrackState;
}

export type MediaTrackSettings = {
    width?: number;
    height?: number;
    frameRate?: number;
    facingMode?: string;
    deviceId?: string;
    groupId?: string;
}

type MediaStreamTrackEventMap = {
    ended: Event<'ended'>;
    mute: Event<'mute'>;
    unmute: Event<'unmute'>;
    facedetected: CustomEvent<FaceDetectionResult>;
    blinkdetected: CustomEvent<BlinkEvent>;
}

class CustomEvent<T> extends Event {
    detail: T;
    constructor(type: string, detail: T) {
        super(type);
        this.detail = detail;
    }
}

export default class MediaStreamTrack extends EventTarget<MediaStreamTrackEventMap> {
    _constraints: MediaTrackConstraints;
    _enabled: boolean;
    _settings: MediaTrackSettings;
    _muted: boolean;
    _peerConnectionId: number;
    _readyState: MediaStreamTrackState;
    _faceDetectionEnabled = false;
    _imageAdjustmentEnabled = false;
    _activeEffects: Set<string> = new Set();

    readonly id: string;
    readonly kind: string;
    readonly label: string = '';
    readonly remote: boolean;

    constructor(info: MediaStreamTrackInfo) {
        super();

        this._constraints = info.constraints || {};
        this._enabled = info.enabled;
        this._settings = info.settings || {};
        this._muted = false;
        this._peerConnectionId = info.peerConnectionId;
        this._readyState = info.readyState;

        this.id = info.id;
        this.kind = info.kind;
        this.remote = info.remote;

        if (!this.remote) {
            this._registerEvents();
        }
    }

    get enabled(): boolean {
        return this._enabled;
    }

    set enabled(enabled: boolean) {
        if (enabled === this._enabled) {
            return;
        }

        this._enabled = Boolean(enabled);

        if (this._readyState === 'ended') {
            return;
        }

        WebRTCModule.mediaStreamTrackSetEnabled(this.remote ? this._peerConnectionId : -1, this.id, this._enabled);
    }

    get muted(): boolean {
        return this._muted;
    }

    get readyState(): string {
        return this._readyState;
    }

    stop(): void {
        this.enabled = false;
        this._readyState = 'ended';
    }

    /**
     * Private / custom API for switching the cameras on the fly, without the
     * need for adding / removing tracks or doing any SDP renegotiation.
     *
     * This is how the reference application (AppRTCMobile) implements camera
     * switching.
     *
     * @deprecated Use applyConstraints instead.
     */
    _switchCamera(): void {
        if (this.remote) {
            throw new Error('Not implemented for remote tracks');
        }

        if (this.kind !== 'video') {
            throw new Error('Only implemented for video tracks');
        }

        const constraints = deepClone(this._settings);

        delete constraints.deviceId;
        constraints.facingMode = this._settings.facingMode === 'user' ? 'environment' : 'user';

        this.applyConstraints(constraints);
    }

    _setVideoEffects(names: string[]) {
        if (this.remote) {
            throw new Error('Not implemented for remote tracks');
        }

        if (this.kind !== 'video') {
            throw new Error('Only implemented for video tracks');
        }

        WebRTCModule.mediaStreamTrackSetVideoEffects(this.id, names);
    }

    _setVideoEffect(name: string) {
        this._setVideoEffects([ name ]);
    }

    /**
     * Internal function which is used to set the muted state on remote tracks and
     * emit the mute / unmute event.
     *
     * @param muted Whether the track should be marked as muted / unmuted.
     */
    _setMutedInternal(muted: boolean) {
        if (!this.remote) {
            throw new Error('Track is not remote!');
        }

        this._muted = muted;
        this.dispatchEvent(new Event(muted ? 'mute' : 'unmute'));
    }

    /**
     * Custom API for setting the volume on an individual audio track.
     *
     * @param volume a gain value in the range of 0-10. defaults to 1.0
     */
    _setVolume(volume: number) {
        if (this.kind !== 'audio') {
            throw new Error('Only implemented for audio tracks');
        }

        WebRTCModule.mediaStreamTrackSetVolume(this.remote ? this._peerConnectionId : -1, this.id, volume);
    }

    /**
     * Applies a new set of constraints to the track.
     *
     * @param constraints An object listing the constraints
     * to apply to the track's constrainable properties; any existing
     * constraints are replaced with the new values specified, and any
     * constrainable properties not included are restored to their default
     * constraints. If this parameter is omitted, all currently set custom
     * constraints are cleared.
     */
    async applyConstraints(constraints?: MediaTrackConstraints): Promise<void> {
        if (this.kind !== 'video') {
            throw new Error('Only implemented for video tracks');
        }

        const normalized = normalizeConstraints({ video: constraints ?? true });

        this._settings = await WebRTCModule.mediaStreamTrackApplyConstraints(this.id, normalized.video);
        this._constraints = constraints ?? {};
    }

    clone(): never {
        throw new Error('Not implemented.');
    }

    getCapabilities(): never {
        throw new Error('Not implemented.');
    }

    getConstraints() {
        return deepClone(this._constraints);
    }

    getSettings(): MediaTrackSettings {
        return deepClone(this._settings);
    }

    _registerEvents(): void {
        addListener(this, 'mediaStreamTrackEnded', (ev: any) => {
            if (ev.trackId !== this.id || this._readyState === 'ended') {
                return;
            }

            log.debug(`${this.id} mediaStreamTrackEnded`);
            this._readyState = 'ended';

            this.dispatchEvent(new Event('ended'));
        });
    }

    /**
     * Enable face detection for this video track
     *
     * @param config Optional configuration for face detection
     * @returns Promise that resolves when face detection is enabled
     * @throws {Error} If face detection is disabled in module configuration
     */
    async enableFaceDetection(config?: FaceDetectionConfig): Promise<void> {
        if (!isFeatureEnabled('enableFaceDetection')) {
            throw new Error(
                'Face detection is disabled. Enable it by calling configureWebRTC({ enableFaceDetection: true })'
            );
        }

        if (this.kind !== 'video') {
            throw new Error('Face detection is only available for video tracks');
        }

        if (this.remote) {
            throw new Error('Face detection is not supported for remote tracks');
        }

        await WebRTCModule.enableFaceDetection(this.id, config || {});
        this._faceDetectionEnabled = true;

        // Add to active effects and apply
        this._activeEffects.add('faceDetection');
        this._setVideoEffects(Array.from(this._activeEffects));
    }

    /**
     * Disable face detection for this video track
     *
     * @returns Promise that resolves when face detection is disabled
     */
    async disableFaceDetection(): Promise<void> {
        if (this.kind !== 'video') {
            throw new Error('Face detection is only available for video tracks');
        }

        if (!this._faceDetectionEnabled) {
            return;
        }

        await WebRTCModule.disableFaceDetection(this.id);
        this._faceDetectionEnabled = false;

        // Remove from active effects and apply remaining
        this._activeEffects.delete('faceDetection');
        this._setVideoEffects(Array.from(this._activeEffects));
    }

    /**
     * Check if face detection is currently enabled
     */
    get isFaceDetectionEnabled(): boolean {
        return this._faceDetectionEnabled;
    }

    /**
     * Enable image adjustment for this video track
     *
     * @param config Optional configuration for image adjustments
     * @returns Promise that resolves when image adjustment is enabled
     */
    async enableImageAdjustment(config?: Partial<ImageAdjustmentConfig>): Promise<void> {
        if (this.kind !== 'video') {
            throw new Error('Image adjustment is only available for video tracks');
        }

        if (this.remote) {
            throw new Error('Image adjustment is not supported for remote tracks');
        }

        await WebRTCModule.enableImageAdjustment(this.id, config || {});
        this._imageAdjustmentEnabled = true;

        // Add to active effects and apply
        this._activeEffects.add('imageAdjustment');
        this._setVideoEffects(Array.from(this._activeEffects));
    }

    /**
     * Update image adjustment configuration without re-enabling
     *
     * @param config Configuration values to update
     * @returns Promise that resolves when the update is applied
     */
    async updateImageAdjustment(config: Partial<ImageAdjustmentConfig>): Promise<void> {
        if (this.kind !== 'video') {
            throw new Error('Image adjustment is only available for video tracks');
        }

        if (!this._imageAdjustmentEnabled) {
            throw new Error('Image adjustment is not enabled');
        }

        await WebRTCModule.updateImageAdjustment(this.id, config);
    }

    /**
     * Disable image adjustment for this video track
     *
     * @returns Promise that resolves when image adjustment is disabled
     */
    async disableImageAdjustment(): Promise<void> {
        if (this.kind !== 'video') {
            throw new Error('Image adjustment is only available for video tracks');
        }

        if (!this._imageAdjustmentEnabled) {
            return;
        }

        await WebRTCModule.disableImageAdjustment(this.id);
        this._imageAdjustmentEnabled = false;

        // Remove from active effects and apply remaining
        this._activeEffects.delete('imageAdjustment');
        this._setVideoEffects(Array.from(this._activeEffects));
    }

    /**
     * Bypass image adjustment processing without resetting config.
     * When bypassed, the processor returns the original frame unchanged.
     * Useful for before/after comparison without going through the
     * full enable/disable lifecycle.
     */
    async bypassImageAdjustment(bypass: boolean): Promise<void> {
        if (this.kind !== 'video') {
            throw new Error('Image adjustment is only available for video tracks');
        }

        await WebRTCModule.bypassImageAdjustment(this.id, bypass);
    }

    /**
     * Check if image adjustment is currently enabled
     */
    get isImageAdjustmentEnabled(): boolean {
        return this._imageAdjustmentEnabled;
    }

    release(): void {
        if (this.remote) {
            return;
        }

        // Clean up face detection if enabled
        if (this._faceDetectionEnabled) {
            this.disableFaceDetection().catch(() => {
                // Ignore errors during cleanup
            });
        }

        // Clean up image adjustment if enabled
        if (this._imageAdjustmentEnabled) {
            this.disableImageAdjustment().catch(() => {
                // Ignore errors during cleanup
            });
        }

        removeListener(this);
        WebRTCModule.mediaStreamTrackRelease(this.id);
    }
}

/**
 * Define the `onxxx` event handlers.
 */
const proto = MediaStreamTrack.prototype;

defineEventAttribute(proto, 'ended');
defineEventAttribute(proto, 'mute');
defineEventAttribute(proto, 'unmute');
defineEventAttribute(proto, 'facedetected');
defineEventAttribute(proto, 'blinkdetected');
