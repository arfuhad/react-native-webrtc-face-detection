#import "BilateralSmoother.h"

#import <Metal/Metal.h>

@interface BilateralSmoother () {
    id<MTLDevice>               _device;
    id<MTLCommandQueue>         _commandQueue;
    id<MTLComputePipelineState> _pipeline;

    id<MTLTexture>              _texA;
    id<MTLTexture>              _texB;
    int                         _allocatedWidth;
    int                         _allocatedHeight;

    BOOL  _enabled;
    float _distanceNorm;
    float _texelSpacing;
    int   _iterations;
    float _mix;
    float _skinBrightness;
    BOOL  _setupAttempted;
    BOOL  _setupSucceeded;
}
@end

@implementation BilateralSmoother

- (instancetype)init {
    self = [super init];
    if (self) {
        _enabled = NO;
        _distanceNorm = 3.0f;
        _texelSpacing = 2.0f;
        _iterations = 4;
        _mix = 0.0f;
        _skinBrightness = 0.0f;
        _setupAttempted = NO;
        _setupSucceeded = NO;
        _allocatedWidth = 0;
        _allocatedHeight = 0;
    }
    return self;
}

- (BOOL)isAvailable {
    return _setupSucceeded;
}

- (BOOL)isEnabled {
    return _enabled && _setupSucceeded;
}

- (void)updateConfig:(BOOL)enabled
        distanceNorm:(float)distanceNorm
        texelSpacing:(float)texelSpacing
          iterations:(int)iterations
                 mix:(float)mix
      skinBrightness:(float)skinBrightness {
    _enabled = enabled;
    _distanceNorm = distanceNorm;
    _texelSpacing = texelSpacing;
    _iterations = (iterations < 1) ? 1 : (iterations > 8) ? 8 : iterations;
    _mix = mix;
    _skinBrightness = skinBrightness;
}

#pragma mark - Lazy Metal setup

- (BOOL)ensureSetup {
    if (_setupAttempted) {
        return _setupSucceeded;
    }
    _setupAttempted = YES;

    _device = MTLCreateSystemDefaultDevice();
    if (!_device) {
        NSLog(@"[BilateralSmoother] Metal not available on this device");
        return NO;
    }

    _commandQueue = [_device newCommandQueue];
    if (!_commandQueue) {
        NSLog(@"[BilateralSmoother] Failed to create Metal command queue");
        return NO;
    }

    // Load the shader from the module's default library. The .metal file
    // is compiled into the module's default.metallib at build time.
    NSBundle *bundle = [NSBundle bundleForClass:[self class]];
    NSError *libError = nil;
    id<MTLLibrary> library = [_device newDefaultLibraryWithBundle:bundle error:&libError];
    if (!library) {
        // Fall back to the process-wide default library (useful when the
        // .metal file is linked into the main app bundle rather than a
        // resource bundle for this module).
        library = [_device newDefaultLibrary];
    }
    if (!library) {
        NSLog(@"[BilateralSmoother] Failed to load Metal library: %@", libError);
        return NO;
    }

    id<MTLFunction> kernelFn = [library newFunctionWithName:@"bilateralSeparable"];
    if (!kernelFn) {
        NSLog(@"[BilateralSmoother] bilateralSeparable kernel not found in library");
        return NO;
    }

    NSError *pipelineError = nil;
    _pipeline = [_device newComputePipelineStateWithFunction:kernelFn error:&pipelineError];
    if (!_pipeline) {
        NSLog(@"[BilateralSmoother] Failed to create compute pipeline: %@", pipelineError);
        return NO;
    }

    _setupSucceeded = YES;
    return YES;
}

- (BOOL)ensureTexturesForWidth:(int)width height:(int)height {
    if (_texA && _texB && _allocatedWidth == width && _allocatedHeight == height) {
        return YES;
    }

    MTLTextureDescriptor *desc =
        [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatR8Unorm
                                                           width:(NSUInteger)width
                                                          height:(NSUInteger)height
                                                       mipmapped:NO];
    desc.usage       = MTLTextureUsageShaderRead | MTLTextureUsageShaderWrite;
    desc.storageMode = MTLStorageModeShared;

    _texA = [_device newTextureWithDescriptor:desc];
    _texB = [_device newTextureWithDescriptor:desc];
    if (!_texA || !_texB) {
        NSLog(@"[BilateralSmoother] Failed to allocate %dx%d textures", width, height);
        _texA = nil;
        _texB = nil;
        _allocatedWidth = 0;
        _allocatedHeight = 0;
        return NO;
    }
    _allocatedWidth = width;
    _allocatedHeight = height;
    return YES;
}

