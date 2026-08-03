/**
 * @internal
 * Downscale one material's albedo texture into one layer of the RT-GI
 * albedo array via GPU sampling. Used because glTF-loaded textures keep
 * no CPU-side image (BitmapTexture2D.source is empty on that path), so
 * a canvas downscale is impossible. The source is typically sRGB, so
 * the sampled value is already linear; the destination layer stores
 * linear rgba8unorm (sRGB storage formats are not writable).
 * blitParam: x = destination layer, y = hasSource (0 writes white).
 */
export let DDGIAlbedoBlit_shader = /*wgsl*/ `
struct BlitParam {
    layer : f32,
    hasSource : f32,
    retain0 : f32,
    retain1 : f32,
};

@group(0) @binding(0) var srcMapSampler : sampler;
@group(0) @binding(1) var srcMap : texture_2d<f32>;
@group(0) @binding(2) var dstMap : texture_storage_2d_array<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> blitParam : BlitParam;

@compute @workgroup_size(8, 8, 1)
fn CsMain(@builtin(global_invocation_id) gid : vec3<u32>) {
    let size = textureDimensions(dstMap);
    if (gid.x >= size.x || gid.y >= size.y) { return; }
    let uv = (vec2<f32>(gid.xy) + 0.5) / vec2<f32>(size);
    var color = vec4<f32>(1.0);
    if (blitParam.hasSource > 0.5) {
        color = textureSampleLevel(srcMap, srcMapSampler, uv, 0.0);
    }
    textureStore(dstMap, vec2<i32>(gid.xy), i32(blitParam.layer), color);
}
`;
