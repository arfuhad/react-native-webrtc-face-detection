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
        _blinkThreshold = 0.21; // Standard EAR threshold for blink detection
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
    
    if (!eyeRegion || eyeRegion.pointCount == 0) {
        return @{
            @"position": @{@"x": @0, @"y": @0},
            @"isOpen": @YES,
            @"openProbability": @1.0,
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
    
    // Determine if eye is open
    eyeState.wasOpen = eyeState.isOpen;
    eyeState.isOpen = ear > self.blinkThreshold;
    
    // Detect blink (transition from open -> closed -> open)
    if (eyeState.wasOpen && !eyeState.isOpen) {
        // Eye just closed, potential blink start
    } else if (!eyeState.wasOpen && eyeState.isOpen) {
        // Eye just opened, complete blink
        eyeState.blinkCount++;
        
        // Emit blink event
        if (self.eventEmitter) {
            [self.eventEmitter sendEventWithName:@"blinkDetected" body:@{
                @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
            }];
        }
    }
    
    // Calculate open probability (normalized EAR)
    CGFloat openProbability = MIN(1.0, MAX(0.0, ear / 0.3));
    
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
        return 1.0; // Assume eye is open if we don't have enough points
    }
    
    // Eye Aspect Ratio calculation
    // EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)
    // where p1-p6 are the eye landmark points
    
    // For simplicity, we'll use a bounding box approach
    CGFloat minY = CGFLOAT_MAX, maxY = -CGFLOAT_MAX;
    CGFloat minX = CGFLOAT_MAX, maxX = -CGFLOAT_MAX;
    
    for (NSUInteger i = 0; i < count; i++) {
        minX = MIN(minX, points[i].x);
        maxX = MAX(maxX, points[i].x);
        minY = MIN(minY, points[i].y);
        maxY = MAX(maxY, points[i].y);
    }
    
    CGFloat width = maxX - minX;
    CGFloat height = maxY - minY;
    
    // EAR is ratio of height to width
    if (width == 0) return 0.0;
    
    return height / width;
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