#pragma mark - Smoothing

- (BOOL)smoothYPlane:(const uint8_t *)srcPlane
           srcStride:(int)srcStride
            dstPlane:(uint8_t *)dstPlane
               width:(int)width
              height:(int)height {
    if (!self.isEnabled || !srcPlane || !dstPlane || width <= 0 || height <= 0) {
        return NO;
    }
    if (![self ensureSetup]) {
        return NO;
    }
    if (![self ensureTexturesForWidth:width height:height]) {
        return NO;
    }

    // Upload Y plane to texA. If srcStride > width, copy row-by-row into a
    // tightly-packed temp, else upload directly.
    MTLRegion region = MTLRegionMake2D(0, 0, (NSUInteger)width, (NSUInteger)height);
    if (srcStride == width) {
        [_texA replaceRegion:region
                 mipmapLevel:0
                   withBytes:srcPlane
                 bytesPerRow:(NSUInteger)width];
    } else {
        uint8_t *packed = (uint8_t *)malloc((size_t)width * (size_t)height);
        if (!packed) {
            return NO;
        }
        for (int row = 0; row < height; row++) {
            memcpy(packed + row * width, srcPlane + row * srcStride, (size_t)width);
        }
        [_texA replaceRegion:region
                 mipmapLevel:0
                   withBytes:packed
                 bytesPerRow:(NSUInteger)width];
        free(packed);
    }

    MTLSize threadsPerGroup = MTLSizeMake(16, 16, 1);
    MTLSize threadgroups    = MTLSizeMake((width  + 15) / 16,
                                          (height + 15) / 16,
                                          1);

    int iters = (_iterations < 1) ? 1 : (_iterations > 8) ? 8 : _iterations;

    // Each iteration runs two passes: horizontal then vertical.
    // Pass 1 (H): texA -> texB
    // Pass 2 (V): texB -> texA
    // After iters iterations, the result is in texA if iters is odd,
    // or texB if iters is even. We track which texture to read from.
    id<MTLTexture> finalReadTexture = _texA;

    for (int iter = 0; iter < iters; iter++) {
        id<MTLCommandBuffer> cmd = [_commandQueue commandBuffer];
        if (!cmd) {
            return NO;
        }

        // Horizontal pass: input -> texB
        {
            id<MTLTexture> inputTex = (iter == 0) ? _texA : (id<MTLTexture>)(finalReadTexture);
            id<MTLComputeCommandEncoder> enc = [cmd computeCommandEncoder];
            [enc setComputePipelineState:_pipeline];
            [enc setTexture:inputTex atIndex:0];
            [enc setTexture:_texB atIndex:1];
            float direction[2]   = { 1.0f, 0.0f };
            float distanceNorm   = _distanceNorm;
            float texelSpacing   = _texelSpacing;
            [enc setBytes:direction     length:sizeof(direction)    atIndex:0];
            [enc setBytes:&distanceNorm length:sizeof(distanceNorm) atIndex:1];
            [enc setBytes:&texelSpacing length:sizeof(texelSpacing) atIndex:2];
            [enc dispatchThreadgroups:threadgroups threadsPerThreadgroup:threadsPerGroup];
            [enc endEncoding];
        }

        // Vertical pass: texB -> texA
        {
            id<MTLComputeCommandEncoder> enc = [cmd computeCommandEncoder];
            [enc setComputePipelineState:_pipeline];
            [enc setTexture:_texB atIndex:0];
            [enc setTexture:_texA atIndex:1];
            float direction[2]   = { 0.0f, 1.0f };
            float distanceNorm   = _distanceNorm;
            float texelSpacing   = _texelSpacing;
            [enc setBytes:direction     length:sizeof(direction)    atIndex:0];
            [enc setBytes:&distanceNorm length:sizeof(distanceNorm) atIndex:1];
            [enc setBytes:&texelSpacing length:sizeof(texelSpacing) atIndex:2];
            [enc dispatchThreadgroups:threadgroups threadsPerThreadgroup:threadsPerGroup];
            [enc endEncoding];
        }

        [cmd commit];
        [cmd waitUntilCompleted];

        // After each full iteration (H+V), the result is always in texA.
        finalReadTexture = _texA;
    }

    // Read the final result from texA into dstPlane (tightly packed, width bytes per row).
    [finalReadTexture getBytes:dstPlane
                  bytesPerRow:(NSUInteger)width
                   fromRegion:region
                  mipmapLevel:0];

    return YES;
}

@end
