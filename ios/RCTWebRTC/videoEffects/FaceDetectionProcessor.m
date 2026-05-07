#import "FaceDetectionProcessor.h"
#import "FaceResultCache.h"
#import "I420Converter.h"
#import <React/RCTEventEmitter.h>
#import <WebRTC/RTCVideoFrame.h>
#import <WebRTC/RTCVideoFrameBuffer.h>
#import <WebRTC/RTCCVPixelBuffer.h>
#import <CoreVideo/CoreVideo.h>
#import <QuartzCore/QuartzCore.h>
@import MLKitVision;

// Eye state tracking with smoothing, temporal validation, and confidence
@interface EyeState : NSObject
@property (nonatomic, assign) BOOL isOpen;
@property (nonatomic, assign) BOOL wasOpen;
@property (nonatomic, assign) NSInteger blinkCount;
@property (nonatomic, assign) CGFloat currentProbability;
@property (nonatomic, assign) CGFloat smoothedProbability;       // EMA smoothed value
@property (nonatomic, assign) NSTimeInterval closedTimestamp;    // When eye closed (ms)
@property (nonatomic, assign) NSTimeInterval lastBlinkTimestamp; // Last blink time (ms) for debounce
@property (nonatomic, assign) CGFloat minProbDuringClosure;      // Lowest prob while closed
@end

@implementation EyeState
- (instancetype)init {
    self = [super init];
    if (self) {
        _isOpen = YES;
        _wasOpen = YES;
        _blinkCount = 0;
        _currentProbability = 1.0;
        _smoothedProbability = 1.0;
        _closedTimestamp = 0;
        _lastBlinkTimestamp = 0;
        _minProbDuringClosure = 1.0;
    }
    return self;
}
@end

@interface FaceDetectionProcessor()
@property (nonatomic, strong) MLKFaceDetector *faceDetector;
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, EyeState *> *leftEyeStates;
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, EyeState *> *rightEyeStates;
@property (nonatomic, assign) NSInteger frameCounter;
@property (nonatomic, strong) dispatch_queue_t processingQueue;
@property (nonatomic, assign) BOOL isProcessing;
// Frame capture properties
@property (nonatomic, assign) CVPixelBufferRef currentPixelBuffer;
@property (nonatomic, assign) CGSize currentFrameSize;
@property (nonatomic, strong) CIContext *ciContext;
// Closed-eye frame storage
@property (nonatomic, assign) CVPixelBufferRef closedEyePixelBuffer;
@property (nonatomic, assign) CGSize closedEyeFrameSize;
@property (nonatomic, assign) CGRect closedEyeFaceBounds;
// Frame rotation tracking
@property (nonatomic, assign) RTCVideoRotation currentFrameRotation;
@property (nonatomic, assign) RTCVideoRotation closedEyeFrameRotation;
// I420 to BGRA conversion
@property (nonatomic, strong) I420Converter *i420Converter;
// Adaptive threshold calibration
@property (nonatomic, assign) BOOL isCalibrating;
@property (nonatomic, assign) NSTimeInterval calibrationStartTime;
@property (nonatomic, strong) NSMutableArray<NSNumber *> *calibrationSamples;
@end

@implementation FaceDetectionProcessor

- (instancetype)initWithEventEmitter:(RCTEventEmitter *)eventEmitter {
    self = [super init];
    if (self) {
        _eventEmitter = eventEmitter;
        _isEnabled = NO;
        _frameSkipCount = 3; // Matches documented default and Android
        _blinkThreshold = 0.3; // Same as Android (probability-based)
        _leftEyeStates = [NSMutableDictionary dictionary];
        _rightEyeStates = [NSMutableDictionary dictionary];
        _frameCounter = 0;
        _isProcessing = NO;
        _processingQueue = dispatch_queue_create("com.webrtc.facedetection", DISPATCH_QUEUE_SERIAL);
        // Frame capture defaults
        _captureOnBlink = NO;
        _cropToFace = YES;
        _imageQuality = 0.7;
        _maxImageWidth = 480;
        _currentPixelBuffer = NULL;
        _ciContext = [CIContext contextWithOptions:nil];
        _closedEyePixelBuffer = NULL;
        _closedEyeFrameSize = CGSizeZero;
        _closedEyeFaceBounds = CGRectZero;
        _currentFrameRotation = RTCVideoRotation_0;
        _closedEyeFrameRotation = RTCVideoRotation_0;
        // Blink validation defaults
        _minBlinkDurationMs = 50;
        _maxBlinkDurationMs = 800;
        _blinkCooldownMs = 300;
        // Adaptive threshold defaults
        _adaptiveThreshold = NO;
        _calibrationDurationMs = 3000;
        _isCalibrating = NO;
        _calibrationStartTime = 0;
        _calibrationSamples = [NSMutableArray array];

        [self initializeFaceDetector];
    }
    return self;
}

