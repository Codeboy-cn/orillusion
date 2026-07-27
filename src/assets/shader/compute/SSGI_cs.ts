/**
 * Screen-Space Global Illumination (SSGI) — horizon-based march pass.
 *
 * Per pixel: march the scene-color buffer along several azimuthal
 * directions and accumulate radiance from samples that are (a) above the
 * receiver's tangent plane, (b) not hidden behind a nearer sample on the
 * same slice (horizon tracking), and (c) front-facing toward the
 * receiver. The gather radius is a world-space distance projected to a
 * per-pixel step length, so the effect is view-distance stable.
 *
 * A single frame is a high-variance estimate: a small bright emitter is
 * either caught by one of the azimuthal slices or missed entirely, which
 * shows up as binary per-pixel noise. The slice rotation and step jitter
 * therefore advance by the golden ratio every frame, and the companion
 * resolve pass (SSGITemporal_cs) integrates the estimates over time.
 * This pass stays free of the temporal machinery on purpose — extra
 * uniforms/textures held live across the march loop collapse occupancy.
 *
 * Output: rgb = raw single-frame gather, a = receiver view depth.
 *
 * Still deferred: Hi-Z traversal, spatial (bilateral) filtering.
 *
 * @internal
 */
export let SSGI_cs: string = /*wgsl*/`
    #include "GlobalUniform"
    #include "GBufferStand"

    const PI: f32 = 3.1415926;

    struct SSGISettings {
        radius: f32,
        sliceCount: f32,
        stepCount: f32,
        frameIndex: f32,
    };

    @group(0) @binding(2) var<uniform> ssgiSettings: SSGISettings;
    @group(0) @binding(3) var inTex: texture_2d<f32>;
    @group(0) @binding(4) var giTex: texture_storage_2d<rgba16float, write>;

    var<private> texSize: vec2<u32>;
    var<private> fragCoord: vec2<i32>;
    var<private> fragUV: vec2<f32>;
    var<private> gBuffer: GBuffer;

    // Interleaved gradient noise — stable per pixel, uncorrelated between
    // neighbours; used to rotate slices and jitter march offsets.
    fn interleavedGradientNoise(coord: vec2<f32>) -> f32 {
        return fract(52.9829189 * fract(0.06711056 * coord.x + 0.00583715 * coord.y));
    }

    // Per-frame temporal scrambles: Halton(2,3) radical inverses of the
    // frame index. Uniform and low-discrepancy like the golden-ratio
    // pair, but successive deltas jump wildly instead of being constant.
    // That matters because IGN is translation-generated: ANY constant
    // per-frame value advance (fract(IGN + c*frame)) is a constant-
    // velocity translation of the pattern, so the temporal accumulator's
    // residual noise slides coherently across the screen; random-size
    // hops read as stationary twinkle instead.
    //
    // Slice rotation and step jitter need TWO INDEPENDENT sequences: with
    // a shared scramble their per-pixel joint distribution collapses to a
    // 1D diagonal of the (azimuth x step) space and the estimator
    // converges to a biased blotch pattern (as does domain mirroring,
    // which wrecks the per-pixel marginal instead — KS 0.60 vs 0.001).
    fn radicalInverse2(frameU: u32) -> f32 {
        return f32(reverseBits(frameU)) * 2.3283064365386963e-10;
    }

    fn radicalInverse3(frameU: u32) -> f32 {
        var n = frameU;
        var inv = 0.0;
        var f = 1.0 / 3.0;
        // 3^7 = 2187 digits cover the wrapped 0..1023 frame index.
        for (var i = 0u; i < 7u; i = i + 1u) {
            inv = inv + f * f32(n % 3u);
            n = n / 3u;
            f = f / 3.0;
        }
        return inv;
    }

    @compute @workgroup_size(8, 8, 1)
    fn CsMain(@builtin(global_invocation_id) gid: vec3<u32>) {
        fragCoord = vec2<i32>(gid.xy);
        texSize = textureDimensions(inTex).xy;
        if (fragCoord.x >= i32(texSize.x) || fragCoord.y >= i32(texSize.y)) { return; }
        fragUV = vec2<f32>(fragCoord) / vec2<f32>(texSize - 1u);

        gBuffer = getGBuffer(fragCoord);
        useNormalMatrixInv();
        // roughness == 0 marks sky / unwritten GBuffer texels (same
        // convention as GTAO_cs).
        let visible = getRoughnessFromGBuffer(gBuffer);
        if (visible <= 0.0) {
            textureStore(giTex, fragCoord, vec4<f32>(0.0));
            return;
        }

        let P = getWorldPositionFromGBuffer(gBuffer, fragUV);
        let N = getWorldNormalFromGBuffer(gBuffer);

        // Project the world-space gather radius to pixels at the
        // receiver's view depth: pixels = radius * (0.5 * projY * H) / viewZ.
        let viewZ = max(0.01, abs((globalUniform.viewMat * vec4<f32>(P, 1.0)).z));
        // Cap at the screen size, not an arbitrary pixel count: a
        // world-space radius spanning a whole room must be able to reach
        // an emitter across the frame (taps just get sparser).
        let pixelRadius = clamp(
            ssgiSettings.radius * globalUniform.projMat[1][1] * 0.5 * f32(texSize.y) / viewZ,
            4.0, f32(max(texSize.x, texSize.y)));

        let sliceCount = i32(clamp(ssgiSettings.sliceCount, 2.0, 8.0));
        let stepCount = i32(clamp(ssgiSettings.stepCount, 4.0, 16.0));
        // Fresh azimuth/step phases every frame so the resolve pass's EMA
        // integrates toward the full-sphere estimate. Wrap the frame index
        // to keep the hash domain small.
        let frameU = u32(ssgiSettings.frameIndex) % 1024u;
        let noise = fract(interleavedGradientNoise(vec2<f32>(fragCoord)) + radicalInverse2(frameU));
        let jitter = fract(interleavedGradientNoise(vec2<f32>(fragCoord) + 7.0) + radicalInverse3(frameU));

        var giAccum = vec3<f32>(0.0);
        for (var slice: i32 = 0; slice < sliceCount; slice = slice + 1) {
            let theta = (f32(slice) + noise) * (2.0 * PI / f32(sliceCount));
            let dir = vec2<f32>(cos(theta), sin(theta));
            // HBIL-style horizon integration. nl = dot(N, dirToSample) is
            // the sine of the sample's elevation above the receiver's
            // tangent plane; the cosine-weighted solid angle of the band
            // between two elevations is proportional to sin^2(hi)-sin^2(lo).
            // Marching outward, each sample that rises above the current
            // horizon contributes exactly its newly revealed band, so a
            // full enclosure sums to ~1: the result is already a
            // normalized fraction of hemispheric irradiance.
            var sinSqHorizon = 0.0;
            for (var s: i32 = 0; s < stepCount; s = s + 1) {
                let t = (f32(s) + 0.5 + jitter * 0.9) / f32(stepCount);
                // Quadratic distribution: denser taps near the receiver
                // where elevation changes fastest.
                let pix = 1.0 + pixelRadius * t * t;
                let sampleCoord = fragCoord + vec2<i32>(dir * pix);
                if (sampleCoord.x < 0 || sampleCoord.y < 0 ||
                    sampleCoord.x >= i32(texSize.x) || sampleCoord.y >= i32(texSize.y)) {
                    break;
                }
                let sGBuffer = getGBuffer(sampleCoord);
                if (getRoughnessFromGBuffer(sGBuffer) <= 0.0) { continue; }
                let sampleUV = vec2<f32>(sampleCoord) / vec2<f32>(texSize - 1u);
                let S = getWorldPositionFromGBuffer(sGBuffer, sampleUV);

                let d = S - P;
                let dist = length(d);
                if (dist < 0.001) { continue; }
                let dirW = d / dist;

                // Below the tangent plane: neither light nor occlusion.
                let nl = dot(N, dirW);
                if (nl <= 0.0) { continue; }

                let sinSq = nl * nl;
                if (sinSq <= sinSqHorizon) { continue; }
                let band = sinSq - sinSqHorizon;
                // The horizon rises even for back-facing or out-of-range
                // samples — they still occlude what lies behind them.
                sinSqHorizon = sinSq;

                // Emitter must face the receiver to radiate toward it.
                let facing = dot(getWorldNormalFromGBuffer(sGBuffer), -dirW);
                if (facing <= 0.0) { continue; }

                // Soft range cutoff so the world-space radius setting
                // bounds the gather; solid-angle decay is already implicit
                // in the band weighting.
                let falloff = saturate(1.0 - dist / ssgiSettings.radius);
                let bounce = textureLoad(inTex, sampleCoord, 0).rgb;
                giAccum = giAccum + bounce * band * sqrt(saturate(facing)) * falloff;
            }
        }
        // Average the per-slice hemisphere fractions over the azimuth.
        giAccum = giAccum / f32(sliceCount);

        textureStore(giTex, fragCoord, vec4<f32>(giAccum, viewZ));
    }
`;
