/**
 * @internal
 * Software-ray-traced DDGI probe update: one thread per (probe, ray).
 * Traces the CPU-built skip-link BVH (world-space triangle soup), shades
 * the hit with direct lighting (shadow rays against the same BVH instead
 * of shadow maps), adds emissive and the previous frame's probe
 * irradiance as the infinite bounce, and writes radiance + hit distance
 * into rayHitBuffer for the octahedral blend kernel.
 *
 * Direct-light formulas mirror DDGILighting_CSShader / the camera pass
 * (getHDRColor color, raw intensity for directional, sphere_unit energy
 * term for point/spot) so the traced field matches the raster path's
 * energy convention.
 *
 * rayHitBuffer entry layout (vec4):
 *   xyz = radiance, w = hit distance
 *   w > 0  : front-face hit or sky miss (distance clamped to maxDistance)
 *   w < 0  : backface hit, |w| = shrunk distance (blend skips radiance,
 *            keeps the shrunk depth so Chebyshev rejects buried probes)
 */
export let DDGITrace_shader = /*wgsl*/ `
#include "GenerayRandomDir"
#include "MathShader"
#include "ColorUtil_frag"
#include "IrradianceVolumeData_frag"
#include "LightData"

// Same light-type constants as DDGILighting_CSShader (not part of the
// LightData include).
const PointLightType = 1;
const DirectLightType = 2;
const SpotLightType = 3;

struct Uniforms {
    matrix : array<mat4x4<f32>>
};

struct TraceUniform {
    nodeCount : f32,
    lightCount : f32,
    skyIntensity : f32,
    // Round-robin window: this frame updates probes
    // [probeCursor, probeCursor + updateCount) modulo probeCount.
    probeCursor : f32,
    updateCount : f32,
    retain0 : f32,
    retain1 : f32,
    retain2 : f32,
};

@group(0) @binding(0) var<storage, read> bvhNodes : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> bvhTriangles : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> bvhMaterials : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> rayHitBuffer : array<vec4<f32>>;
@group(0) @binding(4) var<uniform> uniformData : IrradianceVolumeData;
@group(0) @binding(5) var<uniform> traceUniform : TraceUniform;

@group(1) @binding(0) var irradianceMapSampler : sampler;
@group(1) @binding(1) var irradianceMap : texture_2d<f32>;
@group(1) @binding(2) var prefilterMapSampler : sampler;
@group(1) @binding(3) var prefilterMap : texture_cube<f32>;
// Per-material albedo textures downscaled into one array (layer = material
// index, clamped). Layers are WHITE for untextured materials so the
// baseColor factor passes through unchanged.
@group(1) @binding(4) var albedoAtlasSampler : sampler;
@group(1) @binding(5) var albedoAtlas : texture_2d_array<f32>;

@group(2) @binding(0) var<storage, read> models : Uniforms;
@group(2) @binding(1) var<storage, read> lightBuffer : array<LightData>;

var<private> PI : f32 = 3.14159265359;
var<private> EPS : f32 = 1e-4;
// Same fixed rotation as DDGIIrradiance_Cs / Irradiance_frag: atlas texels
// are keyed by applyQuaternion(worldDir).
var<private> quaternion : vec4<f32> = vec4<f32>(0.0, -0.7071067811865475, 0.7071067811865475, 0.0);

struct HitInfo {
    t : f32,
    triIndex : i32,
    // Barycentrics of the hit (hit = (1-u-v)*v0 + u*v1 + v*v2), used for
    // the albedo-texture UV lookup.
    u : f32,
    v : f32,
};

// Node stride is 3 vec4s (12 floats), see BVHBuilder.ts:
//   [0].xyz bounds min, [0].w skip link
//   [1].xyz bounds max, [1].w triangle offset (leaf) / -1 (interior)
//   [2].x  triangle count
// Triangle stride is 4 vec4s, pre-sorted in BVH leaf order:
//   [0] = v0.xyz, material index
//   [1] = v1.xyz, uv0.x
//   [2] = v2.xyz, uv0.y
//   [3] = uv1.xy, uv2.xy
fn traverseBVH(rayOrigin : vec3<f32>, rayDir : vec3<f32>, tMax : f32, anyHit : bool) -> HitInfo {
    var hit : HitInfo;
    hit.t = tMax;
    hit.triIndex = -1;
    let nodeCount = i32(traceUniform.nodeCount);
    let invDir = 1.0 / rayDir;
    var n : i32 = 0;
    loop {
        if (n >= nodeCount) { break; }
        let n0 = bvhNodes[n * 3];
        let n1 = bvhNodes[n * 3 + 1];
        let t0 = (n0.xyz - rayOrigin) * invDir;
        let t1 = (n1.xyz - rayOrigin) * invDir;
        let tsmall = min(t0, t1);
        let tbig = max(t0, t1);
        let tEnter = max(max(tsmall.x, tsmall.y), max(tsmall.z, 0.0));
        let tExit = min(min(tbig.x, tbig.y), min(tbig.z, hit.t));
        if (tExit < tEnter) {
            n = i32(n0.w);
            continue;
        }
        let triOffset = i32(n1.w);
        if (triOffset >= 0) {
            let triCount = i32(bvhNodes[n * 3 + 2].x);
            for (var i : i32 = 0; i < triCount; i = i + 1) {
                let tri = triOffset + i;
                let r = intersectTriangle(tri, rayOrigin, rayDir, hit.t);
                if (r.x > 0.0) {
                    hit.t = r.x;
                    hit.triIndex = tri;
                    hit.u = r.y;
                    hit.v = r.z;
                    if (anyHit) { return hit; }
                }
            }
            n = i32(n0.w);
        } else {
            n = n + 1;
        }
    }
    return hit;
}

// Moeller-Trumbore; returns (-1,0,0) on miss, else (t, u, v) with the
// hit distance in (EPS, tMax) and the barycentrics of the hit.
fn intersectTriangle(tri : i32, rayOrigin : vec3<f32>, rayDir : vec3<f32>, tMax : f32) -> vec3<f32> {
    let v0 = bvhTriangles[tri * 4].xyz;
    let e1 = bvhTriangles[tri * 4 + 1].xyz - v0;
    let e2 = bvhTriangles[tri * 4 + 2].xyz - v0;
    let p = cross(rayDir, e2);
    let det = dot(e1, p);
    if (abs(det) < 1e-9) { return vec3<f32>(-1.0, 0.0, 0.0); }
    let invDet = 1.0 / det;
    let s = rayOrigin - v0;
    let u = dot(s, p) * invDet;
    if (u < 0.0 || u > 1.0) { return vec3<f32>(-1.0, 0.0, 0.0); }
    let q = cross(s, e1);
    let v = dot(rayDir, q) * invDet;
    if (v < 0.0 || u + v > 1.0) { return vec3<f32>(-1.0, 0.0, 0.0); }
    let t = dot(e2, q) * invDet;
    if (t <= EPS || t >= tMax) { return vec3<f32>(-1.0, 0.0, 0.0); }
    return vec3<f32>(t, u, v);
}

fn triangleNormal(tri : i32) -> vec3<f32> {
    let v0 = bvhTriangles[tri * 4].xyz;
    let e1 = bvhTriangles[tri * 4 + 1].xyz - v0;
    let e2 = bvhTriangles[tri * 4 + 2].xyz - v0;
    return normalize(cross(e1, e2));
}

// Interpolated UV at the hit, then the material's downscaled albedo
// texture (layer = material index). fract() emulates repeat addressing.
fn sampleAlbedoTexture(hit : HitInfo, matIndex : i32) -> vec3<f32> {
    let t1 = bvhTriangles[hit.triIndex * 4 + 1];
    let t2 = bvhTriangles[hit.triIndex * 4 + 2];
    let t3 = bvhTriangles[hit.triIndex * 4 + 3];
    let uv0 = vec2<f32>(t1.w, t2.w);
    let w = 1.0 - hit.u - hit.v;
    let uv = uv0 * w + t3.xy * hit.u + t3.zw * hit.v;
    let layer = min(matIndex, i32(textureNumLayers(albedoAtlas)) - 1);
    return textureSampleLevel(albedoAtlas, albedoAtlasSampler, fract(uv), layer, 0.0).rgb;
}

fn calcProbePosition(id : u32) -> vec3<f32> {
    var probeLocation = vec3<f32>(0.0);
    var blockCount = u32(uniformData.gridXCount * uniformData.gridZCount);
    var grid = vec3<u32>(0u);
    grid.x = (id % blockCount) % u32(uniformData.gridXCount);
    grid.y = id / blockCount;
    grid.z = (id % blockCount) / u32(uniformData.gridXCount);
    probeLocation.x = f32(grid.x) * uniformData.ProbeSpace + uniformData.startX;
    probeLocation.y = f32(grid.y) * uniformData.ProbeSpace + uniformData.startY;
    probeLocation.z = f32(grid.z) * uniformData.ProbeSpace + uniformData.startZ;
    return probeLocation;
}

// Nearest-probe index for a world position (used by the bounce lookup).
fn nearestProbeIndex(pos : vec3<f32>) -> u32 {
    let counts = vec3<f32>(uniformData.gridXCount, uniformData.gridYCount, uniformData.gridZCount);
    let start = vec3<f32>(uniformData.startX, uniformData.startY, uniformData.startZ);
    var grid = (pos - start) / uniformData.ProbeSpace;
    grid = clamp(round(grid), vec3<f32>(0.0), counts - 1.0);
    let g = vec3<u32>(grid);
    return g.x + g.z * u32(counts.x) + g.y * u32(counts.x) * u32(counts.z);
}

// Previous-frame probe irradiance at the hit point: the infinite bounce.
// Mirrors MultiBouncePass_cs getIrrdiaceIndex (same oct layout, same gamma
// decode) with the probe chosen by proximity to the hit position.
fn sampleProbeIrradiance(pos : vec3<f32>, normal : vec3<f32>) -> vec3<f32> {
    let probeIndex = nearestProbeIndex(pos);
    let dir = normalize(applyQuaternion(normal, quaternion));
    let size = uniformData.OctRTSideSize;
    var blockCount = u32(uniformData.gridXCount * uniformData.gridZCount);
    var offsetX = (probeIndex % blockCount) % u32(uniformData.gridXCount);
    var offsetY = u32(uniformData.gridZCount - 1.0) - (probeIndex % blockCount) / u32(uniformData.gridXCount);
    var offsetZ = probeIndex / blockCount;

    var pixelCoord = ((octEncode(dir) + 1.0) * 0.5) * vec2<f32>(size, size);
    var blockOffset = vec2<f32>(0.0);
    blockOffset.x = f32(offsetX) * size;
    blockOffset.y = f32(offsetY) * size + f32(offsetZ) * uniformData.gridZCount * size;

    let mapHeight = u32(uniformData.OctRTMaxSize);
    let counts = vec3<f32>(uniformData.gridXCount, uniformData.gridYCount, uniformData.gridZCount);
    var gridOffsetFrom = vec2<i32>(blockOffset) + 1;
    var gridOffsetTo = offsetByCol(gridOffsetFrom, size, mapHeight, counts);
    pixelCoord = pixelCoord + vec2<f32>(gridOffsetTo - 1) + vec2<f32>(vec2<i32>(vec2<f32>(gridOffsetTo) / size) * 2);
    let uv = (pixelCoord + 1.0) / uniformData.OctRTMaxSize;

    var probeIrradiance = textureSampleLevel(irradianceMap, irradianceMapSampler, uv, 0.0).xyz;
    // Atlas stores gamma-encoded values; decode to linear before feeding
    // energy back into the bounce loop (see MultiBouncePass_cs).
    probeIrradiance = pow(probeIrradiance, vec3<f32>(uniformData.ddgiGamma));
    return probeIrradiance;
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

// Occlusion test: any hit between the surface and the light.
fn shadowRay(origin : vec3<f32>, dir : vec3<f32>, dist : f32) -> f32 {
    let hit = traverseBVH(origin, dir, dist, true);
    return select(1.0, 0.0, hit.triIndex >= 0);
}

// Direct lighting with the same energy convention as DDGILighting_CSShader
// (which itself mirrors the camera pass LightingFunction_frag), but with
// BVH shadow rays in place of shadow maps.
fn evaluateDirect(albedo : vec3<f32>, hitPos : vec3<f32>, N : vec3<f32>) -> vec3<f32> {
    var lighting = vec3<f32>(0.0);
    let lightCount = i32(traceUniform.lightCount);
    let shadowOrigin = hitPos + N * (uniformData.ProbeSpace * 0.005);
    for (var i : i32 = 0; i < lightCount; i = i + 1) {
        let light = lightBuffer[i];
        let lightColor = getHDRColor(light.lightColor.rgb, light.linear);
        if (light.lightType == DirectLightType) {
            let L = -normalize(light.direction.xyz);
            let NoL = max(dot(N, L), 0.0);
            if (NoL <= 0.0) { continue; }
            let shadow = shadowRay(shadowOrigin, L, 1e30);
            lighting += (albedo / PI) * lightColor * NoL * max(0.0, light.intensity) * shadow;
        } else if (light.lightType == PointLightType || light.lightType == SpotLightType) {
            let lightPos = models.matrix[u32(light.lightMatrixIndex)][3].xyz;
            var dir = lightPos - hitPos;
            let dist = length(dir);
            if (dist >= light.range || dist == 0.0) { continue; }
            dir = dir / dist;
            var atten = 1.0 - smoothstep(0.0, light.range, dist);
            atten *= 1.0 / max(light.radius, 0.001);
            // sphere_unit(light.range, light.intensity), PI2 inlined.
            atten *= light.intensity / (4.0 * 9.86960440 * light.range * light.range);
            if (light.lightType == SpotLightType) {
                let theta = dot(-dir, normalize(light.direction.xyz));
                let angle = acos(theta);
                if (angle >= light.outerCutOff) { continue; }
                if (angle > light.innerCutOff) {
                    atten *= 1.0 - smoothstep(light.innerCutOff, light.outerCutOff, angle);
                }
            }
            let NoL = max(dot(N, dir), 0.0);
            if (NoL <= 0.0 || atten <= 0.0) { continue; }
            let shadow = shadowRay(shadowOrigin, dir, dist);
            lighting += (albedo / PI) * lightColor * NoL * atten * shadow;
        }
    }
    return lighting;
}

@compute @workgroup_size(64, 1, 1)
fn CsMain(@builtin(global_invocation_id) globalInvocation_id : vec3<u32>) {
    let raysPerProbe = u32(uniformData.rayNumber);
    let probeCount = u32(uniformData.gridXCount * uniformData.gridYCount * uniformData.gridZCount);
    if (probeCount == 0u || raysPerProbe == 0u) { return; }
    let updateCount = u32(traceUniform.updateCount);
    let idx = globalInvocation_id.x;
    let slot = idx / raysPerProbe;
    if (slot >= updateCount) { return; }
    let probeID = (u32(traceUniform.probeCursor) + slot) % probeCount;
    let rayID = idx % raysPerProbe;

    let probeLocation = calcProbePosition(probeID);
    let orientationIndex = u32(uniformData.orientationIndex);
    let randomMatrix = models.matrix[orientationIndex];
    let texelDirection = sphericalFibonacci(f32(rayID), uniformData.rayNumber);
    let rayDirection = normalize((randomMatrix * vec4<f32>(texelDirection, 1.0)).xyz);

    let hit = traverseBVH(probeLocation, rayDirection, 1e30, false);
    var result : vec4<f32>;
    if (hit.triIndex < 0) {
        // Sky miss: sample the environment cube as ray radiance. Distance
        // is clamped to maxDistance so depth moments never overflow fp16.
        let sky = textureSampleLevel(prefilterMap, prefilterMapSampler, rayDirection, 0.0).rgb * traceUniform.skyIntensity;
        result = vec4<f32>(sky, uniformData.maxDistance);
    } else {
        var normal = triangleNormal(hit.triIndex);
        let backface = dot(normal, rayDirection) > 0.0;
        let dist = min(hit.t, uniformData.maxDistance);
        if (backface) {
            // Buried-probe heuristic (same as the raster path): shrink the
            // recorded distance so Chebyshev rejects this probe, carry no
            // radiance.
            result = vec4<f32>(0.0, 0.0, 0.0, -dist * 0.1);
        } else {
            let hitPos = probeLocation + rayDirection * hit.t;
            let matIndex = i32(bvhTriangles[hit.triIndex * 4].w);
            // baseColor factor x downscaled albedo texture (white layer for
            // untextured materials) — Lumen-style textured GI, so scenes
            // whose color lives in textures bounce COLORED light.
            let albedo = bvhMaterials[matIndex * 2].xyz * sampleAlbedoTexture(hit, matIndex);
            let emissive = bvhMaterials[matIndex * 2 + 1].xyz;
            let direct = evaluateDirect(albedo, hitPos, normal);
            // Infinite bounce mirrors MultiBouncePass_cs blendIrradianceColor:
            // stored probe value is E/(2*PI), Lambert re-emission is
            // L = 2 * S * albedo, scaled by bounceIntensity.
            let k = clamp(uniformData.bounceIntensity, 0.0, 1.0);
            let bounce = sampleProbeIrradiance(hitPos, normal) * albedo * (2.0 * k);
            let radiance = direct + emissive + bounce;
            result = vec4<f32>(radiance, dist);
        }
    }
    rayHitBuffer[probeID * raysPerProbe + rayID] = result;
}
`;
