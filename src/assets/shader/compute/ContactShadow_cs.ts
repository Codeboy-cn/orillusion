/**
 * Contact Shadows — screen-space ray-march along the dominant
 * directional light. Cheap, ~16 steps; designed to add the
 * fine-grained "contact darkness" that CSM can't capture
 * (object-on-floor, finger-on-table). Reads scene depth + normal from
 * the GBuffer, samples the first directional light from the lightBuffer
 * for direction, and modulates the in-color buffer by the resulting
 * shadow factor.
 *
 * MVP path: applied as a post-pass to the lit scene color (multiplies
 * the contact factor into RGB). Future upgrade: feed into PBR shader's
 * directShadowVisibility[0] via a separate R8 RT.
 *
 * @internal
 */
export let ContactShadow_cs: string = /*wgsl*/`
    #include "GlobalUniform"
    #include "GBufferStand"
    #include "LightData"

    const PI: f32 = 3.1415926;

    struct ContactShadowSettings {
        maxStepCount: f32,
        maxDistance: f32,
        thickness: f32,
        bias: f32,
        intensity: f32,
        _pad0: f32,
        _pad1: f32,
        _pad2: f32,
    };

    @group(0) @binding(2) var<uniform> csSettings: ContactShadowSettings;
    @group(0) @binding(3) var<storage, read> lightBuffer: array<LightData>;
    @group(0) @binding(4) var inTex: texture_2d<f32>;
    @group(0) @binding(5) var outTex: texture_storage_2d<rgba16float, write>;

    var<private> texSize: vec2<u32>;
    var<private> fragCoord: vec2<i32>;
    var<private> fragUV: vec2<f32>;
    var<private> gBuffer: GBuffer;

    fn findFirstDirLight() -> i32 {
        // Scan the shadowLights packed indices for the first valid entry.
        // 8 matches the ShadowCommon dirCount const (avoid the include
        // since it pulls shadowMap bindings we don't need here).
        for (var i: i32 = 0; i < 8; i = i + 1) {
            let ldx = globalUniform.shadowLights[u32(i) / 4u][u32(i) % 4u];
            if (ldx >= 0.0) { return i32(ldx); }
        }
        return -1;
    }

    @compute @workgroup_size(8, 8, 1)
    fn CsMain(@builtin(global_invocation_id) gid: vec3<u32>) {
        fragCoord = vec2<i32>(gid.xy);
        texSize = textureDimensions(inTex).xy;
        if (fragCoord.x >= i32(texSize.x) || fragCoord.y >= i32(texSize.y)) { return; }
        fragUV = vec2<f32>(fragCoord) / vec2<f32>(texSize - 1u);

        let oc = textureLoad(inTex, fragCoord, 0);
        gBuffer = getGBuffer(fragCoord);
        let visible = getRoughnessFromGBuffer(gBuffer);
        if (visible <= 0.0) {
            // sky pixel — no contact shadow
            textureStore(outTex, fragCoord, oc);
            return;
        }

        let lightIdx = findFirstDirLight();
        if (lightIdx < 0) {
            textureStore(outTex, fragCoord, oc);
            return;
        }
        let light = lightBuffer[u32(lightIdx)];

        // Reconstruct world position + view-space ray origin
        useNormalMatrixInv();
        let worldPos = getWorldPositionFromGBuffer(gBuffer, fragUV);
        let normal = getWorldNormalFromGBuffer(gBuffer);

        // Light direction points FROM light → surface, so we ray-march
        // TOWARD the light by negating it.
        let toLight = normalize(-light.direction);
        let NoL = dot(normal, toLight);
        if (NoL <= 0.05) {
            // Back-facing surface: no contact shadow needed (fully shadowed
            // by self-occlusion which the lighting already handles).
            textureStore(outTex, fragCoord, oc);
            return;
        }

        // March in screen space. Build a screen-space step direction by
        // projecting the world-space ray toLight into clip then ndc then uv.
        let originVS = (globalUniform.viewMat * vec4<f32>(worldPos + normal * csSettings.bias, 1.0)).xyz;
        let endVS = originVS + (globalUniform.viewMat * vec4<f32>(toLight, 0.0)).xyz * csSettings.maxDistance;

        let originClip = globalUniform.projMat * vec4<f32>(originVS, 1.0);
        let endClip = globalUniform.projMat * vec4<f32>(endVS, 1.0);
        let originNDC = originClip.xyz / originClip.w;
        let endNDC = endClip.xyz / endClip.w;
        let originUV = originNDC.xy * vec2<f32>(0.5, -0.5) + 0.5;
        let endUV = endNDC.xy * vec2<f32>(0.5, -0.5) + 0.5;

        let stepCount = i32(clamp(csSettings.maxStepCount, 4.0, 64.0));
        let stepUV = (endUV - originUV) / f32(stepCount);
        let stepZ = (endNDC.z - originNDC.z) / f32(stepCount);

        var occluded: f32 = 0.0;
        for (var s: i32 = 1; s <= stepCount; s = s + 1) {
            let sampleUV = originUV + stepUV * f32(s);
            if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) { break; }
            let sampleNDCZ = originNDC.z + stepZ * f32(s);

            let sampleCoord = vec2<i32>(sampleUV * vec2<f32>(texSize));
            let sampleGB = getGBuffer(sampleCoord);
            let sampleSceneZ = sampleGB.x; // gBuffer.x is depth

            let zDiff = sampleNDCZ - sampleSceneZ;
            // Ray is "behind" the scene surface within thickness window:
            // counts as occluded.
            if (zDiff > 0.0 && zDiff < csSettings.thickness) {
                // Soft falloff with step index — earlier hits produce
                // darker contact, distant hits fade out.
                let falloff = 1.0 - f32(s) / f32(stepCount);
                occluded = max(occluded, falloff);
            }
        }

        let shadowFactor = 1.0 - occluded * csSettings.intensity;
        textureStore(outTex, fragCoord, vec4<f32>(oc.rgb * shadowFactor, oc.a));
    }
`;
