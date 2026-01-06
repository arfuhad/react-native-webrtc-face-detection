#import "FaceDetectionProcessor.h"
#import <React/RCTEventEmitter.h>
#import <WebRTC/RTCVideoFrame.h>
#import <WebRTC/RTCVideoFrameBuffer.h>
#import <CoreVideo/CoreVideo.h>

// Eye state tracking for each eye (per face, per eye side)
@interface EyeState : NSObject
@property (nonatomic, assign) BOOL isOpen;
@property (nonatomic, assign) BOOL wasOpen;
@property (nonatomic, assign) NSInteger blinkCount;
@property (nonatomic, assign) CGFloat currentEAR;
@property (nonatomic, assign) CGFloat avgEAR;           // Per-eye average EAR (NOT static!)
@property (nonatomic, assign) NSInteger sampleCount;    // Number of samples for avgEAR
@property (nonatomic, assign) NSTimeInterval lastOpenTime;  // For time-based detection
@property (nonatomic, assign) NSTimeInterval lastClosedTime;
@end

@implementation EyeState
- (instancetype)init {
    self = [super init];
    if (self) {
        _isOpen = YES;
        _wasOpen = YES;
        _blinkCount = 0;
        _currentEAR = 0.3;  // Default reasonable EAR
        _avgEAR = 0.3;      // Initial average
        _sampleCount = 0;
        _lastOpenTime = 0;
        _lastClosedTime = 0;
    }
    return self;
}
@end

@interface FaceDetectionProcessor()
@property (nonatomic, strong) VNSequenceRequestHandler *sequenceRequestHandler;
@property (nonatomic, strong) NSMutableDictionary<NSString *, EyeState *> *leftEyeStates;
@property (nonatomic, strong) NSMutableDictionary<NSString *, EyeState *> *rightEyeStates;
@property (nonatomic, assign) NSInteger frameCounter;
@property (nonatomic, strong) dispatch_queue_t processingQueue;
@property (nonatomic, assign) BOOL isProcessing;
@end

@implementation FaceDetectionProcessor

- (instancetype)initWithEventEmitter:(RCTEventEmitter *)eventEmitter {
    self = [super init];
    if (self) {
        _eventEmitter = eventEmitter;
        _isEnabled = NO;
        _frameSkipCount = 2; // Process every 2nd frame for better responsiveness
        _blinkThreshold = 0.6; // 60% of average EAR indicates closed eye (more sensitive)
        _sequenceRequestHandler = [[VNSequenceRequestHandler alloc] init];
        _leftEyeStates = [NSMutableDictionary dictionary];
        _rightEyeStates = [NSMutableDictionary dictionary];
        _frameCounter = 0;
        _isProcessing = NO;
        _processingQueue = dispatch_queue_create("com.webrtc.facedetection", DISPATCH_QUEUE_SERIAL);
    }
    return self;
}

- (void)reset {
    @synchronized (self) {
        [_leftEyeStates removeAllObjects];
        [_rightEyeStates removeAllObjects];
        _frameCounter = 0;
        _isProcessing = NO;
    }
}

- (RTCVideoFrame *)capturer:(RTCVideoCapturer *)capturer didCaptureVideoFrame:(RTCVideoFrame *)frame {
    if (!self.isEnabled) {
        return frame;
    }

    @synchronized (self) {
        _frameCounter++;

        // Skip frames for performance
        if (_frameCounter % _frameSkipCount != 0) {
            return frame;
        }

        // Skip if already processing
        if (_isProcessing) {
            return frame;
        }
        _isProcessing = YES;
    }

    // Process frame asynchronously to avoid blocking the video pipeline
    dispatch_async(_processingQueue, ^{
        [self processFrame:frame];
    });

    return frame;
}

- (void)processFrame:(RTCVideoFrame *)frame {
    @autoreleasepool {
        // Convert RTCVideoFrame to CVPixelBuffer
        CVPixelBufferRef pixelBuffer = [self pixelBufferFromFrame:frame];
        if (!pixelBuffer) {
            @synchronized (self) {
                _isProcessing = NO;
            }
            return;
        }

        // Create face detection request with landmarks
        VNDetectFaceLandmarksRequest *faceRequest = [[VNDetectFaceLandmarksRequest alloc] initWithCompletionHandler:nil];
        faceRequest.revision = VNDetectFaceLandmarksRequestRevision3;

        NSError *error = nil;
        [self.sequenceRequestHandler performRequests:@[faceRequest]
                                       onCVPixelBuffer:pixelBuffer
                                               error:&error];

        if (error) {
            NSLog(@"[FaceDetection] Vision error: %@", error);
            @synchronized (self) {
                _isProcessing = NO;
            }
            return;
        }

        // Process results
        NSArray<VNFaceObservation *> *faceObservations = faceRequest.results;
        [self processFaceObservations:faceObservations
                           frameWidth:frame.width
                          frameHeight:frame.height
                            timestamp:frame.timeStampNs / 1000000]; // Convert to milliseconds

        @synchronized (self) {
            _isProcessing = NO;
        }
    }
}

