/**
 * Per-object motion-delta pass — runs before MotionVector_cs.
 *
 * For every allocated world matrix, computes
 *   delta[i] = prevWorld[i] * affineInverse(currWorld[i])
 * — the transform that carries a CURRENT world-space point of object i
 * back to where that point was the PREVIOUS frame. Static objects yield
 * identity, so the per-pixel motion-vector pass can apply the delta
 * unconditionally and still be exact for camera-only motion.
 *
 * The pass also rolls the history in the same dispatch: after the delta
 * is computed, prevWorld[i] is overwritten with currWorld[i], which
 * removes the need for a separate 32MB buffer-to-buffer copy (and for
 * COPY_SRC usage on the shared model-matrix buffer).
 *
 * firstFrame (or a capacity regrow) forces identity deltas — the prev
 * buffer content is undefined until it has been seeded once.
 *
 * Skinned / morphed vertices still move within their object's local
 * space; those need a vertex-stage prev-position path and are out of
 * scope here (their delta only covers the node transform).
 *
 * @internal
 */
export let MotionVectorDelta_cs: string = /*wgsl*/`
    struct DeltaData {
        count: f32,
        firstFrame: f32,
        slot0: f32,
        slot1: f32,
    };

    struct MatrixArray {
        matrix: array<mat4x4<f32>>,
    };

    @group(0) @binding(0) var<uniform> deltaData: DeltaData;
    @group(0) @binding(1) var<storage, read> models: MatrixArray;
    @group(0) @binding(2) var<storage, read_write> prevModels: MatrixArray;
    @group(0) @binding(3) var<storage, read_write> deltaOut: MatrixArray;

    const IDENTITY = mat4x4<f32>(
        vec4<f32>(1.0, 0.0, 0.0, 0.0),
        vec4<f32>(0.0, 1.0, 0.0, 0.0),
        vec4<f32>(0.0, 0.0, 1.0, 0.0),
        vec4<f32>(0.0, 0.0, 0.0, 1.0));

    // Inverse of an affine transform (rotation/scale/shear + translation,
    // bottom row 0 0 0 1) via the adjugate of the 3x3 block — far cheaper
    // than a general 4x4 inverse and exact for world matrices.
    fn affineInverse(m: mat4x4<f32>) -> mat4x4<f32> {
        let a = m[0].xyz;
        let b = m[1].xyz;
        let c = m[2].xyz;
        let t = m[3].xyz;
        let r0 = cross(b, c);
        let r1 = cross(c, a);
        let r2 = cross(a, b);
        let det = dot(a, r0);
        // Degenerate (zero-scale) matrix: no meaningful inverse; treat
        // the object as static rather than emitting NaNs.
        if (abs(det) < 1.0e-12) { return IDENTITY; }
        let invDet = 1.0 / det;
        // Rows of R^-1 are r0, r1, r2 scaled by invDet; store transposed
        // into column-major mat3 columns.
        let ic0 = vec3<f32>(r0.x, r1.x, r2.x) * invDet;
        let ic1 = vec3<f32>(r0.y, r1.y, r2.y) * invDet;
        let ic2 = vec3<f32>(r0.z, r1.z, r2.z) * invDet;
        // invT = -(R^-1 * t)
        let invT = -(ic0 * t.x + ic1 * t.y + ic2 * t.z);
        return mat4x4<f32>(
            vec4<f32>(ic0, 0.0),
            vec4<f32>(ic1, 0.0),
            vec4<f32>(ic2, 0.0),
            vec4<f32>(invT, 1.0));
    }

    @compute @workgroup_size(64, 1, 1)
    fn CsMain(@builtin(global_invocation_id) gid: vec3<u32>) {
        let i = gid.x;
        if (i >= u32(deltaData.count)) { return; }
        let curr = models.matrix[i];
        if (deltaData.firstFrame > 0.5) {
            deltaOut.matrix[i] = IDENTITY;
        } else {
            let prev = prevModels.matrix[i];
            deltaOut.matrix[i] = prev * affineInverse(curr);
        }
        prevModels.matrix[i] = curr;
    }
`;
