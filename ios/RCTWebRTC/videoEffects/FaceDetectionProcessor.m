#import "FaceDetectionProcessor.h"
#import <React/RCTEventEmitter.h>
#import <WebRTC/RTCVideoFrame.h>
#import <WebRTC/RTCVideoFrameBuffer.h>
#import <CoreVideo/CoreVideo.h>

// Eye state tracking for each eye
@interface EyeState : NSObject
@property (nonatomic, assign) BOOL isOpen;
@property (nonatomic, assign) BOOL wasOpen;
@property (nonatomic, assign) NSInteger blinkCount;
@property (nonatomic, assign) CGFloat currentEAR; // Eye Aspect Ratio
@end

@implementation EyeState
- (instancetype)init {
    self = [super init];
    if (self) {
        _isOpen = YES;
        _wasOpen = YES;
        _blinkCount = 0;
        _currentEAR = 1.0;
    }
    return self;
}
@end

@interface FaceDetectionProcessor()
@property (nonatomic, strong) VNSequenceRequestHandler *sequenceRequestHandler;
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, EyeState *> *eyeStates; // Track state per face
@property (nonatomic, assign) NSInteger frameCounter;
@property (nonatomic, strong) dispatch_queue_t processingQueue;
@end

@implementation FaceDetectionProcessor

- (instancetype)initWithEventEmitter:(RCTEventEmitter *)eventEmitter {
    self = [super init];
    if (self) {
        _eventEmitter = eventEmitter;
        _isEnabled = NO;
        _frameSkipCount = 3; // Process every 3rd frame by default
        _blinkThreshold = 0.08; // Very low threshold for Vision framework's eye contour-based EAR
        _sequenceRequestHandler = [[VNSequenceRequestHandler alloc] init];
        _eyeStates = [NSMutableDictionary dictionary];
        _frameCounter = 0;
        _processingQueue = dispatch_queue_create("com.webrtc.facedetection", DISPATCH_QUEUE_SERIAL);
    }
    return self;
}

- (void)reset {
    @synchronized (self) {
        [_eyeStates removeAllObjects];
        _frameCounter = 0;
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
            NSLog(@"Face detection error: %@", error);
            return;
        }
        
        // Process results
        NSArray<VNFaceObservation *> *faceObservations = faceRequest.results;
        [self processFaceObservations:faceObservations
                           frameWidth:frame.width
                          frameHeight:frame.height
                            timestamp:frame.timeStampNs / 1000000]; // Convert to milliseconds
    }
}

- (CVPixelBufferRef)pixelBufferFromFrame:(RTCVideoFrame *)frame {
    id<RTCVideoFrameBuffer> buffer = frame.buffer;
    
    // Try to get CVPixelBuffer directly
    if ([buffer respondsToSelector:@selector(pixelBuffer)]) {
        return [(id)buffer pixelBuffer];
    }
    
    // For I420 or other formats, we'd need conversion
    // For now, return nil if we can't get pixel buffer directly
    return nil;
}