- (void)initializeFaceDetector {
    MLKFaceDetectorOptions *options = [[MLKFaceDetectorOptions alloc] init];
    options.performanceMode = MLKFaceDetectorPerformanceModeFast;
    options.landmarkMode = MLKFaceDetectorLandmarkModeAll;
    options.classificationMode = MLKFaceDetectorClassificationModeAll; // KEY: enables eye probability
    options.contourMode = MLKFaceDetectorContourModeNone;
    options.minFaceSize = 0.15;
    options.trackingEnabled = YES;

    self.faceDetector = [MLKFaceDetector faceDetectorWithOptions:options];
    NSLog(@"[FaceDetection] ML Kit FaceDetector initialized");
}

- (void)reset {
    @synchronized (self) {
        [_leftEyeStates removeAllObjects];
        [_rightEyeStates removeAllObjects];
        _frameCounter = 0;
        _isProcessing = NO;
        if (_currentPixelBuffer) {
            CVPixelBufferRelease(_currentPixelBuffer);
            _currentPixelBuffer = NULL;
        }
        if (_closedEyePixelBuffer) {
            CVPixelBufferRelease(_closedEyePixelBuffer);
            _closedEyePixelBuffer = NULL;
        }
        _closedEyeFrameSize = CGSizeZero;
        _closedEyeFaceBounds = CGRectZero;
        _currentFrameRotation = RTCVideoRotation_0;
        _closedEyeFrameRotation = RTCVideoRotation_0;
        _isCalibrating = NO;
        _calibrationStartTime = 0;
        [_calibrationSamples removeAllObjects];
    }
}

- (void)startCalibrationIfNeeded {
    if (_adaptiveThreshold && !_isCalibrating) {
        _isCalibrating = YES;
        _calibrationStartTime = [[NSDate date] timeIntervalSince1970] * 1000;
        [_calibrationSamples removeAllObjects];
        NSLog(@"[FaceDetection] Adaptive threshold calibration started");
    }
}

- (void)processCalibrationSample:(CGFloat)openProbability {
    if (!_isCalibrating) return;

    NSTimeInterval now = [[NSDate date] timeIntervalSince1970] * 1000;

    // Only collect samples that are likely open-eye (> 0.5)
    if (openProbability > 0.5) {
        [_calibrationSamples addObject:@(openProbability)];
    }

    // Check if calibration period is over
    if (now - _calibrationStartTime >= _calibrationDurationMs) {
        if (_calibrationSamples.count > 0) {
            CGFloat sum = 0;
            for (NSNumber *sample in _calibrationSamples) {
                sum += sample.doubleValue;
            }
            CGFloat meanOpen = sum / _calibrationSamples.count;
            CGFloat adaptedThreshold = meanOpen * 0.5;
            _blinkThreshold = MAX(adaptedThreshold, 0.1);
            NSLog(@"[FaceDetection] Adaptive threshold calibrated: %.3f (mean open: %.3f, samples: %lu)",
                  _blinkThreshold, meanOpen, (unsigned long)_calibrationSamples.count);
        } else {
            NSLog(@"[FaceDetection] Calibration ended with no valid samples, keeping threshold: %.3f",
                  _blinkThreshold);
        }
        _isCalibrating = NO;
        [_calibrationSamples removeAllObjects];
    }
}

- (RTCVideoFrame *)capturer:(RTCVideoCapturer *)capturer didCaptureVideoFrame:(RTCVideoFrame *)frame {
    if (!self.isEnabled) {
        return frame;
    }

    @synchronized (self) {
        _frameCounter++;

        if (_frameCounter % _frameSkipCount != 0) {
            return frame;
        }

        if (_isProcessing) {
            return frame;
        }
        _isProcessing = YES;
    }

    // Get pixel buffer BEFORE async dispatch (while frame is still valid)
    // Note: pixelBufferFromFrame returns a RETAINED buffer that we must release
    CVPixelBufferRef pixelBuffer = [self pixelBufferFromFrame:frame];
    if (!pixelBuffer) {
        @synchronized (self) {
            _isProcessing = NO;
        }
        return frame;
    }

    // Capture frame metadata before async dispatch (buffer already retained)
    int32_t frameWidth = frame.width;
    int32_t frameHeight = frame.height;
    int64_t timestamp = frame.timeStampNs;
    RTCVideoRotation frameRotation = frame.rotation;

    dispatch_async(_processingQueue, ^{
        [self processFrameWithPixelBuffer:pixelBuffer
                                    width:frameWidth
                                   height:frameHeight
                                 rotation:frameRotation
                                timestamp:timestamp];
        CVPixelBufferRelease(pixelBuffer);
    });

    return frame;
}

