/**
 * @internal
 * Octahedral blend kernel for the software-ray-traced DDGI path. One
 * thread per (probe, oct texel). Reads the traced rays from rayHitBuffer
 * (written by DDGITrace_Cs), accumulates cosine-weighted irradiance and
 * depth moments, applies the temporal blend and writes the SAME atlas
 * layout as DDGIIrradiance_Cs — so Irradiance_frag samples both paths
 * unchanged.
 *
 * Direction convention: readers (Irradiance_frag / MultiBouncePass_cs)
 * key texels by applyQuaternion(worldDir), so this kernel compares
 * octDecode(texelUV) against applyQuaternion(rayDir) directly — rotation
 * preserves dot products. The raster kernel's "-octDecode" antipode
 * compensation does NOT apply here: traced ray radiance is stored for the
 * TRUE ray direction, there is no cube-GBuffer fetch chain to mirror.
 */
export let DDGITraceBlend_shader = /*wgsl*/ `
var<private> PI : f32 = 3.14159265359;
#include "GenerayRandomDir"
#include "MathShader"
#include "IrradianceVolumeData_frag"

struct Uniforms {
    matrix : array<mat4x4<f32>>
};

struct CacheHitData {
  color : vec4<f32>,
  depth : vec4<f32>,
}

// Must match TraceUniform in DDGITrace_Cs.
struct TraceUniform {
    nodeCount : f32,
    lightCount : f32,
    skyIntensity : f32,
    probeCursor : f32,
    updateCount : f32,
    retain0 : f32,
    retain1 : f32,
    retain2 : f32,
};

// NOTE: every declared binding must be referenced — the engine builds
// bind groups from shader reflection while the pipeline uses layout
// 'auto', which strips unused bindings and then rejects the group.
@group(0) @binding(0) var<storage, read_write> irradianceBuffer : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> depthBuffer : array<vec4<f32>>;
@group(0) @binding(2) var<uniform> uniformData : IrradianceVolumeData;
@group(0) @binding(3) var probeIrradianceMap : texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var probeDepthMap : texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var<storage, read> rayHitBuffer : array<vec4<f32>>;
@group(0) @binding(6) var<uniform> traceUniform : TraceUniform;

@group(1) @binding(0) var<storage, read> models : Uniforms;

var<private> probeID : u32;
var<private> workgroup_idx : u32;
var<private> workgroup_idy : u32;
var<private> hysteresis : f32 = 0.98;
var<private> epsilon : f32 = 1e-6;
var<private> resultIrradiance : vec4<f32>;
var<private> resultDepth : vec4<f32>;
var<private> RAYS_PER_PROBE : f32 = 144.0;
var<private> OCT_RT_SIZE : u32;
var<private> OCT_SIDE_SIZE_u32 : u32;
var<private> OCT_SIDE_SIZE_f32 : f32;
var<private> quaternion : vec4<f32> = vec4<f32>(0.0, -0.7071067811865475, 0.7071067811865475, 0.0);
var<private> randomMatrix : mat4x4<f32>;

@compute @workgroup_size(8, 8, 1)
fn CsMain(@builtin(global_invocation_id) globalInvocation_id : vec3<u32>) {
    RAYS_PER_PROBE = f32(i32(uniformData.rayNumber));
    OCT_RT_SIZE = u32(uniformData.OctRTMaxSize);
    OCT_SIDE_SIZE_u32 = u32(uniformData.OctRTSideSize);
    OCT_SIDE_SIZE_f32 = f32(uniformData.OctRTSideSize);
    hysteresis = uniformData.hysteresis;

    // Dispatch z covers the round-robin window; map the slot to the
    // actual probe index (same mapping as DDGITrace_Cs).
    let probeCount = u32(uniformData.gridXCount * uniformData.gridYCount * uniformData.gridZCount);
    if (probeCount == 0u) { return; }
    if (globalInvocation_id.z >= u32(traceUniform.updateCount)) { return; }
    probeID = (u32(traceUniform.probeCursor) + globalInvocation_id.z) % probeCount;
    workgroup_idx = globalInvocation_id.x;
    workgroup_idy = globalInvocation_id.y;

    resultIrradiance = vec4<f32>(0.0);
    resultDepth = vec4<f32>(0.0);

    // Texel direction in ROTATED (atlas) space, anchored on the texel
    // center. No negation — see the header comment.
    let ux = (f32(workgroup_idx) + 0.5) / OCT_SIDE_SIZE_f32;
    let uy = (f32(workgroup_idy) + 0.5) / OCT_SIDE_SIZE_f32;
    let texelDir = normalize(octDecode(vec2<f32>(ux, uy) * 2.0 - 1.0));

    let orientationIndex = u32(uniformData.orientationIndex);
    randomMatrix = models.matrix[orientationIndex];

    for (var i : f32 = 0.0; i < RAYS_PER_PROBE; i = i + 1.0) {
        accumulateRay(i, texelDir);
    }

    if (resultIrradiance.w > epsilon) {
        var color = resultIrradiance.xyz / (2.0 * resultIrradiance.w);
        color = pow(color, vec3<f32>(1.0 / uniformData.ddgiGamma));
        resultIrradiance = vec4<f32>(color, 1.0 - hysteresis);
    }
    if (resultDepth.w > epsilon) {
        resultDepth = vec4<f32>(resultDepth.xyz / (2.0 * resultDepth.w), 1.0 - hysteresis);
    }

    let pixelCoord = getWriteOctUVByID();

    var lerpDataResult : CacheHitData;
    lerpDataResult.color = resultIrradiance;
    lerpDataResult.depth = resultDepth;
    lerpDataResult = lerpHitData(lerpDataResult, pixelCoord);
    writeRayHitData(pixelCoord, lerpDataResult);

    storePixelAtCoord(probeIrradianceMap, pixelCoord, vec4<f32>(lerpDataResult.color.xyz, 1.0), true);
    storePixelAtCoord(probeDepthMap, pixelCoord, vec4<f32>(lerpDataResult.depth.xy, 0.0, 1.0), false);
}

fn accumulateRay(rayID : f32, texelDir : vec3<f32>) {
    let texelDirection = sphericalFibonacci(rayID, RAYS_PER_PROBE);
    // Same deterministic direction set as DDGITrace_Cs, rotated into atlas
    // space so the dot against texelDir happens in one frame of reference.
    let rayDirWorld = normalize((randomMatrix * vec4<f32>(texelDirection, 1.0)).xyz);
    let rayDir = normalize(applyQuaternion(rayDirWorld, quaternion));

    let data = rayHitBuffer[probeID * u32(RAYS_PER_PROBE) + u32(rayID)];
    let backface = data.w < 0.0;
    let rayDistance = abs(data.w);

    let i_weight = max(0.0, dot(texelDir, rayDir));
    let d_weight = pow(i_weight, uniformData.depthSharpness);

    if (i_weight >= epsilon && !backface) {
        // Cosine-weighted estimator, normalized by the weight sum in CsMain.
        resultIrradiance += vec4<f32>(data.xyz * i_weight, i_weight);
    }
    if (d_weight >= epsilon) {
        resultDepth += vec4<f32>(rayDistance * d_weight, rayDistance * rayDistance * d_weight, 0.0, d_weight);
    }
}

fn lerpHitData(data : CacheHitData, coord : vec2<i32>) -> CacheHitData {
    var newData : CacheHitData = data;
    var oldData = readRayHitData(coord);
    newData.color = mix(oldData.color, newData.color, uniformData.lerpHysteresis);
    newData.depth = mix(oldData.depth, newData.depth, uniformData.lerpHysteresis);
    return newData;
}

fn storePixelAtCoord(texture : texture_storage_2d<rgba16float, write>, coord : vec2<i32>, color : vec4<f32>, isColor : bool) {
    let sideCnt = i32(OCT_SIDE_SIZE_u32);
    let sideBorderCnt = sideCnt + 2;
    let indexXY = coord / sideCnt;
    let modeXY = coord % sideCnt;

    var newCoord = indexXY * sideBorderCnt + modeXY;
    textureStore(texture, newCoord + 1, color);

    var borderCoord = vec2<i32>(-1);
    // left / right borders
    if (modeXY.x % (sideCnt - 1) == 0) {
        borderCoord = modeXY;
        borderCoord.y = sideCnt - borderCoord.y;
        if (modeXY.x == sideCnt - 1) {
            borderCoord.x = sideBorderCnt - 1;
        }
        borderCoord = indexXY * sideBorderCnt + borderCoord;
        textureStore(texture, borderCoord, color);
    }
    // top / bottom borders
    if (modeXY.y % (sideCnt - 1) == 0) {
        borderCoord = modeXY;
        borderCoord.x = sideCnt - borderCoord.x;
        if (modeXY.y == sideCnt - 1) {
            borderCoord.y = sideBorderCnt - 1;
        }
        borderCoord = indexXY * sideBorderCnt + borderCoord;
        textureStore(texture, borderCoord, color);
    }
    // corner pixels
    if (modeXY.x % (sideCnt - 1) == 0 && modeXY.y % (sideCnt - 1) == 0) {
        var cornerCoord = modeXY;
        if (modeXY.x == 0) {
            cornerCoord.x = sideBorderCnt - 1;
        } else {
            cornerCoord.x = 0;
        }
        if (modeXY.y == 0) {
            cornerCoord.y = sideBorderCnt - 1;
        } else {
            cornerCoord.y = 0;
        }
        cornerCoord = indexXY * sideBorderCnt + cornerCoord;
        textureStore(texture, cornerCoord, color);
    }
}

fn getWriteOctUVByID() -> vec2<i32> {
    var blockCount = u32(uniformData.gridXCount * uniformData.gridZCount);
    var offsetX = (probeID % blockCount) % u32(uniformData.gridXCount);
    var offsetY = u32(uniformData.gridZCount - 1.0) - (probeID % blockCount) / u32(uniformData.gridXCount);
    var offsetZ = probeID / blockCount;
    var pixelCoord = vec2<i32>(i32(workgroup_idx), i32(workgroup_idy));
    pixelCoord.x = pixelCoord.x + i32(offsetX * OCT_SIDE_SIZE_u32);
    pixelCoord.y = pixelCoord.y + i32(offsetY * OCT_SIDE_SIZE_u32 + offsetZ * u32(uniformData.gridZCount) * OCT_SIDE_SIZE_u32);

    pixelCoord = offsetByCol(pixelCoord, OCT_SIDE_SIZE_f32, OCT_RT_SIZE, vec3<f32>(uniformData.gridXCount, uniformData.gridYCount, uniformData.gridZCount));
    return pixelCoord;
}

fn offsetByCol(pixelCoord0 : vec2<i32>, octSideSize : f32, mapHeight : u32, counts : vec3<f32>) -> vec2<i32> {
    var pixelCoord = pixelCoord0;
    let blockSizeYBorder : i32 = i32((octSideSize + 2.0) * counts.z);
    let blockMaxRowBorder : i32 = i32(mapHeight) / blockSizeYBorder;
    let pixelCountYMax : i32 = blockMaxRowBorder * i32(octSideSize * counts.z);
    let col : i32 = pixelCoord.y / pixelCountYMax;

    pixelCoord.x = col * i32(octSideSize * counts.x) + pixelCoord.x;
    pixelCoord.y = pixelCoord.y % pixelCountYMax;

    return pixelCoord;
}

fn writeRayHitData(uv : vec2<i32>, data : CacheHitData) {
    let index = uv.y * i32(OCT_RT_SIZE) + uv.x;
    irradianceBuffer[index] = data.color;
    depthBuffer[index] = data.depth;
}

fn readRayHitData(uv : vec2<i32>) -> CacheHitData {
    var data : CacheHitData;
    let index = uv.y * i32(OCT_RT_SIZE) + uv.x;
    data.color = irradianceBuffer[index];
    data.depth = depthBuffer[index];
    return data;
}
`;
