import { test, expect, end } from '../util'
import { WasmMatrix, MathUtil, Matrix4, Quaternion, Ray, Vector3, Orientation3D, matrixRotateY } from '@orillusion/core';

// Regression tests for audit findings M1 / M2 / M8 (batch 1).

await test('decompose EULER_ANGLES survives Y-180 rotation [audit M1]', async () => {
    await WasmMatrix.init(Matrix4.allocCount);

    // Ry(180deg): diag(-1, 1, -1) — hits the m11 > m22 branch that used
    // to write the sqrt pivot into rot.y instead of q.y.
    let mat = new Matrix4();
    mat.identity();
    mat.rawData[0] = -1;
    mat.rawData[10] = -1;

    let prs = mat.decompose(Orientation3D.EULER_ANGLES, [new Vector3(), new Vector3(), new Vector3()]);
    let rot = prs[1];

    // The euler triple may be expressed as (0, ±180, 0) or an equivalent
    // combination, so compare the reconstructed rotation instead of raw
    // angles: it must map +X to -X and +Z to -Z (like Ry(180)).
    let q = new Quaternion();
    q.setFromEuler(rot.x, rot.y, rot.z);
    let rx = q.transformVector(new Vector3(1, 0, 0));
    let rz = q.transformVector(new Vector3(0, 0, 1));
    expect(rx.x).toSubequal(-1, 0.001);
    expect(rx.y).toSubequal(0, 0.001);
    expect(rx.z).toSubequal(0, 0.001);
    expect(rz.x).toSubequal(0, 0.001);
    expect(rz.y).toSubequal(0, 0.001);
    expect(rz.z).toSubequal(-1, 0.001);
})

await test('Ray.getPoint is repeatable and does not mutate the ray [audit M2]', async () => {
    await WasmMatrix.init(Matrix4.allocCount);

    let ray = new Ray(new Vector3(1, 2, 3), new Vector3(0, 0, 1));
    let p1 = ray.getPoint(5);
    let p2 = ray.getPoint(5);

    expect(p1.x).toSubequal(1, 0.0001);
    expect(p1.y).toSubequal(2, 0.0001);
    expect(p1.z).toSubequal(8, 0.0001);
    expect(p2.x).toSubequal(p1.x, 0.0001);
    expect(p2.y).toSubequal(p1.y, 0.0001);
    expect(p2.z).toSubequal(p1.z, 0.0001);

    // The ray itself must be untouched.
    expect(ray.origin.x).toSubequal(1, 0.0001);
    expect(ray.origin.y).toSubequal(2, 0.0001);
    expect(ray.origin.z).toSubequal(3, 0.0001);
    expect(ray.direction.x).toSubequal(0, 0.0001);
    expect(ray.direction.y).toSubequal(0, 0.0001);
    expect(ray.direction.z).toSubequal(1, 0.0001);

    // sqrDistToPoint calls getPoint internally — it must not poison the ray either.
    let d = ray.sqrDistToPoint(new Vector3(1, 2, 10));
    expect(d).toSubequal(0, 0.0001);
    let p3 = ray.getPoint(5);
    expect(p3.z).toSubequal(8, 0.0001);
})

await test('Matrix4.transpose works on helpMatrix and leaves it unpolluted [audit M8]', async () => {
    await WasmMatrix.init(Matrix4.allocCount);

    // 1) transposing a regular matrix must not clobber the shared helpMatrix
    Matrix4.helpMatrix.identity();
    let m = new Matrix4();
    m.rawData.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    m.transpose();
    expect(m.rawData[1]).toEqual(4);
    expect(m.rawData[4]).toEqual(1);
    expect(m.rawData[12]).toEqual(3);
    expect(m.rawData[3]).toEqual(12);
    expect(m.rawData[14]).toEqual(11);
    expect(m.rawData[11]).toEqual(14);
    expect(Matrix4.helpMatrix.rawData[1]).toEqual(0);
    expect(Matrix4.helpMatrix.rawData[0]).toEqual(1);

    // 2) transposing helpMatrix itself must be correct (source and scratch
    //    used to alias, corrupting the result)
    Matrix4.helpMatrix.rawData.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    Matrix4.helpMatrix.transpose();
    expect(Matrix4.helpMatrix.rawData[1]).toEqual(4);
    expect(Matrix4.helpMatrix.rawData[4]).toEqual(1);
    expect(Matrix4.helpMatrix.rawData[8]).toEqual(2);
    expect(Matrix4.helpMatrix.rawData[2]).toEqual(8);
    expect(Matrix4.helpMatrix.rawData[13]).toEqual(7);
    expect(Matrix4.helpMatrix.rawData[7]).toEqual(13);
})

