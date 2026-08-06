/**
 * Screen-space motion vector compute pass.
 *
 * Per pixel: reconstruct the world position from gBuffer depth, carry it
 * back to its previous-frame world position with the per-object motion
 * delta (see MotionVectorDelta_cs — identity for static objects), then
 * project with the previous frame's viewProj.
 *
 * Output (rgba16float):
 *   rg = currUv - prevUv   (screen-space motion, uv units)
 *   b  = prevClip.w        (the surface's expected previous-frame view
 *                           depth — temporal passes compare their stored
 *                           history depth against this to detect
 *                           disocclusion, correctly even for movers)
 *   a  = 0
 *
 * Covers camera motion and rigid object motion. Skinned / morphed
 * vertex animation still needs a vertex-stage prev-position path.
 *
 * @internal
 */
export let MotionVector_cs: string = /*wgsl*/`
    #include "GlobalUniform"
    #include "GBufferStand"

    const PI: f32 = 3.1415926;

    struct MVData {
        prevViewProj: mat4x4<f32>,
    };

    struct MatrixArray {
        matrix: array<mat4x4<f32>>,
    };

    @group(0) @binding(2) var<uniform> mvData: MVData;
    @group(0) @binding(3) var inTex: texture_2d<f32>;
    @group(0) @binding(4) var outTex: texture_storage_2d<rgba16float, write>;
    @group(0) @binding(5) var<storage, read> deltaModels: MatrixArray;

    var<private> texSize: vec2<u32>;
    var<private> fragCoord: vec2<i32>;
    var<private> fragUV: vec2<f32>;
    var<private> gBuffer: GBuffer;

    @compute @workgroup_size(8, 8, 1)
    fn CsMain(@builtin(global_invocation_id) gid: vec3<u32>) {
        fragCoord = vec2<i32>(gid.xy);
        texSize = textureDimensions(inTex).xy;
        if (fragCoord.x >= i32(texSize.x) || fragCoord.y >= i32(texSize.y)) { return; }
        fragUV = vec2<f32>(fragCoord) / vec2<f32>(texSize - 1u);

        useNormalMatrixInv();
        gBuffer = getGBuffer(fragCoord);
        let visible = getRoughnessFromGBuffer(gBuffer);
        if (visible <= 0.0) {
            // sky / unwritten pixel: zero motion vector, no depth key
            textureStore(outTex, fragCoord, vec4<f32>(0.0, 0.0, 0.0, 0.0));
            return;
        }

        // Reconstruct world position from current-frame depth, then carry
        // it to where this surface point sat the previous frame via the
        // owning object's motion delta (identity for static objects, so
        // this is exact for camera-only motion too).
        let worldPos = getWorldPositionFromGBuffer(gBuffer, fragUV);
        let modelIndex = getIDFromGBuffer_i32(gBuffer);
        let prevWorld = deltaModels.matrix[u32(modelIndex)] * vec4<f32>(worldPos, 1.0);

        // Project with prev frame's viewProj to get prev-frame UV.
        let prevClip = mvData.prevViewProj * prevWorld;
        if (prevClip.w <= 0.0) {
            textureStore(outTex, fragCoord, vec4<f32>(0.0, 0.0, 0.0, 0.0));
            return;
        }
        let prevNdc = prevClip.xyz / prevClip.w;
        let prevUv = vec2<f32>(prevNdc.x * 0.5 + 0.5, -prevNdc.y * 0.5 + 0.5);

        let motion = fragUV - prevUv;
        textureStore(outTex, fragCoord, vec4<f32>(motion.x, motion.y, prevClip.w, 0.0));
    }
`;