- (void)processFrameWithPixelBuffer:(CVPixelBufferRef)pixelBuffer
                              width:(int32_t)frameWidth
                             height:(int32_t)frameHeight
                           rotation:(RTCVideoRotation)frameRotation
                          timestamp:(int64_t)timestamp {
    @autoreleasepool {
        // Validate pixel buffer has actual image data
        CVReturn lockResult = CVPixelBufferLockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
        if (lockResult != kCVReturnSuccess) {
            NSLog(@"[FaceDetection] Failed to lock pixel buffer: %d", lockResult);
            @synchronized (self) {
                _isProcessing = NO;
            }
            return;
        }

        void *baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer);
        size_t dataSize = CVPixelBufferGetDataSize(pixelBuffer);
        CVPixelBufferUnlockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);

        if (!baseAddress || dataSize == 0) {
            NSLog(@"[FaceDetection] Pixel buffer has no image data");
            @synchronized (self) {
                _isProcessing = NO;
            }
            return;
        }

        // Store for frame capture
        if (_captureOnBlink) {
            if (_currentPixelBuffer) {
                CVPixelBufferRelease(_currentPixelBuffer);
            }
            CVPixelBufferRetain(pixelBuffer);
            _currentPixelBuffer = pixelBuffer;
            _currentFrameSize = CGSizeMake(frameWidth, frameHeight);
            _currentFrameRotation = frameRotation;
        }

        // Ensure face detector is initialized
        if (!self.faceDetector) {
            if (_captureOnBlink && _currentPixelBuffer) {
                CVPixelBufferRelease(_currentPixelBuffer);
                _currentPixelBuffer = NULL;
            }
            @synchronized (self) {
                _isProcessing = NO;
            }
            return;
        }

        // Convert CVPixelBuffer to UIImage for ML Kit
        // Note: ML Kit's initWithBuffer: expects CMSampleBufferRef, not CVPixelBufferRef
        UIImage *uiImage = [self uiImageFromPixelBuffer:pixelBuffer];
        if (!uiImage) {
            NSLog(@"[FaceDetection] Failed to create UIImage from pixel buffer");
            if (_captureOnBlink && _currentPixelBuffer) {
                CVPixelBufferRelease(_currentPixelBuffer);
                _currentPixelBuffer = NULL;
            }
            @synchronized (self) {
                _isProcessing = NO;
            }
            return;
        }

        // Wrap ML Kit in @try/@catch to handle exceptions gracefully
        @try {
            // Create ML Kit vision image from UIImage
            MLKVisionImage *visionImage = [[MLKVisionImage alloc] initWithImage:uiImage];
            // Map WebRTC frame rotation to UIImageOrientation for ML Kit
            UIImageOrientation mlKitOrientation;
            switch (frameRotation) {
                case RTCVideoRotation_90:
                    mlKitOrientation = UIImageOrientationRight;
                    break;
                case RTCVideoRotation_180:
                    mlKitOrientation = UIImageOrientationDown;
                    break;
                case RTCVideoRotation_270:
                    mlKitOrientation = UIImageOrientationLeft;
                    break;
                case RTCVideoRotation_0:
                default:
                    mlKitOrientation = UIImageOrientationUp;
                    break;
            }
            visionImage.orientation = mlKitOrientation;

            NSError *error = nil;
            NSArray<MLKFace *> *faces = [self.faceDetector resultsInImage:visionImage error:&error];

            if (error) {
                NSLog(@"[FaceDetection] ML Kit error: %@", error);
            } else {
                [self processFaceResults:faces
                              frameWidth:frameWidth
                             frameHeight:frameHeight
                               timestamp:timestamp / 1000000];
            }
        } @catch (NSException *exception) {
            NSLog(@"[FaceDetection] ML Kit exception: %@ - %@", exception.name, exception.reason);
        }

        if (_captureOnBlink && _currentPixelBuffer) {
            CVPixelBufferRelease(_currentPixelBuffer);
            _currentPixelBuffer = NULL;
        }

        @synchronized (self) {
            _isProcessing = NO;
        }
    }
}

