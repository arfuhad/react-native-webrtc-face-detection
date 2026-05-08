#import "ImageAdjustmentProcessor.h"
#import "BilateralSmoother.h"
#import "FaceResultCache.h"
#import "SkinMaskBuilder.h"
#import <WebRTC/RTCVideoFrame.h>
#import <WebRTC/RTCVideoFrameBuffer.h>
#import <WebRTC/RTCNativeI420Buffer.h>
#import <WebRTC/RTCNativeMutableI420Buffer.h>
#import <WebRTC/RTCYUVPlanarBuffer.h>

static inline int sm_clampi(int v, int lo, int hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
}

@interface ImageAdjustmentProcessor () {
    uint8_t _yLUT[256];
    uint8_t _uLUT[256];
    uint8_t _vLUT[256];
    BOOL _toneIsDefault;   // all 4 LUT params at neutral
    BilateralSmoother *_smoother;

    // Reusable scratch buffers for the per-frame pipeline. Sized to the
    // current frame resolution and re-allocated only when the resolution
    // changes. This avoids a malloc/free pair on every frame.
    uint8_t *_scratchSmoothedY;
    uint8_t *_scratchMask;
    uint8_t *_scratchOutputY;
    uint8_t *_scratchOutputU;
    uint8_t *_scratchOutputV;
    int      _scratchAllocatedWidth;
    int      _scratchAllocatedHeight;

    // One-shot log guards so dev-time failures show up once instead of
    // flooding the log at 30 fps.
    BOOL _loggedSmootherFailure;
    BOOL _loggedMissingFace;
}
@end

@implementation ImageAdjustmentProcessor

- (instancetype)init {
    self = [super init];
    if (self) {
        _isEnabled = NO;
        _exposure = 0.0;
        _contrast = 1.0;
        _saturation = 1.0;
        _colorTemperature = 0.0;
        _smoothingEnabled = NO;
        _smoothingDistanceNormalization = 3.0;
        _smoothingTexelSpacing = 2.0;
        _smoothingIterations = 4;
        _smoothingMix = 0.0;
        _smoothingSkinBrightness = 0.0;
        _smoothingSmoothChroma = YES;
        _skinMaskEnabled = YES;
        _skinMaskFeatherPx = 0;       // 0 = auto (face-height based)
        _skinMaskEyeProtect = YES;
        _skinMaskMouthProtect = YES;
        _toneIsDefault = YES;
        _smoother = [[BilateralSmoother alloc] init];
        _scratchSmoothedY = NULL;
        _scratchMask = NULL;
        _scratchAllocatedWidth = 0;
        _scratchAllocatedHeight = 0;
        _loggedSmootherFailure = NO;
        _loggedMissingFace = NO;
        [self rebuildLUTs];
        [self syncSmootherConfig];
    }
    return self;
}

- (void)dealloc {
    free(_scratchSmoothedY);
    free(_scratchMask);
    free(_scratchOutputY);
    free(_scratchOutputU);
    free(_scratchOutputV);
}

