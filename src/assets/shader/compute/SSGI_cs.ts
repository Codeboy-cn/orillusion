/**
 * Screen-Space Global Illumination — visibility-bitmask march pass.
 *
 * Per pixel, per hemisphere slice: march the screen left and right of
 * the receiver, quantize each sample's front/back horizon interval into
 * a 32-bit occupancy bitfield, and gather radiance only from the newly
 * revealed sectors. The bit counting makes occlusion order-independent
 * (no horizon monotonicity assumption) and gives ambient occlusion for
 * free as the final popcount of the slice bitfield.
 *
 * Coordinate conventions:
 *  - Orillusion view space is left-handed, camera looking down +z.
 *    The slice/horizon math only uses dot/cross expressions that 
 *    are invariant under that reflection, so
 *    the port keeps engine view space and replaces every -viewPos.z
 *    depth read with abs(viewPos.z).
 *  - The march direction is expressed in a view-space-aligned uv space
 *    (both axes flipped from texture coords: the engine view space is
 *    mirrored in x relative to the screen and y-up), converted back to
 *    texture coords only when fetching.
 *  - The engine GBuffer stores WORLD-space octahedral normals
 *    (Common_frag packNHMDGBuffer); they are moved to view space here
 *    with getViewNormal.
 *
 * A single frame is a high-variance estimate; the companion resolve
 * pass (SSGITemporal_cs) integrates the estimates over time. The
 * temporalDirection / temporalOffset uniforms rotate the sampling
 * pattern per frame (Activision GTAO tables, fed by SSGIPost).
 *
 * Output: giTex rgb = raw single-frame radiance gather, a = visibility
 * (1 - AO, aoIntensity curve applied); keyTex r = receiver view depth
 * (0 marks sky / unwritten texels).
 *
 * @internal
 */
