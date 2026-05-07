#import "FaceResultCache.h"

#import <QuartzCore/QuartzCore.h>
#import <os/lock.h>

@implementation FaceResultCache {
    os_unfair_lock _lock;
    FDCFaceResult  _slot;
}

+ (instancetype)sharedInstance {
    static FaceResultCache *sInstance = nil;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        sInstance = [[FaceResultCache alloc] init];
    });
    return sInstance;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _lock = OS_UNFAIR_LOCK_INIT;
        _slot = (FDCFaceResult){0};
        _slot.valid = NO;
    }
    return self;
}

- (void)publish:(FDCFaceResult)result {
    os_unfair_lock_lock(&_lock);
    _slot = result;
    os_unfair_lock_unlock(&_lock);
}

- (FDCFaceResult)getIfFresh:(int64_t)maxAgeNanos {
    FDCFaceResult copy;
    os_unfair_lock_lock(&_lock);
    copy = _slot;
    os_unfair_lock_unlock(&_lock);

    if (!copy.valid) {
        return (FDCFaceResult){ .valid = NO };
    }

    int64_t now = (int64_t)(CACurrentMediaTime() * 1e9);
    if (now - copy.timestampNanos > maxAgeNanos) {
        return (FDCFaceResult){ .valid = NO };
    }
    return copy;
}

@end
