/**
 * @internal
 */
export let UnLit: string = /*wgsl*/ `
    #include "Common_vert"
    #include "Common_frag"
    #include "UnLit_frag"
    #include "UnLitMaterialUniform_frag"

    #if USE_CUSTOMUNIFORM
        struct MaterialUniform {
            transformUV1:vec4<f32>,
            transformUV2:vec4<f32>,
            baseColor: vec4<f32>,
            alphaCutoff: f32,
        };
    #endif

    @group(1) @binding(0)
    var baseMapSampler: sampler;
    @group(1) @binding(1)
    var baseMap: texture_2d<f32>;

    fn vert(inputData:VertexAttributes) -> VertexOutput {
        ORI_Vert(inputData) ;
        return ORI_VertexOut ;
    }

    fn frag(){
        var transformUV1 = materialUniform.transformUV1;
        var transformUV2 = materialUniform.transformUV2;

        var uv = transformUV1.zw * ORI_VertexVarying.fragUV0 + transformUV1.xy;
        var color = textureSample(baseMap,baseMapSampler,uv) ;
        if(color.w < materialUniform.alphaCutoff){
            discard ;
        }
        // Texture color stays in sRGB-encoded numerical form when
        // the user loads a default rgba8unorm BitmapTexture2D —
        // shader-side gammaToLiner brings it into linear HDR before
        // the final ACES TonemapPost + sRGB swapchain encode.
        // Without this, sRGB-encoded values get re-encoded by the
        // swapchain view → washed-out / over-bright look.
        // USE_SRGB_ALBEDO opts out for hardware-decoded
        // (rgba8unorm-srgb) textures.
        #if USE_SRGB_ALBEDO
            ORI_ShadingInput.BaseColor = color * materialUniform.baseColor ;
        #else
            color = vec4f(gammaToLiner(color.rgb), color.a);
            ORI_ShadingInput.BaseColor = color * materialUniform.baseColor ;
        #endif
        UnLit();
    }
`