/**
 * Returns a CVPixelBuffer from the frame. Handles both RTCCVPixelBuffer and I420 formats.
 * IMPORTANT: The returned buffer is RETAINED - caller must release when done.
 */
- (CVPixelBufferRef)pixelBufferFromFrame:(RTCVideoFrame *)frame {
    id<RTCVideoFrameBuffer> buffer = frame.buffer;

    // Check if buffer is already a CVPixelBuffer (most efficient path)
    if ([buffer isKindOfClass:[RTCCVPixelBuffer class]]) {
        CVPixelBufferRef pixelBuffer = [(RTCCVPixelBuffer *)buffer pixelBuffer];
        CVPixelBufferRetain(pixelBuffer);  // Retain for caller
        return pixelBuffer;
    }

    // Convert I420 buffer to CVPixelBuffer using Accelerate framework
    // Note: pixelBufferFromI420 returns an already-retained buffer
    return [self pixelBufferFromI420:[buffer toI420]];
}

/**
 * Converts an I420 buffer to a BGRA CVPixelBuffer for ML Kit compatibility.
 * Returns a retained buffer that must be released by the caller.
 */
- (CVPixelBufferRef)pixelBufferFromI420:(RTCI420Buffer *)i420Buffer {
    if (!i420Buffer) {
        return NULL;
    }

    if (_i420Converter == nil) {
        I420Converter *converter = [[I420Converter alloc] init];
        vImage_Error err = [converter prepareForAccelerateConversion];

        if (err != kvImageNoError) {
            NSLog(@"[FaceDetection] Error preparing I420Converter: %ld", err);
            return NULL;
        }

        _i420Converter = converter;
    }

    return [_i420Converter convertI420ToPixelBuffer:i420Buffer];
}

/**
 * Converts a CVPixelBuffer to UIImage for ML Kit processing.
 * ML Kit's initWithBuffer: expects CMSampleBufferRef, not CVPixelBufferRef,
 * so we convert to UIImage and use initWithImage: instead.
 */
- (UIImage *)uiImageFromPixelBuffer:(CVPixelBufferRef)pixelBuffer {
    CIImage *ciImage = [CIImage imageWithCVPixelBuffer:pixelBuffer];
    if (!ciImage) {
        return nil;
    }

    CGImageRef cgImage = [_ciContext createCGImage:ciImage fromRect:ciImage.extent];
    if (!cgImage) {
        return nil;
    }

    UIImage *uiImage = [UIImage imageWithCGImage:cgImage];
    CGImageRelease(cgImage);

    return uiImage;
}