- (void)processFaceObservations:(NSArray<VNFaceObservation *> *)observations
                     frameWidth:(int)frameWidth
                    frameHeight:(int)frameHeight
                      timestamp:(int64_t)timestamp {
    
    NSMutableArray *facesArray = [NSMutableArray array];
    
    for (NSInteger i = 0; i < observations.count; i++) {
        VNFaceObservation *observation = observations[i];
        
        // Get or create eye state for this face
        NSNumber *faceId = @(i);
        EyeState *leftEyeState = self.eyeStates[[self keyForFace:faceId eye:@"left"]] ?: [[EyeState alloc] init];
        EyeState *rightEyeState = self.eyeStates[[self keyForFace:faceId eye:@"right"]] ?: [[EyeState alloc] init];
        
        // Convert normalized coordinates to pixel coordinates
        CGRect boundingBox = observation.boundingBox;
        CGFloat x = boundingBox.origin.x * frameWidth;
        CGFloat y = (1.0 - boundingBox.origin.y - boundingBox.size.height) * frameHeight; // Flip Y
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
                                                       frameWidth:frameWidth
                                                      frameHeight:frameHeight
                                                      boundingBox:boundingBox];
            
            // Process right eye
            NSDictionary *rightEyeData = [self processEyeLandmarks:landmarks.rightEye
                                                          eyeState:rightEyeState
                                                        frameWidth:frameWidth
                                                       frameHeight:frameHeight
                                                       boundingBox:boundingBox];
            
            // Store updated states
            self.eyeStates[[self keyForFace:faceId eye:@"left"]] = leftEyeState;
            self.eyeStates[[self keyForFace:faceId eye:@"right"]] = rightEyeState;
            
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
        
        // Add head pose if available (yaw, pitch, roll)
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
                           frameWidth:(int)frameWidth
                          frameHeight:(int)frameHeight
                          boundingBox:(CGRect)boundingBox {
    
    // When eye landmarks can't be detected, the eye is likely closed
    if (!eyeRegion || eyeRegion.pointCount == 0) {
        eyeState.wasOpen = eyeState.isOpen;
        eyeState.isOpen = NO;  // Assume closed when not detected
        
        // Check for blink completion (was closed, now we can't detect = still closed)
        // Blink is detected when eye reopens
        
        return @{
            @"position": @{@"x": @0, @"y": @0},
            @"isOpen": @NO,
            @"openProbability": @0.0,
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
    
    // Vision's EAR values are high (1-10+), so we use a different threshold
    // When eye closes, EAR drops significantly
    // Use adaptive threshold based on running average
    static CGFloat avgEAR = 3.0;  // Initial estimate for open eye
    avgEAR = avgEAR * 0.95 + ear * 0.05;  // Exponential moving average
    
    // Eye is considered closed if EAR drops below 50% of average
    CGFloat adaptiveThreshold = avgEAR * 0.5;
    
    eyeState.wasOpen = eyeState.isOpen;
    eyeState.isOpen = ear > adaptiveThreshold;
    
    // Log EAR values periodically for debugging
    static int logCounter = 0;
    if (++logCounter % 5 == 0) {
        NSLog(@"[FaceDetection] EAR: %.3f, avgEAR: %.3f, threshold: %.3f, isOpen: %d, wasOpen: %d", 
              ear, avgEAR, adaptiveThreshold, eyeState.isOpen, eyeState.wasOpen);
    }
    
    // Detect blink (transition from open -> closed -> open)
    if (eyeState.wasOpen && !eyeState.isOpen) {
        // Eye just closed, potential blink start
        NSLog(@"[FaceDetection] Eye closing detected, EAR: %.3f (threshold: %.3f)", ear, adaptiveThreshold);
    } else if (!eyeState.wasOpen && eyeState.isOpen) {
        // Eye just opened, complete blink
        eyeState.blinkCount++;
        NSLog(@"[FaceDetection] Blink detected! Count: %ld, EAR: %.3f", (long)eyeState.blinkCount, ear);
        
        // Emit blink event
        if (self.eventEmitter) {
            [self.eventEmitter sendEventWithName:@"blinkDetected" body:@{
                @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000),
                @"eye": @"both", // iOS processes both eyes together
                @"blinkCount": @(eyeState.blinkCount)
            }];
        }
    }
    
    // Calculate open probability (normalized EAR relative to average)
    CGFloat openProbability = MIN(1.0, MAX(0.0, ear / avgEAR));
    
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
    if (count < 4) {
        return 3.0; // Return average value if not enough points
    }
    
    // Simple bounding box approach for Vision framework's eye contour
    // Find the extremes of the eye contour
    CGFloat minX = CGFLOAT_MAX, maxX = -CGFLOAT_MAX;
    CGFloat minY = CGFLOAT_MAX, maxY = -CGFLOAT_MAX;
    
    for (NSUInteger i = 0; i < count; i++) {
        minX = MIN(minX, points[i].x);
        maxX = MAX(maxX, points[i].x);
        minY = MIN(minY, points[i].y);
        maxY = MAX(maxY, points[i].y);
    }
    
    CGFloat width = maxX - minX;
    CGFloat height = maxY - minY;
    
    // Prevent division by zero
    if (width < 0.0001) return 3.0;
    
    // EAR = height / width (in Vision, this tends to be > 1)
    CGFloat ear = height / width;
    
    // Log raw values periodically for debugging
    static int earLogCounter = 0;
    if (++earLogCounter % 30 == 0) {
        NSLog(@"[FaceDetection] EAR raw: h=%.4f, w=%.4f, ratio=%.3f, points=%lu", 
              height, width, ear, (unsigned long)count);
    }
    
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

- (NSString *)keyForFace:(NSNumber *)faceId eye:(NSString *)eye {
    return [NSString stringWithFormat:@"%@_%@", faceId, eye];
}

@end