- (void)updateConfig:(NSDictionary *)config {
    @synchronized (self) {
        if (config[@"exposure"]) {
            _exposure = [config[@"exposure"] floatValue];
        }
        if (config[@"contrast"]) {
            _contrast = [config[@"contrast"] floatValue];
        }
        if (config[@"saturation"]) {
            _saturation = [config[@"saturation"] floatValue];
        }
        if (config[@"colorTemperature"]) {
            _colorTemperature = [config[@"colorTemperature"] floatValue];
        }

        id smoothingVal = config[@"smoothing"];
        if ([smoothingVal isKindOfClass:[NSDictionary class]]) {
            NSDictionary *smoothing = (NSDictionary *)smoothingVal;
            if (smoothing[@"enabled"]) {
                _smoothingEnabled = [smoothing[@"enabled"] boolValue];
            }
            if (smoothing[@"distanceNormalization"]) {
                _smoothingDistanceNormalization = [smoothing[@"distanceNormalization"] floatValue];
            }
            if (smoothing[@"texelSpacing"]) {
                _smoothingTexelSpacing = [smoothing[@"texelSpacing"] floatValue];
            }
            if (smoothing[@"iterations"]) {
                _smoothingIterations = [smoothing[@"iterations"] intValue];
            }
            if (smoothing[@"mix"]) {
                _smoothingMix = [smoothing[@"mix"] floatValue];
            }
            if (smoothing[@"skinBrightness"]) {
                _smoothingSkinBrightness = [smoothing[@"skinBrightness"] floatValue];
            }
            if (smoothing[@"smoothChroma"]) {
                _smoothingSmoothChroma = [smoothing[@"smoothChroma"] boolValue];
            }

            // smoothing.skinMask sub-dict. Each field is independently optional
            // so callers can toggle one without clobbering others.
            id skinMaskVal = smoothing[@"skinMask"];
            if ([skinMaskVal isKindOfClass:[NSDictionary class]]) {
                NSDictionary *skinMask = (NSDictionary *)skinMaskVal;
                if (skinMask[@"enabled"]) {
                    _skinMaskEnabled = [skinMask[@"enabled"] boolValue];
                }
                if (skinMask[@"feather"]) {
                    _skinMaskFeatherPx = [skinMask[@"feather"] intValue];
                }
                if (skinMask[@"eyeProtect"]) {
                    _skinMaskEyeProtect = [skinMask[@"eyeProtect"] boolValue];
                }
                if (skinMask[@"mouthProtect"]) {
                    _skinMaskMouthProtect = [skinMask[@"mouthProtect"] boolValue];
                }
            }
        }

        [self rebuildLUTs];
        [self syncSmootherConfig];
    }
}

- (void)reset {
    @synchronized (self) {
        _exposure = 0.0;
        _contrast = 1.0;
        _saturation = 1.0;
        _colorTemperature = 0.0;
        _smoothingEnabled = NO;
        _smoothingDistanceNormalization = 3.0;
        _smoothingTexelSpacing = 2.0;
        _smoothingIterations = 4;
        _smoothingMix = 0.0;
        _smoothingSkinBrightness = 0.0;
        _smoothingSmoothChroma = YES;
        _skinMaskEnabled = YES;
        _skinMaskFeatherPx = 0;
        _skinMaskEyeProtect = YES;
        _skinMaskMouthProtect = YES;
        _toneIsDefault = YES;
        _loggedSmootherFailure = NO;
        _loggedMissingFace = NO;
        [self rebuildLUTs];
        [self syncSmootherConfig];
    }
}

- (void)syncSmootherConfig {
    [_smoother updateConfig:_smoothingEnabled
               distanceNorm:(float)_smoothingDistanceNormalization
               texelSpacing:(float)_smoothingTexelSpacing
                 iterations:_smoothingIterations
                        mix:_smoothingMix
             skinBrightness:_smoothingSkinBrightness];
}

- (void)rebuildLUTs {
    _toneIsDefault = (_exposure == 0.0 && _contrast == 1.0 &&
                     _saturation == 1.0 && _colorTemperature == 0.0);

    if (_toneIsDefault) {
        return;
    }

    CGFloat exposureOffset = _exposure * 128.0;

    // Y LUT: Y' = clamp((Y - 128) * contrast + 128 + exposureOffset, 0, 255)
    for (int i = 0; i < 256; i++) {
        CGFloat val = ((CGFloat)i - 128.0) * _contrast + 128.0 + exposureOffset;
        _yLUT[i] = (uint8_t)MAX(0, MIN(255, (int)(val + 0.5)));
    }

    CGFloat tempUShift = -_colorTemperature * 30.0;
    CGFloat tempVShift =  _colorTemperature * 30.0;

    for (int i = 0; i < 256; i++) {
        CGFloat val = ((CGFloat)i - 128.0) * _saturation + 128.0 + tempUShift;
        _uLUT[i] = (uint8_t)MAX(0, MIN(255, (int)(val + 0.5)));
    }
    for (int i = 0; i < 256; i++) {
        CGFloat val = ((CGFloat)i - 128.0) * _saturation + 128.0 + tempVShift;
        _vLUT[i] = (uint8_t)MAX(0, MIN(255, (int)(val + 0.5)));
    }
}

