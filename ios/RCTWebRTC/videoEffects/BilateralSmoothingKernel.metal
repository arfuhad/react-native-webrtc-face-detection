#include <metal_stdlib>
using namespace metal;

// Separable bilateral smoothing on a single-channel (Y plane) texture.
// radius = 4 gives a 9-tap 1D kernel — good tradeoff between smoothing
// strength and shader cost. Run horizontally (direction = (1,0)), then
// vertically (direction = (0,1)) with the output of the first pass as
// input to the second.
kernel void bilateralSeparable(
    texture2d<float, access::sample> inTex   [[texture(0)]],
    texture2d<float, access::write>  outTex  [[texture(1)]],
    constant float2 &direction               [[buffer(0)]],
    constant float  &distanceNorm            [[buffer(1)]],
    constant float  &texelSpacing            [[buffer(2)]],
    uint2            gid                     [[thread_position_in_grid]]
) {
    if (gid.x >= outTex.get_width() || gid.y >= outTex.get_height()) {
        return;
    }

    constexpr sampler s(coord::normalized,
                        address::clamp_to_edge,
                        filter::linear);

    float2 texSize = float2(inTex.get_width(), inTex.get_height());
    float2 centerUV = (float2(gid) + 0.5) / texSize;
    float  center = inTex.sample(s, centerUV).r;

    // Range weight denominator. distanceNorm is the app-facing param
    // (range 2.5–8.0). Higher = wider range tolerance = more smoothing.
    float rangeSigma = 1.0 / max(distanceNorm, 0.001);
    float rangeDenom = 2.0 * rangeSigma * rangeSigma;

    // Spatial sigma tied to radius — fixed at 4.0.
    const float spatialDenom = 2.0 * 4.0 * 4.0;

    float totalWeight = 0.0;
    float totalLuma   = 0.0;

    // 9-tap loop: i = -4..+4
    for (int i = -4; i <= 4; i++) {
        float fi = float(i);
        float2 offset = direction * fi * texelSpacing / texSize;
        float  sampleLuma = inTex.sample(s, centerUV + offset).r;

        float spatialWeight = exp(-(fi * fi) / spatialDenom);
        float rangeDiff     = sampleLuma - center;
        float rangeWeight   = exp(-(rangeDiff * rangeDiff) / rangeDenom);

        float w = spatialWeight * rangeWeight;
        totalWeight += w;
        totalLuma   += sampleLuma * w;
    }

    float result = totalLuma / max(totalWeight, 0.0001);
    outTex.write(float4(result, 0.0, 0.0, 1.0), gid);
}