- (void)processFaceResults:(NSArray<MLKFace *> *)faces
                frameWidth:(int)frameWidth
               frameHeight:(int)frameHeight
                 timestamp:(int64_t)timestamp {

    NSMutableArray *facesArray = [NSMutableArray array];
    NSMutableSet<NSNumber *> *seenTrackingIds = [NSMutableSet set];
    NSTimeInterval now = [[NSDate date] timeIntervalSince1970] * 1000;

    // Track whether we successfully published a face into the cache this
    // frame. If ML Kit returned no faces at all we still want to explicitly
    // invalidate the cache so ImageAdjustmentProcessor sees a stale-empty
    // state rather than a lingering bbox from seconds ago.
    BOOL publishedFaceThisFrame = NO;

    for (NSInteger i = 0; i < faces.count; i++) {
        MLKFace *face = faces[i];

        NSInteger trackingId = face.hasTrackingID ? face.trackingID : i;
        NSNumber *trackingKey = @(trackingId);
        [seenTrackingIds addObject:trackingKey];

        // Get or create eye states
        EyeState *leftEyeState = self.leftEyeStates[trackingKey];
        if (!leftEyeState) {
            leftEyeState = [[EyeState alloc] init];
            self.leftEyeStates[trackingKey] = leftEyeState;
        }

        EyeState *rightEyeState = self.rightEyeStates[trackingKey];
        if (!rightEyeState) {
            rightEyeState = [[EyeState alloc] init];
            self.rightEyeStates[trackingKey] = rightEyeState;
        }

        // Bounding box
        CGRect boundingBox = face.frame;
        NSDictionary *bounds = @{
            @"x": @(boundingBox.origin.x),
            @"y": @(boundingBox.origin.y),
            @"width": @(boundingBox.size.width),
            @"height": @(boundingBox.size.height)
        };

        // Normalized bounds for frame capture (0-1 range)
        CGRect normalizedBounds = CGRectMake(
            boundingBox.origin.x / frameWidth,
            boundingBox.origin.y / frameHeight,
            boundingBox.size.width / frameWidth,
            boundingBox.size.height / frameHeight
        );

        // Process eyes - returns eye data dict, blink detection is deferred
        BOOL leftBlinked = NO;
        BOOL rightBlinked = NO;
        NSTimeInterval leftDuration = 0;
        NSTimeInterval rightDuration = 0;

        NSDictionary *leftEyeData = [self processEye:face.leftEyeOpenProbability
                                            eyeState:leftEyeState
                                          trackingId:trackingId
                                    normalizedBounds:normalizedBounds
                                                face:face
                                        landmarkType:MLKFaceLandmarkTypeLeftEye
                                          didBlink:&leftBlinked
                                      blinkDuration:&leftDuration];

        NSDictionary *rightEyeData = [self processEye:face.rightEyeOpenProbability
                                             eyeState:rightEyeState
                                           trackingId:trackingId
                                     normalizedBounds:normalizedBounds
                                                 face:face
                                         landmarkType:MLKFaceLandmarkTypeRightEye
                                            didBlink:&rightBlinked
                                        blinkDuration:&rightDuration];

        // Unified blink emission - prevents double-counting natural blinks
        if (leftBlinked || rightBlinked) {
            NSString *eyeSide;
            NSString *blinkType;
            NSInteger blinkCountToReport;
            NSTimeInterval duration;
            CGFloat minProb;

            if (leftBlinked && rightBlinked) {
                eyeSide = @"both";
                blinkType = @"blink";
                blinkCountToReport = MAX(leftEyeState.blinkCount, rightEyeState.blinkCount);
                duration = MAX(leftDuration, rightDuration);
                minProb = MIN(leftEyeState.minProbDuringClosure, rightEyeState.minProbDuringClosure);
            } else if (leftBlinked) {
                eyeSide = @"left";
                blinkType = @"wink";
                blinkCountToReport = leftEyeState.blinkCount;
                duration = leftDuration;
                minProb = leftEyeState.minProbDuringClosure;
            } else {
                eyeSide = @"right";
                blinkType = @"wink";
                blinkCountToReport = rightEyeState.blinkCount;
                duration = rightDuration;
                minProb = rightEyeState.minProbDuringClosure;
            }

            // Compute confidence score
            CGFloat deltaScore = MIN(MAX((self.blinkThreshold - minProb) / self.blinkThreshold, 0), 1);
            CGFloat optimalDuration = 150.0;
            CGFloat durationDeviation = fabs(duration - optimalDuration) / optimalDuration;
            CGFloat durationScore = MIN(MAX(1.0 - durationDeviation, 0), 1);
            CGFloat symmetryScore = (leftBlinked && rightBlinked) ? 1.0 : 0.7;
            CGFloat confidence = 0.4 * deltaScore + 0.3 * durationScore + 0.3 * symmetryScore;

            NSLog(@"[FaceDetection] Blink detected: %@ (type: %@, count: %ld, duration: %.0fms, confidence: %.2f)",
                  eyeSide, blinkType, (long)blinkCountToReport, duration, confidence);

            if (self.eventEmitter) {
                NSMutableDictionary *blinkBody = [@{
                    @"timestamp": @(now),
                    @"eye": eyeSide,
                    @"trackingId": @(trackingId),
                    @"blinkCount": @(blinkCountToReport),
                    @"duration": @(duration),
                    @"blinkType": blinkType,
                    @"confidence": @(confidence),
                    @"minOpenProbability": @(minProb)
                } mutableCopy];

                // Use stored closed-eye frame for capture
                if (_captureOnBlink && _closedEyePixelBuffer) {
                    NSString *base64Image = [self captureFrameAsBase64FromBuffer:_closedEyePixelBuffer
                                                                           size:_closedEyeFrameSize
                                                                     faceBounds:_closedEyeFaceBounds
                                                                       rotation:_closedEyeFrameRotation];

                    if (base64Image) {
                        blinkBody[@"faceImage"] = base64Image;
                        blinkBody[@"faceBounds"] = @{
                            @"x": @(_closedEyeFaceBounds.origin.x * _closedEyeFrameSize.width),
                            @"y": @(_closedEyeFaceBounds.origin.y * _closedEyeFrameSize.height),
                            @"width": @(_closedEyeFaceBounds.size.width * _closedEyeFrameSize.width),
                            @"height": @(_closedEyeFaceBounds.size.height * _closedEyeFrameSize.height)
                        };
                    }

                    CVPixelBufferRelease(_closedEyePixelBuffer);
                    _closedEyePixelBuffer = NULL;
                }

                [self.eventEmitter sendEventWithName:@"blinkDetected" body:blinkBody];
            }
        }

        // Extract mouth landmarks
        NSMutableDictionary *landmarksDict = [NSMutableDictionary dictionary];
        landmarksDict[@"leftEye"] = leftEyeData;
        landmarksDict[@"rightEye"] = rightEyeData;

        MLKFaceLandmark *mouthBottom = [face landmarkOfType:MLKFaceLandmarkTypeMouthBottom];
        MLKFaceLandmark *mouthLeft = [face landmarkOfType:MLKFaceLandmarkTypeMouthLeft];
        MLKFaceLandmark *mouthRight = [face landmarkOfType:MLKFaceLandmarkTypeMouthRight];
        CGPoint mouthCenterPx = CGPointMake(-1, -1);
        if (mouthBottom && mouthLeft && mouthRight) {
            CGFloat centerX = (mouthLeft.position.x + mouthRight.position.x) / 2.0;
            CGFloat centerY = mouthBottom.position.y;
            CGFloat mouthWidth = fabs(mouthRight.position.x - mouthLeft.position.x);
            CGFloat mouthHeight = mouthWidth * 0.5;
            landmarksDict[@"mouth"] = @{
                @"position": @{@"x": @(centerX), @"y": @(centerY)},
                @"width": @(mouthWidth),
                @"height": @(mouthHeight)
            };
            mouthCenterPx = CGPointMake(centerX, centerY);
        }

        // Publish into the shared cache so ImageAdjustmentProcessor can build
        // a skin mask. We only publish the primary (first) face — skin
        // smoothing is single-face by design.
        if (!publishedFaceThisFrame) {
            CGPoint leftEyePx  = CGPointMake(-1, -1);
            CGPoint rightEyePx = CGPointMake(-1, -1);
            MLKFaceLandmark *leftEyeLm  = [face landmarkOfType:MLKFaceLandmarkTypeLeftEye];
            MLKFaceLandmark *rightEyeLm = [face landmarkOfType:MLKFaceLandmarkTypeRightEye];
            if (leftEyeLm)  { leftEyePx  = CGPointMake(leftEyeLm.position.x,  leftEyeLm.position.y); }
            if (rightEyeLm) { rightEyePx = CGPointMake(rightEyeLm.position.x, rightEyeLm.position.y); }

            FDCFaceResult fr;
            fr.valid          = YES;
            fr.bbox           = boundingBox;
            fr.leftEye        = leftEyePx;
            fr.rightEye       = rightEyePx;
            fr.mouthCenter    = mouthCenterPx;
            fr.faceWidth      = boundingBox.size.width;
            fr.timestampNanos = (int64_t)(CACurrentMediaTime() * 1e9);
            [[FaceResultCache sharedInstance] publish:fr];
            publishedFaceThisFrame = YES;
        }

        // Extract nose landmark
        MLKFaceLandmark *noseBase = [face landmarkOfType:MLKFaceLandmarkTypeNoseBase];
        if (noseBase) {
            landmarksDict[@"nose"] = @{
                @"position": @{@"x": @(noseBase.position.x), @"y": @(noseBase.position.y)}
            };
        }

        NSDictionary *landmarks = [landmarksDict copy];

        // Build face object
        NSMutableDictionary *faceDict = [@{
            @"bounds": bounds,
            @"confidence": @1.0,
            @"trackingId": @(trackingId)
        } mutableCopy];

        faceDict[@"landmarks"] = landmarks;

        // Head pose
        faceDict[@"headPose"] = @{
            @"yaw": @(face.headEulerAngleY),
            @"pitch": @(face.headEulerAngleX),
            @"roll": @(face.headEulerAngleZ)
        };

        [facesArray addObject:faceDict];
    }

    // If no face was published this frame, invalidate the cache so stale
    // bbox data from a previous frame doesn't drive the skin mask.
    if (!publishedFaceThisFrame) {
        FDCFaceResult empty = {0};
        empty.valid = NO;
        [[FaceResultCache sharedInstance] publish:empty];
    }

    // Evict stale eye state entries for faces no longer in frame (Phase 1.2)
    NSMutableArray<NSNumber *> *staleKeys = [NSMutableArray array];
    for (NSNumber *key in self.leftEyeStates) {
        if (![seenTrackingIds containsObject:key]) {
            [staleKeys addObject:key];
        }
    }
    [self.leftEyeStates removeObjectsForKeys:staleKeys];

    [staleKeys removeAllObjects];
    for (NSNumber *key in self.rightEyeStates) {
        if (![seenTrackingIds containsObject:key]) {
            [staleKeys addObject:key];
        }
    }
    [self.rightEyeStates removeObjectsForKeys:staleKeys];

    // Emit face detected event with wall-clock timestamp (Phase 1.3)
    NSDictionary *result = @{
        @"faces": facesArray,
        @"timestamp": @(now),
        @"frameWidth": @(frameWidth),
        @"frameHeight": @(frameHeight)
    };

    if (self.eventEmitter) {
        [self.eventEmitter sendEventWithName:@"faceDetected" body:result];
    }
}

