#import "ImageAdjustmentProcessor.h"
#import "BilateralSmoother.h"
#import "FaceResultCache.h"
#import "SkinMaskBuilder.h"
#import <WebRTC/RTCVideoFrame.h>
#import <WebRTC/RTCVideoFrameBuffer.h>
#import <WebRTC/RTCNativeI420Buffer.h>
#import <WebRTC/RTCYUVPlanarBuffer.h>

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
    if (_scratchSmoothedY && _scratchMask &&
        _scratchAllocatedWidth == width &&
        _scratchAllocatedHeight == height) {
        return YES;
    }

    free(_scratchSmoothedY);
    free(_scratchMask);
    _scratchSmoothedY = NULL;
    _scratchMask = NULL;
    _scratchAllocatedWidth = 0;
    _scratchAllocatedHeight = 0;

    size_t n = (size_t)width * (size_t)height;
    _scratchSmoothedY = (uint8_t *)malloc(n);
    _scratchMask      = (uint8_t *)malloc(n);
    if (!_scratchSmoothedY || !_scratchMask) {
        free(_scratchSmoothedY);
        free(_scratchMask);
        _scratchSmoothedY = NULL;
        _scratchMask = NULL;
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

    int dstStrideY = width;
    int dstStrideU = chromaWidth;
    int dstStrideV = chromaWidth;
    uint8_t *dstY = (uint8_t *)malloc((size_t)dstStrideY * (size_t)height);
    uint8_t *dstU = (uint8_t *)malloc((size_t)dstStrideU * (size_t)chromaHeight);
    uint8_t *dstV = (uint8_t *)malloc((size_t)dstStrideV * (size_t)chromaHeight);

    if (!dstY || !dstU || !dstV) {
        free(dstY); free(dstU); free(dstV);
        return frame;
    }

    // --- Y plane ---
    //
    // Stage 1: bilateral smoothing (optional). Writes into a reused scratch
    // buffer with tightly-packed width-stride. If skin masking is enabled we
    // also build a coverage mask and then blend smoothedY vs srcY by the
    // mask, limited to the expanded face bbox.
    const uint8_t *yForLUT       = srcY;
    int            yForLUTStride = srcStrideY;

    BOOL smoothingProducedOutput = NO;
    FDCFaceResult face = { .valid = NO };

    if (smoothingActive) {
        // 500ms max age keeps the mask aligned with the face even if ML Kit
        // skips frames. Values older than that are treated as absent.
        face = [[FaceResultCache sharedInstance] getIfFresh:500000000];

        if (skinMaskEnabled && !face.valid) {
            // Gate is on but we have no face — leave the frame untouched
            // rather than smearing the whole image.
            if (!_loggedMissingFace) {
                NSLog(@"[ImageAdjustment] smoothing enabled but no recent face — no-op");
                _loggedMissingFace = YES;
            }
        } else {
            // Reset the missing-face log once we have a face again so a
            // future drop-out is still reported.
            if (face.valid) {
                _loggedMissingFace = NO;
            }

            if ([self ensureScratchBuffersForWidth:width height:height]) {
                BOOL ok = [_smoother smoothYPlane:srcY
                                        srcStride:srcStrideY
                                         dstPlane:_scratchSmoothedY
                                            width:width
                                           height:height];
                if (ok) {
                    smoothingProducedOutput = YES;
                } else {
                    if (!_loggedSmootherFailure) {
                        NSLog(@"[ImageAdjustment] BilateralSmoother returned NO — falling back to source Y");
                        _loggedSmootherFailure = YES;
                    }
                }
            }
        }
    }

    // If smoothing produced output, decide how to feed it into the LUT stage.
    //  * Skin-mask path: blend src <-> smoothed using the mask, inside bbox.
    //  * Full-frame path (skin mask disabled): use smoothed Y directly.
    if (smoothingProducedOutput) {
        if (skinMaskEnabled && face.valid) {
            // Zero the mask (simpler than partial clears; mask buffer is
            // frame-sized but builder only writes inside bbox+feather).
            memset(_scratchMask, 0, (size_t)width * (size_t)height);

            int feather = skinMaskFeatherPx;
            if (feather <= 0) {
                // Auto: scale to face size; clamped at 6px for tiny faces.
                int autoFeather = (int)(face.bbox.size.height * 0.08);
                feather = MAX(6, autoFeather);
            }

            [SkinMaskBuilder buildMask:_scratchMask
                                 width:width
                                height:height
                                  face:face
                             featherPx:feather
                            eyeProtect:skinMaskEyeProtect
                          mouthProtect:skinMaskMouthProtect];

            // Blend only within bbox + feather; outside pixels stay at the
            // source value (mask is zero there).
            int bx0 = (int)floor(face.bbox.origin.x - feather);
            int by0 = (int)floor(face.bbox.origin.y - feather);
            int bx1 = (int)ceil(face.bbox.origin.x + face.bbox.size.width  + feather);
            int by1 = (int)ceil(face.bbox.origin.y + face.bbox.size.height + feather);
            if (bx0 < 0) bx0 = 0;
            if (by0 < 0) by0 = 0;
            if (bx1 > width)  bx1 = width;
            if (by1 > height) by1 = height;

            // First, populate the scratch with src Y (copy), then overwrite
            // the bbox slab with blended values. After this, scratchSmoothedY
            // effectively holds the final "masked smoothed" Y plane.
            //
            // Note: we copy row-by-row from srcY which may have a stride
            // different from width.
            for (int y = 0; y < height; y++) {
                const uint8_t *srcRow = srcY + (size_t)y * (size_t)srcStrideY;
                // Outside the bbox slab we want src; inside the slab we'll
                // blend below. Copy the whole row first — cheap and keeps
                // logic simple. The smoother has already written the whole
                // plane but we need src values for the blend, so overwrite.
                // We don't actually want to stomp the smoothed buffer wholesale;
                // instead, we only copy rows outside bbox and leave smoothed
                // values inside bbox for the blend step.
                if (y < by0 || y >= by1) {
                    memcpy(_scratchSmoothedY + (size_t)y * (size_t)width,
                           srcRow,
                           (size_t)width);
                }
            }

            for (int y = by0; y < by1; y++) {
                const uint8_t *srcRow  = srcY + (size_t)y * (size_t)srcStrideY;
                uint8_t       *smRow   = _scratchSmoothedY + (size_t)y * (size_t)width;
                const uint8_t *maskRow = _scratchMask + (size_t)y * (size_t)width;

                // Left of slab: copy src.
                if (bx0 > 0) {
                    memcpy(smRow, srcRow, (size_t)bx0);
                }
                // Right of slab: copy src.
                if (bx1 < width) {
                    memcpy(smRow + bx1, srcRow + bx1, (size_t)(width - bx1));
                }
                // Inside the slab: blend src and smoothed by mask.
                uint32_t mix8 = (uint32_t)(smoothingMix * 255.0f + 0.5f);
                int brightnessGain = (int)(smoothingSkinBrightness * 40.0f); // Max ~40 units brighter

                for (int x = bx0; x < bx1; x++) {
                    uint32_t m = maskRow[x];
                    if (m == 0) {
                        smRow[x] = srcRow[x];
                    } else {
                        uint32_t s = smRow[x];
                        uint32_t o = srcRow[x];

                        // Texture preservation (mix)
                        if (mix8 > 0) {
                            s = (mix8 * o + (255 - mix8) * s + 127) / 255;
                        }

                        // Skin brightening (targeted glow)
                        if (brightnessGain > 0) {
                            s = (uint32_t)MAX(0, MIN(255, (int)s + brightnessGain));
                        }

                        if (m == 255) {
                            smRow[x] = (uint8_t)s;
                        } else {
                            // (m * s + (255 - m) * o + 127) / 255 — rounded blend.
                            smRow[x] = (uint8_t)((m * s + (255 - m) * o + 127) / 255);
                        }
                    }
                }
            }

            yForLUT       = _scratchSmoothedY;
            yForLUTStride = width;
        } else {
            // skinMask disabled — feed the full smoothed plane through.
            yForLUT       = _scratchSmoothedY;
            yForLUTStride = width;
        }
    }

    // Stage 2: Y LUT (or plain copy if tone defaults).
    if (!toneIsDefault) {
        for (int row = 0; row < height; row++) {
            const uint8_t *srcRow = yForLUT + row * yForLUTStride;
            uint8_t *dstRow = dstY + row * dstStrideY;
            for (int col = 0; col < width; col++) {
                dstRow[col] = localYLUT[srcRow[col]];
            }
        }
    } else {
        for (int row = 0; row < height; row++) {
            memcpy(dstY + row * dstStrideY,
                   yForLUT + row * yForLUTStride,
                   (size_t)width);
        }
    }

    // --- U plane ---
    // Chroma smoothing: separable 3x3 box blur on U/V to reduce skin discoloration.
    // Runs before LUT so the tone mapping operates on smoothed chroma.
    if (smoothingActive && smoothChroma && smoothingProducedOutput) {
        // Allocate chroma scratch if needed.
        size_t chromaPixels = (size_t)chromaWidth * (size_t)chromaHeight;
        uint8_t *scratchChroma = (uint8_t *)malloc(chromaPixels);
        if (scratchChroma) {
            // Horizontal pass: srcU -> scratchChroma
            for (int row = 0; row < chromaHeight; row++) {
                const uint8_t *sRow = srcU + row * srcStrideU;
                uint8_t *dRow = scratchChroma + row * chromaWidth;
                for (int col = 0; col < chromaWidth; col++) {
                    int sum = 0;
                    int count = 0;
                    for (int k = -1; k <= 1; k++) {
                        int c = col + k;
                        if (c >= 0 && c < chromaWidth) {
                            sum += sRow[c];
                            count++;
                        }
                    }
                    dRow[col] = (uint8_t)((sum + count / 2) / count);
                }
            }
            // Vertical pass: scratchChroma -> dstU (with optional LUT)
            for (int row = 0; row < chromaHeight; row++) {
                uint8_t *dRow = dstU + row * dstStrideU;
                for (int col = 0; col < chromaWidth; col++) {
                    int sum = 0;
                    int count = 0;
                    for (int k = -1; k <= 1; k++) {
                        int r = row + k;
                        if (r >= 0 && r < chromaHeight) {
                            sum += scratchChroma[r * chromaWidth + col];
                            count++;
                        }
                    }
                    uint8_t blurred = (uint8_t)((sum + count / 2) / count);
                    dRow[col] = toneIsDefault ? blurred : localULUT[blurred];
                }
            }
            free(scratchChroma);
        } else {
            // Fallback: no smoothing, just LUT or copy
            for (int row = 0; row < chromaHeight; row++) {
                const uint8_t *srcRow = srcU + row * srcStrideU;
                uint8_t *dstRow = dstU + row * dstStrideU;
                for (int col = 0; col < chromaWidth; col++) {
                    dstRow[col] = toneIsDefault ? srcRow[col] : localULUT[srcRow[col]];
                }
            }
        }
    } else if (!toneIsDefault) {
        for (int row = 0; row < chromaHeight; row++) {
            const uint8_t *srcRow = srcU + row * srcStrideU;
            uint8_t *dstRow = dstU + row * dstStrideU;
            for (int col = 0; col < chromaWidth; col++) {
                dstRow[col] = localULUT[srcRow[col]];
            }
        }
    } else {
        for (int row = 0; row < chromaHeight; row++) {
            memcpy(dstU + row * dstStrideU,
                   srcU + row * srcStrideU,
                   (size_t)chromaWidth);
        }
    }

    // --- V plane ---
    if (smoothingActive && smoothChroma && smoothingProducedOutput) {
        size_t chromaPixels = (size_t)chromaWidth * (size_t)chromaHeight;
        uint8_t *scratchChroma = (uint8_t *)malloc(chromaPixels);
        if (scratchChroma) {
            // Horizontal pass: srcV -> scratchChroma
            for (int row = 0; row < chromaHeight; row++) {
                const uint8_t *sRow = srcV + row * srcStrideV;
                uint8_t *dRow = scratchChroma + row * chromaWidth;
                for (int col = 0; col < chromaWidth; col++) {
                    int sum = 0;
                    int count = 0;
                    for (int k = -1; k <= 1; k++) {
                        int c = col + k;
                        if (c >= 0 && c < chromaWidth) {
                            sum += sRow[c];
                            count++;
                        }
                    }
                    dRow[col] = (uint8_t)((sum + count / 2) / count);
                }
            }
            // Vertical pass: scratchChroma -> dstV (with optional LUT)
            for (int row = 0; row < chromaHeight; row++) {
                uint8_t *dRow = dstV + row * dstStrideV;
                for (int col = 0; col < chromaWidth; col++) {
                    int sum = 0;
                    int count = 0;
                    for (int k = -1; k <= 1; k++) {
                        int r = row + k;
                        if (r >= 0 && r < chromaHeight) {
                            sum += scratchChroma[r * chromaWidth + col];
                            count++;
                        }
                    }
                    uint8_t blurred = (uint8_t)((sum + count / 2) / count);
                    dRow[col] = toneIsDefault ? blurred : localVLUT[blurred];
                }
            }
            free(scratchChroma);
        } else {
            for (int row = 0; row < chromaHeight; row++) {
                const uint8_t *srcRow = srcV + row * srcStrideV;
                uint8_t *dstRow = dstV + row * dstStrideV;
                for (int col = 0; col < chromaWidth; col++) {
                    dstRow[col] = toneIsDefault ? srcRow[col] : localVLUT[srcRow[col]];
                }
            }
        }
    } else if (!toneIsDefault) {
        for (int row = 0; row < chromaHeight; row++) {
            const uint8_t *srcRow = srcV + row * srcStrideV;
            uint8_t *dstRow = dstV + row * dstStrideV;
            for (int col = 0; col < chromaWidth; col++) {
                dstRow[col] = localVLUT[srcRow[col]];
            }
        }
    } else {
        for (int row = 0; row < chromaHeight; row++) {
            memcpy(dstV + row * dstStrideV,
                   srcV + row * srcStrideV,
                   (size_t)chromaWidth);
        }
    }

    RTCI420Buffer *newBuffer = [[RTCI420Buffer alloc] initWithWidth:width
                                                            height:height
                                                             dataY:dstY
                                                             dataU:dstU
                                                             dataV:dstV];
    free(dstY); free(dstU); free(dstV);

    if (!newBuffer) {
        return frame;
    }

    return [[RTCVideoFrame alloc] initWithBuffer:newBuffer
                                        rotation:frame.rotation
                                     timeStampNs:frame.timeStampNs];
}

@end
