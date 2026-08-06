/**
 * SSGI temporal resolve — second pass of the SSGI pipeline.
 *
 * Consumes the raw single-frame
 * bitmask gather written by SSGI_cs (giTex rgb = radiance, a =
 * visibility; keyTex r = receiver view depth), prefilters it spatially,
 * reprojects into the previous frame with the stored camera matrices,
 * validates history by view depth, blends with an exponential moving
 * average and composites onto the scene color with the reference
 * formula:
 *
 *   out = sceneColor * visibility + albedo * gi
 *
 * Kept separate from the march pass on purpose: the two mat4 uniforms
 * and history traffic would otherwise stay live across the march loop
 * and collapse its occupancy.
 *
 * @internal
 */
export let SSGITemporal_cs: string = /*wgsl*/`
    #include "GlobalUniform"
    #include "GBufferStand"

    // FastMathShader helpers pulled in by the includes reference PI
    // without defining it.
    const PI: f32 = 3.1415926;

    struct SSGITemporalSettings {
        preProjMatrix: mat4x4<f32>,
        preViewMatrix: mat4x4<f32>,
        hysteresis: f32,
        frameIndex: f32,
        slot0: f32,
        slot1: f32,
    };

    @group(0) @binding(2) var<uniform> temporalSettings: SSGITemporalSettings;
    @group(0) @binding(3) var inTex: texture_2d<f32>;
    @group(0) @binding(4) var outTex: texture_storage_2d<rgba16float, write>;
    @group(0) @binding(5) var giTex: texture_2d<f32>;
    @group(0) @binding(6) var keyTex: texture_2d<f32>;
    @group(0) @binding(7) var historyTex: texture_2d<f32>;
    @group(0) @binding(8) var historyKeyTex: texture_2d<f32>;
    @group(0) @binding(9) var historyOut: texture_storage_2d<rgba16float, write>;
    @group(0) @binding(10) var historyKeyOut: texture_storage_2d<r32float, write>;

    @compute @workgroup_size(8, 8, 1)
    fn CsMain(@builtin(global_invocation_id) gid: vec3<u32>) {
        let fragCoord = vec2<i32>(gid.xy);
        let texSize = textureDimensions(inTex).xy;
        if (fragCoord.x >= i32(texSize.x) || fragCoord.y >= i32(texSize.y)) { return; }
        let fragUV = vec2<f32>(fragCoord) / vec2<f32>(texSize - 1u);

        let oc = textureLoad(inTex, fragCoord, 0);
        let gBuffer = getGBuffer(fragCoord);
        if (getRoughnessFromGBuffer(gBuffer) <= 0.0) {
            // Sky: zero depth key invalidates any stale history here.
            textureStore(historyOut, fragCoord, vec4<f32>(0.0, 0.0, 0.0, 1.0));
            textureStore(historyKeyOut, fragCoord, vec4<f32>(0.0));
            textureStore(outTex, fragCoord, oc);
            return;
        }

        let viewZ = textureLoad(keyTex, fragCoord, 0).x;

        // Depth-weighted 3x3 spatial prefilter (dilated stride 3) over
        // the raw gather and visibility. The per-frame estimate has huge
        // variance (few binary hit-or-miss sectors); irradiance is
        // low-frequency, so trading a few pixels of spatial resolution
        // cuts the EMA's equilibrium noise. Depth weighting keeps edges
        // from bleeding across geometry.
        var sum = vec4<f32>(0.0);
        var wSum = 0.0;
        for (var dy: i32 = -1; dy <= 1; dy = dy + 1) {
            for (var dx: i32 = -1; dx <= 1; dx = dx + 1) {
                let nCoord = clamp(fragCoord + vec2<i32>(dx, dy) * 3,
                    vec2<i32>(0), vec2<i32>(texSize) - 1);
                let nKey = textureLoad(keyTex, nCoord, 0).x;
                // key == 0 marks sky neighbours; weight them out.
                let wz = select(0.0,
                    exp(-abs(nKey - viewZ) / max(viewZ * 0.1, 0.1)),
                    nKey > 0.0);
                sum = sum + textureLoad(giTex, nCoord, 0) * wz;
                wSum = wSum + wz;
            }
        }
        let filtered = sum / max(wSum, 0.001);

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
        let histKey = textureLoad(historyKeyTex, prevCoord, 0).x;
        // historyKey holds the surface's view depth when it was written;
        // the reprojected clip w is that same depth if we are still
        // looking at the same surface.
        let histValid = temporalSettings.frameIndex > 0.5 && inBounds && histKey > 0.0 &&
            abs(histKey - clipPrev.w) < 0.05 * max(clipPrev.w, 1.0);
        let alpha = select(1.0, clamp(1.0 - temporalSettings.hysteresis, 0.01, 1.0), histValid);
        var blended = mix(hist, filtered, alpha);
        // Flush EMA-decayed radiance to zero before it reaches the f16
        // denormal range in the history texture.
        let flushed = select(vec3<f32>(0.0), blended.rgb, blended.rgb > vec3<f32>(1.0e-4));
        blended = vec4<f32>(flushed, clamp(blended.a, 0.0, 1.0));
        textureStore(historyOut, fragCoord, blended);
        textureStore(historyKeyOut, fragCoord, vec4<f32>(viewZ, 0.0, 0.0, 0.0));

        // Reference composition:
        // scene color attenuated by visibility, indirect term modulated
        // by the surface albedo.
        let result = oc.rgb * blended.a + albedo * blended.rgb;
        textureStore(outTex, fragCoord, vec4<f32>(result, oc.a));
    }
`;