export let SSGI_cs: string = /*wgsl*/`
    #include "GlobalUniform"
    #include "GBufferStand"

    const PI: f32 = 3.1415926;
    const HALF_PI: f32 = 1.5707963;
    const MAX_RAY: u32 = 32u;

    struct SSGISettings {
        radius: f32,
        sliceCount: f32,
        stepCount: f32,
        expFactor: f32,

        thickness: f32,
        backfaceLighting: f32,
        aoIntensity: f32,
        giIntensity: f32,

        temporalDirection: f32,
        temporalOffset: f32,
        halfProjScale: f32,
        useScreenSpaceSampling: f32,

        useLinearThickness: f32,
        frameIndex: f32,
        slot0: f32,
        slot1: f32,
    };

    @group(0) @binding(2) var<uniform> ssgiSettings: SSGISettings;
    @group(0) @binding(3) var inTex: texture_2d<f32>;
    @group(0) @binding(4) var giTex: texture_storage_2d<rgba16float, write>;
    @group(0) @binding(5) var keyTex: texture_storage_2d<r32float, write>;

    var<private> texSize: vec2<u32>;
    var<private> globalOccludedBitfield: u32;

    fn luminanceOf(c: vec3<f32>) -> f32 {
        return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
    }

    // Interleaved gradient noise — stable per pixel, uncorrelated between
    // neighbours; rotates the slice set per pixel.
    fn interleavedGradientNoise(coord: vec2<f32>) -> f32 {
        return fract(52.9829189 * fract(0.06711056 * coord.x + 0.00583715 * coord.y));
    }

    // From the Activision GTAO paper: 2x2 pixel-block phase for the
    // initial ray step so neighbouring pixels start on staggered offsets.
    fn spatialOffsets(coord: vec2<i32>) -> f32 {
        return 0.25 * f32((coord.y - coord.x) & 3);
    }

    fn rand01(uv: vec2<f32>) -> f32 {
        return fract(sin(dot(uv, vec2<f32>(12.9898, 78.233))) * 43758.5453);
    }

    // Fast acos approximation from the Activision GTAO paper, applied to
    // both lanes of the front/back horizon pair.
    fn gtaoFastAcos(v: vec2<f32>) -> vec2<f32> {
        var outVal = abs(v) * (-0.156583) + HALF_PI;
        outVal = outVal * sqrt(1.0 - abs(v));
        let x = select(PI - outVal.x, outVal.x, v.x >= 0.0);
        let y = select(PI - outVal.y, outVal.y, v.y >= 0.0);
        return vec2<f32>(x, y);
    }

    // View-space position of a GBuffer texel. Goes through the world
    // reconstruction helper so the log-depth path stays correct, then
    // back to view space with the (rigid) view matrix.
    fn viewPosOfTexel(gBuffer: GBuffer, fragUV: vec2<f32>) -> vec3<f32> {
        let worldPos = getWorldPositionFromGBuffer(gBuffer, fragUV);
        return (globalUniform.viewMat * vec4<f32>(worldPos, 1.0)).xyz;
    }

    // One horizon walk along +sliceDir (directionIsRight) or -sliceDir.
    // Marks each sample's front-to-backface angular interval in the
    // slice bitfield and gathers radiance from sectors revealed for the
    // first time.
    fn horizonSampling(
        directionIsRight: bool,
        stepRadius: f32,
        radiusVS: f32,
        viewPosition: vec3<f32>,
        slideDirTexelSize: vec2<f32>,
        initialRayStep: f32,
        ndcUV: vec2<f32>,
        viewDir: vec3<f32>,
        viewNormal: vec3<f32>,
        nAngle: f32) -> vec3<f32> {

        let stepCount = clamp(ssgiSettings.stepCount, 1.0, 32.0);
        let expFactor = clamp(ssgiSettings.expFactor, 1.0, 3.0);
        let thickness = ssgiSettings.thickness;
        let backfaceLighting = ssgiSettings.backfaceLighting;

        // ndc uv space is y-up and axis-aligned with view space, so both
        // components share the walk sign.
        let uvDirection = select(vec2<f32>(-1.0), vec2<f32>(1.0), directionIsRight);
        let samplingDirection = select(-1.0, 1.0, directionIsRight);

        var color = vec3<f32>(0.0);

        for (var s: f32 = 0.0; s < stepCount; s = s + 1.0) {
            // Exponential step distribution: dense taps near the
            // receiver, sparse far away.
            let offsetPix = pow(abs(stepRadius * (s + initialRayStep) / radiusVS), expFactor) * radiusVS;
            let uvOffset = slideDirTexelSize * max(offsetPix, s + 1.0);
            let sampleNdcUV = ndcUV + uvOffset * uvDirection;
            if (sampleNdcUV.x <= 0.0 || sampleNdcUV.y <= 0.0 || sampleNdcUV.x >= 1.0 || sampleNdcUV.y >= 1.0) {
                break;
            }

            // Back to screen texture space for the fetch (undo both
            // view-space-alignment flips).
            let sampleFragUV = vec2<f32>(1.0 - sampleNdcUV.x, 1.0 - sampleNdcUV.y);
            let sampleCoord = vec2<i32>(sampleFragUV * vec2<f32>(texSize - 1u) + 0.5);

            let sGBuffer = getGBuffer(sampleCoord);
            // roughness == 0 marks sky / unwritten texels (GTAO_cs
            // convention); their depth channel is meaningless.
            if (getRoughnessFromGBuffer(sGBuffer) <= 0.0) {
                continue;
            }

            let sampleViewPosition = viewPosOfTexel(sGBuffer, sampleFragUV);
            let toSample = sampleViewPosition - viewPosition;
            if (length(toSample) < 1.0e-4) {
                continue;
            }
            let pixelToSample = normalize(toSample);

            // Thickness heuristic: a virtual backface pushed away from
            // the camera by the thickness value bounds each sample's
            // occupied interval.
            let linearThicknessMultiplier = select(
                1.0,
                clamp(abs(sampleViewPosition.z) / globalUniform.far, 0.0, 1.0) * 100.0,
                ssgiSettings.useLinearThickness > 0.5);
            let pixelToSampleBackface = normalize(sampleViewPosition - linearThicknessMultiplier * viewDir * thickness - viewPosition);

            var frontBackHorizon = vec2<f32>(dot(pixelToSample, viewDir), dot(pixelToSampleBackface, viewDir));
            frontBackHorizon = gtaoFastAcos(clamp(frontBackHorizon, vec2<f32>(-1.0), vec2<f32>(1.0)));
            frontBackHorizon = clamp((samplingDirection * (-frontBackHorizon) - (nAngle - HALF_PI)) / PI, vec2<f32>(0.0), vec2<f32>(1.0));
            // Front/back swap depending on the walk direction.
            frontBackHorizon = select(frontBackHorizon.xy, frontBackHorizon.yx, directionIsRight);

            let minHorizon = frontBackHorizon.x;
            let maxHorizon = frontBackHorizon.y;
            let startHorizonInt = u32(minHorizon * f32(MAX_RAY));
            let angleHorizonInt = u32(ceil((maxHorizon - minHorizon) * f32(MAX_RAY)));

            var currentOccludedBitfield = 0u;
            if (angleHorizonInt > 0u && startHorizonInt < MAX_RAY) {
                // Shift stays in [0,31]: angleHorizonInt is clamped to
                // MAX_RAY and the zero case is excluded above (WGSL
                // masks shift amounts modulo 32, so a raw 32 would wrap).
                let angleBits = 0xFFFFFFFFu >> (MAX_RAY - min(angleHorizonInt, MAX_RAY));
                currentOccludedBitfield = (angleBits << startHorizonInt) & ~globalOccludedBitfield;
                globalOccludedBitfield = globalOccludedBitfield | currentOccludedBitfield;
            }
            let numOccludedZones = countOneBits(currentOccludedBitfield);

            if (numOccludedZones > 0u) {
                // Sectors revealed for the first time: the sample is
                // visible from the receiver, gather its radiance.
                let lightColor = textureLoad(inTex, sampleCoord, 0).rgb;
                if (luminanceOf(lightColor) > 0.001) {
                    let normalDotLightDirection = clamp(dot(viewNormal, pixelToSample), 0.0, 1.0);
                    if (normalDotLightDirection > 0.001) {
                        let lightNormalVS = getViewNormal(getWorldNormalFromGBuffer(sGBuffer));
                        // Emitter-side cosine; optionally let backfaces
                        // leak a fraction of their light through.
                        var lightNormalDotLightDirection = dot(lightNormalVS, -pixelToSample);
                        let backfaceTerm = select(
                            abs(lightNormalDotLightDirection),
                            abs(lightNormalDotLightDirection) * backfaceLighting,
                            lightNormalDotLightDirection < 0.0);
                        lightNormalDotLightDirection = select(
                            clamp(lightNormalDotLightDirection, 0.0, 1.0),
                            backfaceTerm,
                            backfaceLighting > 0.0 && dot(lightNormalVS, viewDir) > 0.0);

                        color = color + f32(numOccludedZones) / f32(MAX_RAY) * lightColor
                            * normalDotLightDirection * lightNormalDotLightDirection;
                    }
                }
            }
        }

        return color;
    }

    @compute @workgroup_size(8, 8, 1)
    fn CsMain(@builtin(global_invocation_id) gid: vec3<u32>) {
        let fragCoord = vec2<i32>(gid.xy);
        texSize = textureDimensions(inTex).xy;
        if (fragCoord.x >= i32(texSize.x) || fragCoord.y >= i32(texSize.y)) { return; }
        let fragUV = vec2<f32>(fragCoord) / vec2<f32>(texSize - 1u);
        // View-space-aligned uv. Orillusion's LH view space is MIRRORED
        // in x relative to the screen (camera looks down +z, +x maps to
        // screen LEFT — see the 1-x flip in getViewPositionFromGBuffer),
        // and texture y is down while view y is up, so both axes flip.
        let ndcUV = vec2<f32>(1.0 - fragUV.x, 1.0 - fragUV.y);

        let gBuffer = getGBuffer(fragCoord);
        if (getRoughnessFromGBuffer(gBuffer) <= 0.0) {
            // Sky: full visibility, no gather, zero depth key.
            textureStore(giTex, fragCoord, vec4<f32>(0.0, 0.0, 0.0, 1.0));
            textureStore(keyTex, fragCoord, vec4<f32>(0.0));
            return;
        }

        let viewPosition = viewPosOfTexel(gBuffer, fragUV);
        let viewZ = abs(viewPosition.z);
        let viewNormal = getViewNormal(getWorldNormalFromGBuffer(gBuffer));
        let viewDir = normalize(-viewPosition);

        let sliceCountF = clamp(ssgiSettings.sliceCount, 1.0, 4.0);
        let sliceCount = u32(sliceCountF);
        let stepCount = clamp(ssgiSettings.stepCount, 1.0, 32.0);

        // Per-pixel / per-frame decorrelation (Activision GTAO tables
        // feed temporalDirection and temporalOffset from the CPU side).
        let noiseOffset = spatialOffsets(fragCoord);
        let noiseDirection = interleavedGradientNoise(vec2<f32>(fragCoord));
        let initialRayStep = fract(noiseOffset + ssgiSettings.temporalOffset)
            + rand01(fragUV + vec2<f32>(ssgiSettings.temporalDirection * 0.02));

        var stepRadius = 0.0;
        if (ssgiSettings.useScreenSpaceSampling > 0.5) {
            // Screen-proportional stepping: more detail up close.
            stepRadius = ssgiSettings.radius * (f32(texSize.x) / 2.0) / 16.0;
        } else {
            // World radius projected to pixels at the receiver depth.
            stepRadius = max(ssgiSettings.radius * ssgiSettings.halfProjScale / viewZ, stepCount);
        }
        stepRadius = stepRadius / (stepCount + 1.0);
        let radiusVS = max(1.0, stepCount - 1.0) * stepRadius;

        var ao = 0.0;
        var color = vec3<f32>(0.0);

        for (var i: u32 = 0u; i < sliceCount; i = i + 1u) {
            let rotationAngle = (f32(i) + noiseDirection + ssgiSettings.temporalDirection) * (PI / sliceCountF);
            let sliceDir = vec3<f32>(cos(rotationAngle), sin(rotationAngle), 0.0);
            let slideDirTexelSize = sliceDir.xy * (1.0 / vec2<f32>(texSize));

            let planeNormal = normalize(cross(sliceDir, viewDir));
            let tangent = cross(viewDir, planeNormal);
            let projectedNormal = viewNormal - planeNormal * dot(viewNormal, planeNormal);
            let projLen = length(projectedNormal);
            if (projLen < 1.0e-6) {
                continue;
            }
            let cosN = clamp(dot(projectedNormal / projLen, viewDir), -1.0, 1.0);
            let nAngle = -sign(dot(projectedNormal, tangent)) * acos(cosN);

            globalOccludedBitfield = 0u;
            color = color + horizonSampling(true, stepRadius, radiusVS, viewPosition,
                slideDirTexelSize, initialRayStep, ndcUV, viewDir, viewNormal, nAngle);
            color = color + horizonSampling(false, stepRadius, radiusVS, viewPosition,
                slideDirTexelSize, initialRayStep, ndcUV, viewDir, viewNormal, nAngle);
            ao = ao + f32(countOneBits(globalOccludedBitfield)) / f32(MAX_RAY);
        }

        // Visibility with the user AO curve; 0 slices contributing keeps 1.
        var aoOut = clamp(ao / sliceCountF, 0.0, 1.0);
        aoOut = clamp(pow(1.0 - aoOut, ssgiSettings.aoIntensity), 0.0, 1.0);

        var colorOut = color / sliceCountF * ssgiSettings.giIntensity;

        // Clamp fireflies against the temporal feedback: scale down when
        // luminance exceeds a fixed HDR ceiling.
        let maxLuminance = 7.0;
        let currentLuminance = luminanceOf(colorOut);
        if (currentLuminance > maxLuminance) {
            colorOut = colorOut * (maxLuminance / currentLuminance);
        }

        textureStore(giTex, fragCoord, vec4<f32>(colorOut, aoOut));
        textureStore(keyTex, fragCoord, vec4<f32>(viewZ, 0.0, 0.0, 0.0));
    }
`;
