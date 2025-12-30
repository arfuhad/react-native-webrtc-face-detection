/**
 * Configuration options for the WebRTC module
 */
export interface WebRTCConfig {
    /**
     * Enable screen capture functionality (getDisplayMedia)
     * When disabled, getDisplayMedia will throw an error
     * @default true
     */
    enableScreenCapture?: boolean;
    
    /**
     * Enable face detection functionality
     * When disabled, face detection methods will throw an error
     * @default false (opt-in for performance reasons)
     */
    enableFaceDetection?: boolean;
}

/**
 * Global configuration state
 */
const globalConfig: Required<WebRTCConfig> = {
    enableScreenCapture: true,
    enableFaceDetection: false,
};

/**
 * Configure the WebRTC module with optional features
 * 
 * This should be called early in your application, before using any WebRTC features.
 * 
 * @param config Configuration options
 * 
 * @example
 * ```tsx
 * import { configureWebRTC } from 'react-native-webrtc';
 * 
 * // At app startup
 * configureWebRTC({
 *   enableScreenCapture: false,  // Disable screen capture to reduce bundle size
 *   enableFaceDetection: true,   // Enable face detection features
 * });
 * ```
 */
export function configureWebRTC(config: WebRTCConfig): void {
    if (typeof config.enableScreenCapture === 'boolean') {
        globalConfig.enableScreenCapture = config.enableScreenCapture;
    }
    
    if (typeof config.enableFaceDetection === 'boolean') {
        globalConfig.enableFaceDetection = config.enableFaceDetection;
    }
}

/**
 * Get the current configuration
 * @internal
 */
export function getConfig(): Readonly<Required<WebRTCConfig>> {
    return globalConfig;
}

/**
 * Check if a feature is enabled
 * @internal
 */
export function isFeatureEnabled(feature: keyof WebRTCConfig): boolean {
    return globalConfig[feature] ?? false;
}