- (CVPixelBufferRef)pixelBufferFromFrame:(RTCVideoFrame *)frame {
    id<RTCVideoFrameBuffer> buffer = frame.buffer;

    // Try to get CVPixelBuffer directly
    if ([buffer respondsToSelector:@selector(pixelBuffer)]) {
        return [(id)buffer pixelBuffer];
    }

    // For I420 or other formats, we'd need conversion
    return nil;
}

- (void)processFaceObservations:(NSArray<VNFaceObservation *> *)observations
                     frameWidth:(int)frameWidth
                    frameHeight:(int)frameHeight
                      timestamp:(int64_t)timestamp {

    NSMutableArray *facesArray = [NSMutableArray array];

    for (NSInteger i = 0; i < observations.count; i++) {
        VNFaceObservation *observation = observations[i];

        NSString *faceKey = [NSString stringWithFormat:@"%ld", (long)i];

        // Get or create eye states for this face
        EyeState *leftEyeState = self.leftEyeStates[faceKey];
        if (!leftEyeState) {
            leftEyeState = [[EyeState alloc] init];
            self.leftEyeStates[faceKey] = leftEyeState;
        }

        EyeState *rightEyeState = self.rightEyeStates[faceKey];
        if (!rightEyeState) {
            rightEyeState = [[EyeState alloc] init];
            self.rightEyeStates[faceKey] = rightEyeState;
        }

        // Convert normalized coordinates to pixel coordinates
        CGRect boundingBox = observation.boundingBox;
        CGFloat x = boundingBox.origin.x * frameWidth;
        CGFloat y = (1.0 - boundingBox.origin.y - boundingBox.size.height) * frameHeight;
        CGFloat width = boundingBox.size.width * frameWidth;
        CGFloat height = boundingBox.size.height * frameHeight;

        NSDictionary *bounds = @{
            @"x": @(x),
            @"y": @(y),
            @"width": @(width),
            @"height": @(height)
        };

        // Extract landmarks
        VNFaceLandmarks2D *landmarks = observation.landmarks;
        NSDictionary *landmarksDict = nil;

        if (landmarks) {
            // Process left eye
            NSDictionary *leftEyeData = [self processEyeLandmarks:landmarks.leftEye
                                                         eyeState:leftEyeState
                                                          eyeSide:@"left"
                                                       frameWidth:frameWidth
                                                      frameHeight:frameHeight
                                                      boundingBox:boundingBox
                                                       trackingId:i];

            // Process right eye
            NSDictionary *rightEyeData = [self processEyeLandmarks:landmarks.rightEye
                                                          eyeState:rightEyeState
                                                           eyeSide:@"right"
                                                        frameWidth:frameWidth
                                                       frameHeight:frameHeight
                                                       boundingBox:boundingBox
                                                        trackingId:i];

            landmarksDict = @{
                @"leftEye": leftEyeData,
                @"rightEye": rightEyeData
            };
        }

        // Build face object
        NSMutableDictionary *face = [@{
            @"bounds": bounds,
            @"confidence": @(observation.confidence),
            @"trackingId": @(i)
        } mutableCopy];

        if (landmarksDict) {
            face[@"landmarks"] = landmarksDict;
        }

        // Add head pose if available
        if (observation.yaw && observation.pitch && observation.roll) {
            face[@"headPose"] = @{
                @"yaw": observation.yaw,
                @"pitch": observation.pitch,
                @"roll": observation.roll
            };
        }

        [facesArray addObject:face];
    }

    // Emit event to React Native
    NSDictionary *result = @{
        @"faces": facesArray,
        @"timestamp": @(timestamp),
        @"frameWidth": @(frameWidth),
        @"frameHeight": @(frameHeight)
    };

    if (self.eventEmitter) {
        [self.eventEmitter sendEventWithName:@"faceDetected" body:result];
    }
}