- (NSDictionary *)processEye:(CGFloat)openProbability
                    eyeState:(EyeState *)eyeState
                  trackingId:(NSInteger)trackingId
            normalizedBounds:(CGRect)normalizedBounds
                        face:(MLKFace *)face
                landmarkType:(MLKFaceLandmarkType)landmarkType
                    didBlink:(BOOL *)outDidBlink
               blinkDuration:(NSTimeInterval *)outBlinkDuration {

    *outDidBlink = NO;
    *outBlinkDuration = 0;

    // Extract eye landmark position from ML Kit
    CGFloat eyeX = 0;
    CGFloat eyeY = 0;
    MLKFaceLandmark *eyeLandmark = [face landmarkOfType:landmarkType];
    if (eyeLandmark && eyeLandmark.position) {
        eyeX = eyeLandmark.position.x;
        eyeY = eyeLandmark.position.y;
    }

    // Handle missing probability (returns negative value when unavailable)
    if (openProbability < 0) {
        return @{
            @"position": @{@"x": @(eyeX), @"y": @(eyeY)},
            @"isOpen": @(eyeState.isOpen),
            @"openProbability": @(eyeState.currentProbability),
            @"blinkCount": @(eyeState.blinkCount)
        };
    }

    // Adaptive threshold calibration
    if (_isCalibrating) {
        [self processCalibrationSample:openProbability];
    }

    eyeState.currentProbability = openProbability;

    // Apply EMA smoothing (Phase 2.1)
    CGFloat alpha = 0.4;
    eyeState.smoothedProbability = alpha * openProbability + (1.0 - alpha) * eyeState.smoothedProbability;

    eyeState.wasOpen = eyeState.isOpen;
    eyeState.isOpen = eyeState.smoothedProbability > self.blinkThreshold;

    NSTimeInterval now = [[NSDate date] timeIntervalSince1970] * 1000;

    // Track minimum probability during closure (for confidence)
    if (!eyeState.isOpen) {
        eyeState.minProbDuringClosure = MIN(eyeState.minProbDuringClosure, openProbability);
    }

    // CAPTURE FRAME WHEN EYE CLOSES (open -> closed transition)
    if (eyeState.wasOpen && !eyeState.isOpen) {
        eyeState.closedTimestamp = now;
        eyeState.minProbDuringClosure = openProbability;

        if (_captureOnBlink && _currentPixelBuffer) {
            if (_closedEyePixelBuffer) {
                CVPixelBufferRelease(_closedEyePixelBuffer);
            }
            CVPixelBufferRetain(_currentPixelBuffer);
            _closedEyePixelBuffer = _currentPixelBuffer;
            _closedEyeFrameSize = _currentFrameSize;
            _closedEyeFaceBounds = normalizedBounds;
            _closedEyeFrameRotation = _currentFrameRotation;
        }
    }

    // DETECT BLINK (closed -> open transition)
    // Don't emit during calibration
    if (!eyeState.wasOpen && eyeState.isOpen && !_isCalibrating) {
        NSTimeInterval blinkDuration = now - eyeState.closedTimestamp;

        // Temporal validation (Phase 2.2)
        BOOL durationValid = (blinkDuration >= _minBlinkDurationMs && blinkDuration <= _maxBlinkDurationMs);

        // Debounce (Phase 2.3)
        BOOL cooldownPassed = (eyeState.lastBlinkTimestamp == 0 ||
                               (now - eyeState.lastBlinkTimestamp) >= _blinkCooldownMs);

        if (durationValid && cooldownPassed) {
            eyeState.blinkCount++;
            eyeState.lastBlinkTimestamp = now;
            *outDidBlink = YES;
            *outBlinkDuration = blinkDuration;
        }
    }

    return @{
        @"position": @{@"x": @(eyeX), @"y": @(eyeY)},
        @"isOpen": @(eyeState.isOpen),
        @"openProbability": @(openProbability),
        @"blinkCount": @(eyeState.blinkCount)
    };
}