// Ensure the reusable scratch buffers cover the current frame resolution.
// Called on the capture thread (single-threaded w.r.t. the scratch state).
- (BOOL)ensureScratchBuffersForWidth:(int)width height:(int)height {
    if (_scratchSmoothedY && _scratchMask && _scratchOutputY && _scratchOutputU && _scratchOutputV &&
        _scratchAllocatedWidth == width &&
        _scratchAllocatedHeight == height) {
        return YES;
    }

    free(_scratchSmoothedY);
    free(_scratchMask);
    free(_scratchOutputY);
    free(_scratchOutputU);
    free(_scratchOutputV);
    _scratchSmoothedY = NULL;
    _scratchMask = NULL;
    _scratchOutputY = NULL;
    _scratchOutputU = NULL;
    _scratchOutputV = NULL;
    _scratchAllocatedWidth = 0;
    _scratchAllocatedHeight = 0;

    size_t n = (size_t)width * (size_t)height;
    int chromaWidth  = (width  + 1) / 2;
    int chromaHeight = (height + 1) / 2;
    size_t nChroma = (size_t)chromaWidth * (size_t)chromaHeight;

    _scratchSmoothedY = (uint8_t *)malloc(n);
    _scratchMask      = (uint8_t *)malloc(n);
    _scratchOutputY   = (uint8_t *)malloc(n);
    _scratchOutputU   = (uint8_t *)malloc(nChroma);
    _scratchOutputV   = (uint8_t *)malloc(nChroma);

    if (!_scratchSmoothedY || !_scratchMask || !_scratchOutputY || !_scratchOutputU || !_scratchOutputV) {
        free(_scratchSmoothedY);
        free(_scratchMask);
        free(_scratchOutputY);
        free(_scratchOutputU);
        free(_scratchOutputV);
        _scratchSmoothedY = NULL;
        _scratchMask = NULL;
        _scratchOutputY = NULL;
        _scratchOutputU = NULL;
        _scratchOutputV = NULL;
        return NO;
    }
    _scratchAllocatedWidth  = width;
    _scratchAllocatedHeight = height;
    return YES;
}

#pragma mark - VideoFrameProcessorDelegate

