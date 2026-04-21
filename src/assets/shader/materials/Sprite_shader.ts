/**
 * @internal
 * Sprite shader — textured quad with tint, uv-rect, linear fill mask,
 * rounded-corner SDF, optional 9-slice border remap, optional UV-space
 * scissor clip (with corner radius / fade-out edge), and an optional
 * `USE_VIDEO_TEXTURE` branch that samples a `texture_external` (WebGPU
 * video pipeline) instead of a static `texture_2d<f32>`.
 *
 * Runs through the standard `Common_vert` / `Common_frag` / `UnLit_frag`
 * pipeline so it participates in the normal forward pass (world-space
 * or, with an `OverlayCamera`, screen-space).
 */
export let Sprite_shader: string = /*wgsl*/ `
    #include "Common_vert"
    #include "Common_frag"
    #include "UnLit_frag"

    #if USE_CUSTOMUNIFORM
    #else
        struct MaterialUniform {
            color: vec4<f32>,
            uvRect: vec4<f32>,
            sliceBorder: vec4<f32>,
            scissorRect: vec4<f32>,
            size: vec2<f32>,
            pivot: vec2<f32>,
            sliceScale: vec2<f32>,
            spritePad0: vec2<f32>,
            fillRatio: f32,
            fillDirection: f32,
            cornerRadius: f32,
            sliceEnable: f32,
            scissorEnable: f32,
            scissorCornerRadius: f32,
            scissorFadeOutSize: f32,
            spritePad1: f32,
        };
    #endif

    @group(2) @binding(0)
    var<uniform> materialUniform: MaterialUniform;

    @group(1) @binding(auto)
    var baseMapSampler: sampler;
    #if USE_VIDEO_TEXTURE
        @group(1) @binding(auto)
        var baseMap: texture_external;
    #else
        @group(1) @binding(auto)
        var baseMap: texture_2d<f32>;
    #endif

    fn vert(inputData: VertexAttributes) -> VertexOutput {
        // Shared unit-quad geometry has positions in [-0.5, +0.5].
        // Apply pivot (0..1, 0.5 = centered) then scale by size.
        var v = inputData;
        let shift = vec2<f32>(0.5 - materialUniform.pivot.x, 0.5 - materialUniform.pivot.y);
        v.position = vec3<f32>(
            (inputData.position.x + shift.x) * materialUniform.size.x,
            (inputData.position.y + shift.y) * materialUniform.size.y,
            inputData.position.z
        );
        ORI_Vert(v);
        return ORI_VertexOut;
    }

    // 9-slice remap: scaleAxis = displaySize/sourceSize along this axis,
    // border = (near, far) as normalized source-UV fractions. Given an input
    // display-UV in [0,1], returns the source-UV in [0,1] that preserves the
    // two border strips at 1:1 and stretches the center.
    fn spriteSliceBorder(uv: f32, scaleAxis: f32, border: vec2<f32>) -> f32 {
        var s = uv * scaleAxis;
        if (s > border.x) {
            s = s - border.x;
            let centerPartMax = max(scaleAxis - border.x - border.y, 0.0001);
            let centerPartMin = max(1.0 - border.x - border.y, 0.0001);
            if (s < centerPartMax) {
                s = border.x + (s / centerPartMax) * centerPartMin;
            } else {
                s = s - centerPartMax + border.x + centerPartMin;
            }
        }
        return s;
    }

    fn spriteCornerMask(local: vec2<f32>, radius: f32) -> f32 {
        let half = materialUniform.size * 0.5;
        let p = (local - vec2<f32>(0.5)) * materialUniform.size;
        let r = min(radius, min(half.x, half.y));
        let q = abs(p) - half + vec2<f32>(r);
        let d = length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
        return 1.0 - smoothstep(-1.0, 1.0, d);
    }

    // UV-space scissor. scissorRect = (left, top, right, bottom) in local UV.
    // scissorFadeOutSize > 0 gives a soft edge; 0 = hard clip.
    fn spriteScissorAlpha(local: vec2<f32>) -> f32 {
        let rect = materialUniform.scissorRect;
        let minX = min(rect.x, rect.z);
        let maxX = max(rect.x, rect.z);
        let minY = min(rect.y, rect.w);
        let maxY = max(rect.y, rect.w);

        // Outside bbox → 0
        if (local.x < minX || local.x > maxX || local.y < minY || local.y > maxY) {
            return 0.0;
        }

        let fade = materialUniform.scissorFadeOutSize;
        let cr = materialUniform.scissorCornerRadius;
        if (fade <= 0.0 && cr <= 0.0) {
            return 1.0;
        }

        // Distance (inside, positive) to closest edge.
        let dxMin = local.x - minX;
        let dxMax = maxX - local.x;
        let dyMin = local.y - minY;
        let dyMax = maxY - local.y;
        let edgeDist = min(min(dxMin, dxMax), min(dyMin, dyMax));

        var alpha = 1.0;
        if (fade > 0.0) {
            alpha = smoothstep(0.0, fade, edgeDist);
        }
        // Corner rounding: if point lies in a corner region (dist < cr along
        // both axes), clip by circular SDF.
        if (cr > 0.0) {
            let dx = min(dxMin, dxMax);
            let dy = min(dyMin, dyMax);
            if (dx < cr && dy < cr) {
                let cornerDist = length(vec2<f32>(cr - dx, cr - dy));
                alpha = min(alpha, 1.0 - smoothstep(cr - max(fade, 0.001), cr, cornerDist));
            }
        }
        return clamp(alpha, 0.0, 1.0);
    }

    fn frag() {
        let local = ORI_VertexVarying.fragUV0;

        // --- Scissor (UV-space) -------------------------------------------
        var scissorAlpha = 1.0;
        if (materialUniform.scissorEnable > 0.5) {
            scissorAlpha = spriteScissorAlpha(local);
            if (scissorAlpha <= 0.0) {
                discard;
            }
        }

        // --- UV remap (9-slice or uvRect) ---------------------------------
        var sourceUV = local;
        if (materialUniform.sliceEnable > 0.5) {
            sourceUV.x = spriteSliceBorder(local.x, max(materialUniform.sliceScale.x, 0.0001),
                                           vec2<f32>(materialUniform.sliceBorder.x, materialUniform.sliceBorder.z));
            sourceUV.y = spriteSliceBorder(local.y, max(materialUniform.sliceScale.y, 0.0001),
                                           vec2<f32>(materialUniform.sliceBorder.y, materialUniform.sliceBorder.w));
        }
        let uv = materialUniform.uvRect.xy + sourceUV * materialUniform.uvRect.zw;

        // --- Sampling -----------------------------------------------------
        #if USE_VIDEO_TEXTURE
            let vsize = textureDimensions(baseMap).xy - 1;
            let iuv = vec2<i32>(uv * vec2<f32>(vsize));
            var sampled = textureLoad(baseMap, iuv);
        #else
            var sampled = textureSample(baseMap, baseMapSampler, uv);
        #endif
        sampled = sampled * materialUniform.color;

        // --- Fill mask ----------------------------------------------------
        var mask: f32 = 1.0;
        let fr = clamp(materialUniform.fillRatio, 0.0, 1.0);
        let dir = materialUniform.fillDirection;
        if (dir < 0.5) {
            mask = step(local.x, fr);
        } else if (dir < 1.5) {
            mask = step(1.0 - fr, local.x);
        } else if (dir < 2.5) {
            mask = step(local.y, fr);
        } else {
            mask = step(1.0 - fr, local.y);
        }
        sampled.a = sampled.a * mask * scissorAlpha;

        // --- Corner radius (sprite outline) -------------------------------
        if (materialUniform.cornerRadius > 0.0) {
            sampled.a = sampled.a * spriteCornerMask(local, materialUniform.cornerRadius);
        }

        if (sampled.a <= 0.0) {
            discard;
        }

        ORI_ShadingInput.BaseColor = sampled;
        UnLit();
    }
`
