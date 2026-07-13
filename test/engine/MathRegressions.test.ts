import { test, expect, end } from '../util'
import { WasmMatrix, Matrix4, Quaternion, Ray, Vector3, Orientation3D } from '@orillusion/core';

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

setTimeout(end, 500)
