/**
 * @internal
 * 2D shadow map sampling primitives for directional shadows.
 * Three sampling modes selected by USE_HARD_SHADOW / USE_PCF_SHADOW /
 * USE_SOFT_SHADOW compile defines at the call site. Reads shadowMap /
 * shadowMapSampler + POISSON_DISK_16 from ShadowCommon — include ShadowCommon
 * first.
 */
export let PCF_frag: string = /*wgsl*/ `
    fn sampleHard_Direct(uv: vec2<f32>, depthTexIndex: i32, refDepth: f32) -> f32 {
        return textureSampleCompareLevel(shadowMap, shadowMapSampler, uv, depthTexIndex, refDepth);
    }

    // 3x3 uniform-weight PCF. Hardware sampler_comparison already does a 2x2
    // compare-and-filter inside each tap when the sampler is linear, so this
    // effectively averages 36 sub-samples with low aliasing. Previously this
    // function used min(length(offset), 1.0) as the per-tap weight, which
    // made the centre tap weigh 0 and produced a systematic bias toward
    // darker results at pixel centres — equal weight fixes that.
    fn samplePCF3x3_Direct(uv: vec2<f32>, depthTexIndex: i32, refDepth: f32, uvOnePixel: vec2<f32>) -> f32 {
        var visibility = 0.0;
        for (var y = -1; y <= 1; y++) {
            for (var x = -1; x <= 1; x++) {
                let offsetUV = vec2<f32>(f32(x), f32(y)) * uvOnePixel;
                visibility += textureSampleCompareLevel(shadowMap, shadowMapSampler, uv + offsetUV, depthTexIndex, refDepth);
            }
        }
        return visibility * (1.0 / 9.0);
    }

    // Percentage-Closer Soft Shadows (Fernando 2005 + NVIDIA GPU Gems 3).
    // Three-stage pipeline:
    //   1. Blocker search: Poisson-16 taps using the non-comparison sampler
    //      to read raw depth; average the depth of taps closer than the
    //      receiver (the "occluders").
    //   2. Penumbra estimate via the similar-triangles model:
    //        penumbra = (refDepth - avgBlockerDepth) / avgBlockerDepth * lightSize
    //      Larger light size OR larger receiver-blocker distance -> wider
    //      penumbra. This is what gives shadows that soften with distance
    //      ("contact hardening").
    //   3. PCF of configured radius (16 Poisson taps) using the comparison
    //      sampler and the computed penumbra.
    // lightSize units: texels (at the shadow map's native resolution).
    fn samplePCSS_Direct(uv: vec2<f32>, depthTexIndex: i32, refDepth: f32, uvOnePixel: vec2<f32>, lightSize: f32) -> f32 {
        // Blocker search radius: a fraction of lightSize. Smaller than the
        // filter so very thin occluders still register.
        let searchRadiusUV = lightSize * uvOnePixel;
        var avgBlocker = 0.0;
        var numBlockers = 0.0;
        for (var i = 0; i < 16; i++) {
            let sampleUV = uv + POISSON_DISK_16[i] * searchRadiusUV;
            let sampleDepth = textureSampleLevel(shadowMap, shadowMapSamplerRaw, sampleUV, depthTexIndex, 0i);
            if (sampleDepth < refDepth) {
                avgBlocker += sampleDepth;
                numBlockers += 1.0;
            }
        }
        if (numBlockers < 0.5) {
            // No occluders between receiver and light -> fully lit. Avoids
            // running PCF and returning 0 when refDepth is already the
            // front-most surface.
            return 1.0;
        }
        let avgBlockerDepth = avgBlocker / numBlockers;
        // Similar-triangles penumbra in normalized depth; multiply by lightSize
        // to get filter radius back in texel units.
        let penumbra = max(refDepth - avgBlockerDepth, 0.0) / max(avgBlockerDepth, 1e-5);
        let filterRadiusTexels = min(penumbra * lightSize, lightSize);
        let filterRadiusUV = filterRadiusTexels * uvOnePixel;
        var visibility = 0.0;
        for (var i = 0; i < 16; i++) {
            let offsetUV = POISSON_DISK_16[i] * filterRadiusUV;
            visibility += textureSampleCompareLevel(shadowMap, shadowMapSampler, uv + offsetUV, depthTexIndex, refDepth);
        }
        return visibility * (1.0 / 16.0);
    }
`
