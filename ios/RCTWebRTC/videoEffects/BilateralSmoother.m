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
    BOOL  _setupAttempted;
    BOOL  _setupSucceeded;
}
@end

@implementation BilateralSmoother

- (instancetype)init {
    self = [super init];
    if (self) {
        _enabled = NO;
        _distanceNorm = 8.0f;
        _texelSpacing = 1.0f;
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
        texelSpacing:(float)texelSpacing {
    _enabled = enabled;
    _distanceNorm = distanceNorm;
    _texelSpacing = texelSpacing;
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

    id<MTLCommandBuffer> cmd = [_commandQueue commandBuffer];
    if (!cmd) {
        return NO;
    }

    MTLSize threadsPerGroup = MTLSizeMake(16, 16, 1);
    MTLSize threadgroups    = MTLSizeMake((width  + 15) / 16,
                                          (height + 15) / 16,
                                          1);

    // Pass 1: horizontal  (texA -> texB)
    {
        id<MTLComputeCommandEncoder> enc = [cmd computeCommandEncoder];
        [enc setComputePipelineState:_pipeline];
        [enc setTexture:_texA atIndex:0];
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

    // Pass 2: vertical    (texB -> texA)
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

    // Read texA back into dstPlane (tightly packed, width bytes per row).
    [_texA getBytes:dstPlane
        bytesPerRow:(NSUInteger)width
         fromRegion:region
        mipmapLevel:0];

    return YES;
}

@end