- (NSDictionary *)processEyeLandmarks:(VNFaceLandmarkRegion2D *)eyeRegion
                             eyeState:(EyeState *)eyeState
                              eyeSide:(NSString *)eyeSide
                           frameWidth:(int)frameWidth
                          frameHeight:(int)frameHeight
                          boundingBox:(CGRect)boundingBox
                           trackingId:(NSInteger)trackingId {

    NSTimeInterval now = [[NSDate date] timeIntervalSince1970];

    // When eye landmarks can't be detected, likely the eye is closed or face angle is bad
    if (!eyeRegion || eyeRegion.pointCount == 0) {
        eyeState.wasOpen = eyeState.isOpen;

        // Only mark as closed if we had good previous data
        if (eyeState.sampleCount > 10) {
            eyeState.isOpen = NO;
            if (eyeState.wasOpen) {
                eyeState.lastClosedTime = now;
            }
        }

        // Check for blink completion (was closed, landmarks reappear = reopening)
        return @{
            @"position": @{@"x": @0, @"y": @0},
            @"isOpen": @(eyeState.isOpen),
            @"openProbability": @(eyeState.isOpen ? 1.0 : 0.0),
            @"blinkCount": @(eyeState.blinkCount)
        };
    }

    // Calculate eye center
    CGPoint eyeCenter = [self calculateCenterOfPoints:eyeRegion.normalizedPoints count:eyeRegion.pointCount];

    // Convert to frame coordinates
    CGFloat eyeX = (boundingBox.origin.x + eyeCenter.x * boundingBox.size.width) * frameWidth;
    CGFloat eyeY = (1.0 - (boundingBox.origin.y + eyeCenter.y * boundingBox.size.height)) * frameHeight;

    // Calculate Eye Aspect Ratio (EAR) for blink detection
    CGFloat ear = [self calculateEAR:eyeRegion.normalizedPoints count:eyeRegion.pointCount];
    eyeState.currentEAR = ear;

    // Update running average (per-eye, NOT static)
    eyeState.sampleCount++;
    if (eyeState.sampleCount <= 30) {
        // Initial calibration phase - collect samples
        eyeState.avgEAR = ((eyeState.avgEAR * (eyeState.sampleCount - 1)) + ear) / eyeState.sampleCount;
    } else {
        // After calibration, update with exponential moving average
        // Only update average when eye is likely open (EAR above threshold)
        if (ear > eyeState.avgEAR * 0.5) {
            eyeState.avgEAR = eyeState.avgEAR * 0.98 + ear * 0.02;
        }
    }

    // Determine if eye is open based on adaptive threshold
    CGFloat adaptiveThreshold = eyeState.avgEAR * self.blinkThreshold;

    eyeState.wasOpen = eyeState.isOpen;
    BOOL currentlyOpen = ear > adaptiveThreshold;
    eyeState.isOpen = currentlyOpen;

    // Debug logging every 30 frames (about once per second)
    static NSInteger debugCounter = 0;
    debugCounter++;
    if (debugCounter % 30 == 0) {
        NSLog(@"[FaceDetection] %@ eye - EAR: %.4f, avgEAR: %.4f, threshold: %.4f, isOpen: %@",
              eyeSide, ear, eyeState.avgEAR, adaptiveThreshold, currentlyOpen ? @"YES" : @"NO");
    }

    // Track open/closed times
    if (currentlyOpen && !eyeState.wasOpen) {
        eyeState.lastOpenTime = now;
    } else if (!currentlyOpen && eyeState.wasOpen) {
        eyeState.lastClosedTime = now;
    }

    // Detect blink: transition from closed -> open
    // A blink should be quick (< 400ms closed duration)
    if (!eyeState.wasOpen && eyeState.isOpen) {
        NSTimeInterval closedDuration = now - eyeState.lastClosedTime;

        // Valid blink: eye was closed for 50-400ms
        if (closedDuration > 0.05 && closedDuration < 0.4) {
            eyeState.blinkCount++;
            NSLog(@"[FaceDetection] Blink detected on %@ eye! Count: %ld, EAR: %.3f, avgEAR: %.3f, duration: %.3fs",
                  eyeSide, (long)eyeState.blinkCount, ear, eyeState.avgEAR, closedDuration);

            // Emit blink event
            if (self.eventEmitter) {
                [self.eventEmitter sendEventWithName:@"blinkDetected" body:@{
                    @"timestamp": @(now * 1000),
                    @"eye": eyeSide,
                    @"trackingId": @(trackingId),
                    @"blinkCount": @(eyeState.blinkCount)
                }];
            }
        }
    }

    // Calculate open probability
    // Map EAR to a 0-1 probability scale where:
    // - Closed eye (EAR near threshold): ~0.0-0.3
    // - Open eye (EAR at average): ~0.7-1.0
    CGFloat openProbability = 0.0;
    if (eyeState.avgEAR > 0.001) {
        // Calculate how far the current EAR is from closed (threshold) to open (average)
        CGFloat closedEAR = eyeState.avgEAR * self.blinkThreshold;
        CGFloat range = eyeState.avgEAR - closedEAR;

        if (range > 0.001) {
            // Linear mapping from [closedEAR, avgEAR*1.2] to [0, 1]
            openProbability = (ear - closedEAR) / (eyeState.avgEAR * 1.2 - closedEAR);
            openProbability = MIN(1.0, MAX(0.0, openProbability));
        } else {
            openProbability = currentlyOpen ? 1.0 : 0.0;
        }
    }

    return @{
        @"position": @{
            @"x": @(eyeX),
            @"y": @(eyeY)
        },
        @"isOpen": @(eyeState.isOpen),
        @"openProbability": @(openProbability),
        @"blinkCount": @(eyeState.blinkCount)
    };
}