await test('makeMatrix44ByQuaternion does not scale the translation [audit M6]', async () => {
    await WasmMatrix.init(Matrix4.allocCount);
    let mat = new Matrix4();
    mat.makeMatrix44ByQuaternion(new Vector3(1, 2, 3), new Vector3(2, 2, 2), new Quaternion());
    // Translation stays raw (used to come out as (2,4,6)); basis scaled.
    expect(mat.rawData[12]).toSubequal(1, 0.0001);
    expect(mat.rawData[13]).toSubequal(2, 0.0001);
    expect(mat.rawData[14]).toSubequal(3, 0.0001);
    expect(mat.rawData[0]).toSubequal(2, 0.0001);
    expect(mat.rawData[5]).toSubequal(2, 0.0001);
    expect(mat.rawData[10]).toSubequal(2, 0.0001);
})

await test('ortho/orthoZO match the engine-convention orthoOffCenter [audit M7]', async () => {
    await WasmMatrix.init(Matrix4.allocCount);
    let a = new Matrix4(); a.ortho(10, 10, 1, 100);
    let b = new Matrix4(); b.orthoOffCenter(-5, 5, -5, 5, 1, 100);
    for (let i = 0; i < 16; i++) expect(a.rawData[i]).toSubequal(b.rawData[i], 0.0001);

    let c = new Matrix4(); c.orthoZO(-5, 5, -5, 5, 1, 100);
    for (let i = 0; i < 16; i++) expect(c.rawData[i]).toSubequal(b.rawData[i], 0.0001);

    // LH zero-to-one depth: near maps to 0, far maps to 1.
    const depth = (m: Matrix4, z: number) => z * m.rawData[10] + m.rawData[14];
    expect(depth(c, 1)).toSubequal(0, 0.0001);
    expect(depth(c, 100)).toSubequal(1, 0.0001);
})

await test('angle_360 returns oriented degrees; getRandDirXYZ stays in the sphere [audit M9]', async () => {
    await WasmMatrix.init(Matrix4.allocCount);
    // XZ-plane pair: X→Z is one winding, Z→X the other; both in degrees.
    const x = new Vector3(1, 0, 0), z = new Vector3(0, 0, 1);
    const a1 = MathUtil.angle_360(z, x);
    const a2 = MathUtil.angle_360(x, z);
    expect(a1).toSubequal(90, 0.01);
    expect(a2).toSubequal(270, 0.01);

    for (let i = 0; i < 1000; i++) {
        const v = MathUtil.getRandDirXYZ(5);
        expect(Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) <= 5.0001).toEqual(true);
    }
})

await test('matrixRotateY writes a complete Y-rotation matrix [audit M10]', async () => {
    await WasmMatrix.init(Matrix4.allocCount);
    let m = new Matrix4();
    m.rawData.set([9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9]);
    matrixRotateY(Math.PI / 2, m);
    const d = m.rawData;
    expect(d[0]).toSubequal(0, 0.0001);
    expect(d[2]).toSubequal(-1, 0.0001);
    expect(d[4]).toSubequal(0, 0.0001);
    expect(d[5]).toSubequal(1, 0.0001);
    expect(d[8]).toSubequal(1, 0.0001);
    expect(d[10]).toSubequal(0, 0.0001);
    expect(d[12]).toSubequal(0, 0.0001);
    expect(d[15]).toSubequal(1, 0.0001);

    // Static variant used to call the wasm matrix-multiply entry point.
    let m2 = new Matrix4();
    m2.rawData.set([9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9]);
    Matrix4.matrixRotateY(Math.PI / 2, m2);
    for (let i = 0; i < 16; i++) expect(m2.rawData[i]).toSubequal(d[i], 0.0001);
})

setTimeout(end, 500)
