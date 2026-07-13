#include "Common_vert"
#include "Common_frag"
#include "UnLit_frag"
#include "VideoUniform_frag"

@group(1) @binding(auto)
var baseMapSampler: sampler;
@group(1) @binding(auto)
var baseMap: texture_2d<f32>;

fn vert(inputData:VertexAttributes) -> VertexOutput {
    ORI_Vert(inputData) ;
    return ORI_VertexOut ;
}

fn frag(){
    let transformUV1 = materialUniform.transformUV1;

    let uv = transformUV1.zw * ORI_VertexVarying.fragUV0 + transformUV1.xy; 

    if(uv.x < materialUniform.rectClip.x || uv.x > (1.0-materialUniform.rectClip.z)) {
        discard;
    }

    if(uv.y < materialUniform.rectClip.y || uv.y > (1.0-materialUniform.rectClip.w)) {
        discard;
    }

    var videoColor = textureSample(baseMap, baseMapSampler, uv);

    // Default BitmapTexture2D is rgba8unorm holding sRGB-encoded bytes;
    // decode to linear so the sRGB swapchain doesn't double-encode
    // (same fix as the UnLit-family shaders).
    videoColor = vec4<f32>(gammaToLiner(videoColor.rgb), videoColor.a);

    ORI_ShadingInput.BaseColor = videoColor * materialUniform.baseColor ;
    UnLit();
}