#pragma mark - Frame Capture

- (NSString *)captureFrameAsBase64WithFaceBounds:(CGRect)normalizedBounds {
    return [self captureFrameAsBase64FromBuffer:_currentPixelBuffer
                                           size:_currentFrameSize
                                    faceBounds:normalizedBounds
                                      rotation:_currentFrameRotation];
}

- (NSString *)captureFrameAsBase64FromBuffer:(CVPixelBufferRef)pixelBuffer
                                        size:(CGSize)frameSize
                                  faceBounds:(CGRect)normalizedBounds
                                    rotation:(RTCVideoRotation)rotation {
    if (!pixelBuffer) return nil;

    // Lock buffer for ENTIRE conversion process (CIImage is lazy - reads data on createCGImage)
    CVReturn lockResult = CVPixelBufferLockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
    if (lockResult != kCVReturnSuccess) {
        NSLog(@"[FaceDetection] Failed to lock pixel buffer for capture");
        return nil;
    }

    CIImage *ciImage = [CIImage imageWithCVPixelBuffer:pixelBuffer];
    if (!ciImage) {
        CVPixelBufferUnlockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);
        return nil;
    }

    // Crop to face if enabled
    if (_cropToFace && !CGRectIsEmpty(normalizedBounds)) {
        CGFloat padding = 0.15;

        CGRect cropRect = CGRectMake(
            (normalizedBounds.origin.x - padding) * frameSize.width,
            (normalizedBounds.origin.y - padding) * frameSize.height,
            (normalizedBounds.size.width + padding * 2) * frameSize.width,
            (normalizedBounds.size.height + padding * 2) * frameSize.height
        );

        cropRect = CGRectIntersection(cropRect, ciImage.extent);

        if (!CGRectIsEmpty(cropRect) && cropRect.size.width > 0 && cropRect.size.height > 0) {
            ciImage = [ciImage imageByCroppingToRect:cropRect];
            ciImage = [ciImage imageByApplyingTransform:CGAffineTransformMakeTranslation(-cropRect.origin.x, -cropRect.origin.y)];
        }
    }

    // Scale down if too large
    CGFloat currentWidth = ciImage.extent.size.width;
    if (currentWidth > _maxImageWidth) {
        CGFloat scale = _maxImageWidth / currentWidth;
        ciImage = [ciImage imageByApplyingTransform:CGAffineTransformMakeScale(scale, scale)];
    }

    // Render CIImage to CGImage (this is when pixel data is actually read)
    CGImageRef cgImage = [_ciContext createCGImage:ciImage fromRect:ciImage.extent];

    // Unlock AFTER rendering is complete
    CVPixelBufferUnlockBaseAddress(pixelBuffer, kCVPixelBufferLock_ReadOnly);

    if (!cgImage) return nil;

    // Map WebRTC frame rotation to UIImageOrientation for correct JPEG encoding
    UIImageOrientation imageOrientation;
    switch (rotation) {
        case RTCVideoRotation_90:
            imageOrientation = UIImageOrientationRight;
            break;
        case RTCVideoRotation_180:
            imageOrientation = UIImageOrientationDown;
            break;
        case RTCVideoRotation_270:
            imageOrientation = UIImageOrientationLeft;
            break;
        case RTCVideoRotation_0:
        default:
            imageOrientation = UIImageOrientationUp;
            break;
    }
    UIImage *image = [UIImage imageWithCGImage:cgImage scale:1.0 orientation:imageOrientation];
    CGImageRelease(cgImage);

    NSData *jpegData = UIImageJPEGRepresentation(image, _imageQuality);
    if (!jpegData) return nil;

    return [jpegData base64EncodedStringWithOptions:0];
}

- (void)dealloc {
    if (_currentPixelBuffer) {
        CVPixelBufferRelease(_currentPixelBuffer);
        _currentPixelBuffer = NULL;
    }
    if (_closedEyePixelBuffer) {
        CVPixelBufferRelease(_closedEyePixelBuffer);
        _closedEyePixelBuffer = NULL;
    }
    if (_i420Converter) {
        [_i420Converter unprepareForAccelerateConversion];
        _i420Converter = nil;
    }
}

@end