- (CGFloat)calculateEAR:(const CGPoint *)points count:(NSUInteger)count {
    if (count < 6) {
        return 0.3; // Default if not enough points
    }

    // Apple Vision framework provides eye contour points
    // The points are ordered around the eye contour
    // We need to calculate vertical distances at multiple points

    // Find leftmost and rightmost points (horizontal extremes)
    NSUInteger leftIdx = 0, rightIdx = 0;
    CGFloat minX = CGFLOAT_MAX, maxX = -CGFLOAT_MAX;

    for (NSUInteger i = 0; i < count; i++) {
        if (points[i].x < minX) {
            minX = points[i].x;
            leftIdx = i;
        }
        if (points[i].x > maxX) {
            maxX = points[i].x;
            rightIdx = i;
        }
    }

    CGFloat horizontalDistance = maxX - minX;
    if (horizontalDistance < 0.0001) return 0.3;

    // Calculate vertical distances at multiple sample points across the eye
    // This captures the eye opening better than just bounding box
    CGFloat totalVerticalDistance = 0.0;
    NSInteger sampleCount = 0;

    // Sample at 25%, 50%, and 75% of the horizontal span
    CGFloat samplePositions[] = {0.25, 0.5, 0.75};

    for (int s = 0; s < 3; s++) {
        CGFloat sampleX = minX + horizontalDistance * samplePositions[s];

        // Find points closest to this X position on upper and lower parts
        CGFloat upperY = -CGFLOAT_MAX;
        CGFloat lowerY = CGFLOAT_MAX;
        CGFloat tolerance = horizontalDistance * 0.15; // 15% tolerance

        for (NSUInteger i = 0; i < count; i++) {
            if (fabs(points[i].x - sampleX) < tolerance) {
                // Determine if this is upper or lower lid based on position in contour
                // Upper lid points typically have higher Y values (Vision uses bottom-left origin)
                if (points[i].y > upperY) upperY = points[i].y;
                if (points[i].y < lowerY) lowerY = points[i].y;
            }
        }

        if (upperY > -CGFLOAT_MAX && lowerY < CGFLOAT_MAX && upperY > lowerY) {
            totalVerticalDistance += (upperY - lowerY);
            sampleCount++;
        }
    }

    if (sampleCount == 0) {
        // Fallback to simple bounding box approach
        CGFloat minY = CGFLOAT_MAX, maxY = -CGFLOAT_MAX;
        for (NSUInteger i = 0; i < count; i++) {
            minY = MIN(minY, points[i].y);
            maxY = MAX(maxY, points[i].y);
        }
        return (maxY - minY) / horizontalDistance;
    }

    CGFloat avgVerticalDistance = totalVerticalDistance / sampleCount;

    // EAR = average vertical distance / horizontal distance
    // For open eyes, this ratio is higher (~0.25-0.35)
    // For closed eyes, this ratio is lower (~0.05-0.15)
    CGFloat ear = avgVerticalDistance / horizontalDistance;

    return ear;
}

- (CGPoint)calculateCenterOfPoints:(const CGPoint *)points count:(NSUInteger)count {
    if (count == 0) {
        return CGPointZero;
    }

    CGFloat sumX = 0, sumY = 0;
    for (NSUInteger i = 0; i < count; i++) {
        sumX += points[i].x;
        sumY += points[i].y;
    }

    return CGPointMake(sumX / count, sumY / count);
}

@end
