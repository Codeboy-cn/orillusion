/**
 * SSGI temporal resolve — second pass of the SSGI pipeline.
 *
 * Consumes the raw single-frame gather written by SSGI_cs (rgb = gi,
 * a = receiver view depth), reprojects into the previous frame with the
 * stored camera matrices (same convention as TAA_cs), validates history
 * by view depth, blends with an exponential moving average and
 * composites onto the scene color.
 *
 * Kept separate from the march pass on purpose: the two mat4 uniforms
 * and history traffic would otherwise stay live across the march loop
 * and collapse its occupancy (measured 5x slowdown when fused).
 *
 * @internal
 */
export let SSGITemporal_cs: string = /*wgsl*/`
    #include "GlobalUniform"
    #include "GBufferStand"

    const PI: f32 = 3.1415926;

    struct SSGITemporalSettings {
        preProjMatrix: mat4x4<f32>,
        preViewMatrix: mat4x4<f32>,
        intensity: f32,
        hysteresis: f32,
        frameIndex: f32,
        slot0: f32,
    };

    @group(0) @binding(2) var<uniform> temporalSettings: SSGITemporalSettings;
    @group(0) @binding(3) var inTex: texture_2d<f32>;
    @group(0) @binding(4) var outTex: texture_storage_2d<rgba16float, write>;
    @group(0) @binding(5) var giTex: texture_2d<f32>;
    @group(0) @binding(6) var historyTex: texture_2d<f32>;
    @group(0) @binding(7) var historyOut: texture_storage_2d<rgba16float, write>;

    @compute @workgroup_size(8, 8, 1)
    fn CsMain(@builtin(global_invocation_id) gid: vec3<u32>) {
        let fragCoord = vec2<i32>(gid.xy);
        let texSize = textureDimensions(inTex).xy;
        if (fragCoord.x >= i32(texSize.x) || fragCoord.y >= i32(texSize.y)) { return; }
        let fragUV = vec2<f32>(fragCoord) / vec2<f32>(texSize - 1u);

        let oc = textureLoad(inTex, fragCoord, 0);
        let gBuffer = getGBuffer(fragCoord);
        useNormalMatrixInv();
        if (getRoughnessFromGBuffer(gBuffer) <= 0.0) {
            // Zero depth key invalidates any stale history at this texel.
            textureStore(historyOut, fragCoord, vec4<f32>(0.0));
            textureStore(outTex, fragCoord, oc);
            return;
        }

        let gi = textureLoad(giTex, fragCoord, 0);
        let viewZ = gi.a;
        // Depth-weighted 3x3 spatial prefilter (dilated stride 3) over the
        // raw gather. The per-frame estimate has huge variance (few binary
        // hit-or-miss taps); irradiance is low-frequency, so trading a few
        // pixels of spatial resolution cuts the EMA's equilibrium noise
        // by ~3x. Depth weighting keeps edges from bleeding across
        // geometry.
        var giSum = vec3<f32>(0.0);
        var wSum = 0.0;
        for (var dy: i32 = -1; dy <= 1; dy = dy + 1) {
            for (var dx: i32 = -1; dx <= 1; dx = dx + 1) {
                let nCoord = clamp(fragCoord + vec2<i32>(dx, dy) * 3,
                    vec2<i32>(0), vec2<i32>(texSize) - 1);
                let g = textureLoad(giTex, nCoord, 0);
                // g.a == 0 marks sky neighbours; weight them out.
                let wz = select(0.0,
                    exp(-abs(g.a - viewZ) / max(viewZ * 0.1, 0.1)),
                    g.a > 0.0);
                giSum = giSum + g.rgb * wz;
                wSum = wSum + wz;
            }
        }
        let giAccum = giSum / max(wSum, 0.001);
        let P = getWorldPositionFromGBuffer(gBuffer, fragUV);
        let albedo = getAbldeoFromGBuffer(gBuffer).rgb;

        // Reproject P into the previous frame (TAA_cs convention) and
        // validate the stored view depth; fold validity into the blend
        // weight to keep control flow uniform.
        let clipPrev = temporalSettings.preProjMatrix * (temporalSettings.preViewMatrix * vec4<f32>(P, 1.0));
        let w = max(clipPrev.w, 0.001);
        var prevUV = vec2<f32>(clipPrev.x, -clipPrev.y) / w;
        prevUV = (prevUV + 1.0) * 0.5;
        let inBounds = clipPrev.w > 0.0 &&
            prevUV.x >= 0.0 && prevUV.x <= 1.0 && prevUV.y >= 0.0 && prevUV.y <= 1.0;
        let prevCoord = vec2<i32>(clamp(prevUV, vec2<f32>(0.0), vec2<f32>(1.0)) * vec2<f32>(texSize - 1u));
        // Clamp guards the EMA feedback loop: one Inf/NaN texel (e.g. an
        // f16 overflow) would otherwise recirculate through the history.
        let hist = clamp(textureLoad(historyTex, prevCoord, 0),
            vec4<f32>(0.0), vec4<f32>(65000.0));
        // hist.a holds the surface's view depth when it was written; the
        // reprojected clip w is that same depth if we are still looking
        // at the same surface.
        let histValid = temporalSettings.frameIndex > 0.5 && inBounds && hist.a > 0.0 &&
            abs(hist.a - clipPrev.w) < 0.05 * max(clipPrev.w, 1.0);
        let alpha = select(1.0, clamp(1.0 - temporalSettings.hysteresis, 0.01, 1.0), histValid);
        var blended = mix(hist.rgb, giAccum, alpha);
        // Flush EMA-decayed values to zero before they reach the f16
        // denormal range in the history texture.
        blended = select(vec3<f32>(0.0), blended, blended > vec3<f32>(1.0e-4));
        textureStore(historyOut, fragCoord, vec4<f32>(blended, viewZ));

        let result = oc.rgb + albedo * blended * temporalSettings.intensity;
        textureStore(outTex, fragCoord, vec4<f32>(result, oc.a));
    }
`;