- (RTCVideoFrame *)capturer:(RTCVideoCapturer *)capturer didCaptureVideoFrame:(RTCVideoFrame *)frame {
    if (!self.isEnabled) {
        return frame;
    }

    // Snapshot config under lock to avoid param changes mid-frame.
    uint8_t localYLUT[256];
    uint8_t localULUT[256];
    uint8_t localVLUT[256];
    BOOL    toneIsDefault;
    BOOL    smoothingActive;
    BOOL    smoothChroma;
    BOOL    skinMaskEnabled;
    int     skinMaskFeatherPx;
    BOOL    skinMaskEyeProtect;
    BOOL    skinMaskMouthProtect;
    float   smoothingMix;
    float   smoothingSkinBrightness;

    @synchronized (self) {
        toneIsDefault        = _toneIsDefault;
        smoothingActive      = _smoothingEnabled;
        smoothChroma         = _smoothingSmoothChroma;
        skinMaskEnabled      = _skinMaskEnabled;
        skinMaskFeatherPx    = _skinMaskFeatherPx;
        skinMaskEyeProtect   = _skinMaskEyeProtect;
        skinMaskMouthProtect = _skinMaskMouthProtect;
        smoothingMix         = (float)_smoothingMix;
        smoothingSkinBrightness = (float)_smoothingSkinBrightness;

        if (!toneIsDefault) {
            memcpy(localYLUT, _yLUT, 256);
            memcpy(localULUT, _uLUT, 256);
            memcpy(localVLUT, _vLUT, 256);
        }
    }

    // Fast path: no tone adjustment AND no smoothing -> pass through unchanged.
    if (toneIsDefault && !smoothingActive) {
        return frame;
    }

    id<RTCI420Buffer> i420Buffer = [frame.buffer toI420];
    if (!i420Buffer) {
        return frame;
    }

    int width  = i420Buffer.width;
    int height = i420Buffer.height;
    int chromaWidth  = (width  + 1) / 2;
    int chromaHeight = (height + 1) / 2;

    const uint8_t *srcY = i420Buffer.dataY;
    const uint8_t *srcU = i420Buffer.dataU;
    const uint8_t *srcV = i420Buffer.dataV;
    int srcStrideY = i420Buffer.strideY;
    int srcStrideU = i420Buffer.strideU;
    int srcStrideV = i420Buffer.strideV;

    if (![self ensureScratchBuffersForWidth:width height:height]) {
        return frame;
    }

    uint8_t *dstY = _scratchOutputY;
    uint8_t *dstU = _scratchOutputU;
    uint8_t *dstV = _scratchOutputV;
    int dstStrideY = width;
    int dstStrideU = chromaWidth;
    int dstStrideV = chromaWidth;

    // --- Stage 1: Y plane smoothing ---
    const uint8_t *yForLUT       = srcY;
    int            yForLUTStride = srcStrideY;
    BOOL smoothingProducedOutput = NO;
    FDCFaceResult face = { .valid = NO };

    if (smoothingActive) {
        face = [[FaceResultCache sharedInstance] getIfFresh:500000000];

        if (skinMaskEnabled && !face.valid) {
            if (!_loggedMissingFace) {
                NSLog(@"[ImageAdjustment] smoothing enabled but no recent face — no-op");
                _loggedMissingFace = YES;
            }
        } else {
            if (face.valid) {
                _loggedMissingFace = NO;
            }

            BOOL ok = [_smoother smoothYPlane:srcY
                                    srcStride:srcStrideY
                                     dstPlane:_scratchSmoothedY
                                        width:width
                                       height:height];
            if (ok) {
                smoothingProducedOutput = YES;
            } else if (!_loggedSmootherFailure) {
                NSLog(@"[ImageAdjustment] BilateralSmoother failed");
                _loggedSmootherFailure = YES;
            }
        }
    }

    if (smoothingProducedOutput) {
        if (skinMaskEnabled && face.valid) {
            memset(_scratchMask, 0, (size_t)width * (size_t)height);
            int feather = skinMaskFeatherPx;
            if (feather <= 0) {
                feather = MAX(6, (int)(face.bbox.size.height * 0.08));
            }

            [SkinMaskBuilder buildMask:_scratchMask
                                 width:width
                                height:height
                                  face:face
                             featherPx:feather
                            eyeProtect:skinMaskEyeProtect
                          mouthProtect:skinMaskMouthProtect];

            int bx0 = sm_clampi((int)floor(face.bbox.origin.x - feather), 0, width);
            int by0 = sm_clampi((int)floor(face.bbox.origin.y - feather), 0, height);
            int bx1 = sm_clampi((int)ceil(face.bbox.origin.x + face.bbox.size.width + feather), 0, width);
            int by1 = sm_clampi((int)ceil(face.bbox.origin.y + face.bbox.size.height + feather), 0, height);

            for (int y = 0; y < height; y++) {
                const uint8_t *sRow = srcY + (size_t)y * (size_t)srcStrideY;
                uint8_t       *smRow = _scratchSmoothedY + (size_t)y * (size_t)width;
                const uint8_t *mRow = _scratchMask + (size_t)y * (size_t)width;

                if (y < by0 || y >= by1) {
                    memcpy(smRow, sRow, (size_t)width);
                    continue;
                }

                if (bx0 > 0) memcpy(smRow, sRow, (size_t)bx0);
                if (bx1 < width) memcpy(smRow + bx1, sRow + bx1, (size_t)(width - bx1));

                uint32_t mix8 = (uint32_t)(smoothingMix * 255.0f + 0.5f);
                int brightnessGain = (int)(smoothingSkinBrightness * 40.0f);

                for (int x = bx0; x < bx1; x++) {
                    uint32_t m = mRow[x];
                    if (m == 0) {
                        smRow[x] = sRow[x];
                    } else {
                        uint32_t s = smRow[x];
                        uint32_t o = sRow[x];
                        if (mix8 > 0) s = (mix8 * o + (255 - mix8) * s + 127) / 255;
                        if (brightnessGain > 0) s = (uint32_t)MAX(0, MIN(255, (int)s + brightnessGain));
                        
                        if (m == 255) smRow[x] = (uint8_t)s;
                        else smRow[x] = (uint8_t)((m * s + (255 - m) * o + 127) / 255);
                    }
                }
            }
            yForLUT = _scratchSmoothedY;
            yForLUTStride = width;
        } else {
            yForLUT = _scratchSmoothedY;
            yForLUTStride = width;
        }
    }

    // --- Stage 2: Y LUT ---
    if (!toneIsDefault) {
        for (int row = 0; row < height; row++) {
            const uint8_t *sRow = yForLUT + row * yForLUTStride;
            uint8_t *dRow = dstY + row * dstStrideY;
            for (int col = 0; col < width; col++) dRow[col] = localYLUT[sRow[col]];
        }
    } else {
        for (int row = 0; row < height; row++) {
            memcpy(dstY + row * dstStrideY, yForLUT + row * yForLUTStride, (size_t)width);
        }
    }

    // --- Stage 3: U/V Chroma ---
    if (smoothingActive && smoothChroma && smoothingProducedOutput) {
        // Separable box blur on U then V using output buffers as scratch
        for (int p = 0; p < 2; p++) {
            const uint8_t *srcP = (p == 0) ? srcU : srcV;
            int strideP = (p == 0) ? srcStrideU : srcStrideV;
            uint8_t *dstP = (p == 0) ? dstU : dstV;
            int dstStrideP = (p == 0) ? dstStrideU : dstStrideV;
            uint8_t *lutP = (p == 0) ? localULUT : localVLUT;

            // Use _scratchMask as temporary 1D scratch for horizontal pass
            uint8_t *hScratch = _scratchMask; // reuse mask buffer as temp memory

            for (int row = 0; row < chromaHeight; row++) {
                const uint8_t *sRow = srcP + row * strideP;
                uint8_t *dRow = hScratch + row * chromaWidth;
                for (int col = 0; col < chromaWidth; col++) {
                    int sum = 0, count = 0;
                    for (int k = -1; k <= 1; k++) {
                        int c = col + k;
                        if (c >= 0 && c < chromaWidth) { sum += sRow[c]; count++; }
                    }
                    dRow[col] = (uint8_t)((sum + count / 2) / count);
                }
            }
            for (int row = 0; row < chromaHeight; row++) {
                uint8_t *dRow = dstP + row * dstStrideP;
                for (int col = 0; col < chromaWidth; col++) {
                    int sum = 0, count = 0;
                    for (int k = -1; k <= 1; k++) {
                        int r = row + k;
                        if (r >= 0 && r < chromaHeight) { sum += hScratch[r * chromaWidth + col]; count++; }
                    }
                    uint8_t blurred = (uint8_t)((sum + count / 2) / count);
                    dRow[col] = toneIsDefault ? blurred : lutP[blurred];
                }
            }
        }
    } else if (!toneIsDefault) {
        for (int row = 0; row < chromaHeight; row++) {
            const uint8_t *sRowU = srcU + row * srcStrideU;
            const uint8_t *sRowV = srcV + row * srcStrideV;
            uint8_t *dRowU = dstU + row * dstStrideU;
            uint8_t *dRowV = dstV + row * dstStrideV;
            for (int col = 0; col < chromaWidth; col++) {
                dRowU[col] = localULUT[sRowU[col]];
                dRowV[col] = localVLUT[sRowV[col]];
            }
        }
    } else {
        for (int row = 0; row < chromaHeight; row++) {
            memcpy(dstU + row * dstStrideU, srcU + row * srcStrideU, (size_t)chromaWidth);
            memcpy(dstV + row * dstStrideV, srcV + row * srcStrideV, (size_t)chromaWidth);
        }
    }

    RTCMutableI420Buffer *newBuffer = [[RTCMutableI420Buffer alloc] initWithWidth:width height:height];
    if (!newBuffer) return frame;

    for (int row = 0; row < height; row++) {
        memcpy(newBuffer.mutableDataY + row * newBuffer.strideY, dstY + row * dstStrideY, (size_t)width);
    }
    for (int row = 0; row < chromaHeight; row++) {
        memcpy(newBuffer.mutableDataU + row * newBuffer.strideU, dstU + row * dstStrideU, (size_t)chromaWidth);
        memcpy(newBuffer.mutableDataV + row * newBuffer.strideV, dstV + row * dstStrideV, (size_t)chromaWidth);
    }

    return [[RTCVideoFrame alloc] initWithBuffer:newBuffer
                                        rotation:frame.rotation
                                     timeStampNs:frame.timeStampNs];
}

@end
