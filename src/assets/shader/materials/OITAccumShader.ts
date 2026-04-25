/**
 * Weighted-Blended OIT accumulation shader (McGuire & Bavoil 2013).
 *
 * Fragment outputs two attachments:
 *   - location(0): pre-multiplied RGB * weight, with alpha * weight in .a
 *   - location(1): per-fragment alpha (R8) — used by the resolve pass to
 *                  reconstruct visibility via product-of-(1-alpha).
 *
 * Render pass blend states (set by the OIT renderer, NOT by the shader
 * itself — pipeline blend factors are pipeline state):
 *   - accum:  { ONE, ONE } for both color + alpha components
 *   - reveal: { ZERO, ONE_MINUS_SRC_ALPHA }
 *
 * Sample count must match the OIT RTFrame (1 — OIT does not use MSAA
 * because the accumulation is order-independent and per-fragment).
 *
 * @internal
 */
export let OITAccumShader: string = /*wgsl*/`
    #include "Common_vert"
    #include "GlobalUniform"
    #include "FragmentVarying"
    #include "PhysicMaterialUniform_frag"

    @group(1) @binding(auto)
    var baseMapSampler: sampler;
    @group(1) @binding(auto)
    var baseMap: texture_2d<f32>;

    struct OITFragmentOutput {
        @location(0) accum: vec4<f32>,
        @location(1) reveal: f32,
    };

    fn vert(inputData:VertexAttributes) -> VertexOutput {
        ORI_Vert(inputData);
        return ORI_VertexOut;
    }

    @fragment
    fn FragMain(vertex_varying: FragmentVarying) -> OITFragmentOutput {
        var out: OITFragmentOutput;

        // Sample baseMap.a so textured materials (decals, particles)
        // can opt into OIT — same semantics as LitMaterial baseMap.
        let baseMapOffsetSize = materialUniform.baseMapOffsetSize;
        let uv = baseMapOffsetSize.zw * vertex_varying.fragUV0 + baseMapOffsetSize.xy;
        let texColor = textureSample(baseMap, baseMapSampler, uv);

        let baseColor = materialUniform.baseColor;
        let rgb = baseColor.rgb * texColor.rgb;
        let alpha = baseColor.a * texColor.a;

        // McGuire & Bavoil 2013, eq. 9 — depth-based weight that biases
        // closer fragments to dominate. fragCoord.z is in NDC [0..1].
        let z = vertex_varying.fragCoord.z;
        let w = clamp(
            pow(alpha + 0.01, 4.0) +
            max(min(0.3 / (1e-5 + pow(z / 200.0, 4.0)), 3000.0), 0.01),
            0.01, 3000.0
        );

        // Pre-multiplied accumulation. Reveal channel multiplicatively
        // products (1 - alpha) so the resolve pass can recover the
        // background visibility as 1 - reveal.
        out.accum = vec4<f32>(rgb * alpha, alpha) * w;
        out.reveal = alpha;
        return out;
    }
`;
