import { test, expect, end, delay } from '../util'
import { WasmMatrix, Color, Engine3D, Matrix4, StorageGPUBuffer, Vector2, Vector3, Vector4 } from '@orillusion/core';

await test('StorageGPUBuffer ', async () => {
    const engine = await Engine3D.init();
    await WasmMatrix.init(Matrix4.allocCount);
    expect(engine.context3D != null).toEqual(true);

    let storageBuffer = new StorageGPUBuffer(2048);
    storageBuffer.setMatrix("setMatrix", new Matrix4().identity());
    storageBuffer.setInt32Array("setInt32Array", new Int32Array(4 * 4));
    storageBuffer.setColor("setColor", new Color(1, 0, 0, 1));
    storageBuffer.setBoolean("setBoolean", true);
    storageBuffer.setInt8("setInt8", 1);
    storageBuffer.setInt16("setInt16", 1);
    storageBuffer.setInt32("setInt32", 1);
    storageBuffer.setInt8("alignment", 0);
    storageBuffer.setFloat32Array("setFloat32Array", new Float32Array(4 * 4));
    storageBuffer.setFloat("setFloat", 0.5);
    storageBuffer.setUint8("setUint8", 128);
    storageBuffer.setUint16("setUint16", 128);
    storageBuffer.setUint32("setUint32", 128);
    storageBuffer.setVector2("setVector2", new Vector2(0.5, 10.0));
    storageBuffer.setVector3("setVector3", new Vector3(1.5, 11.0, 55.0));
    storageBuffer.setVector4("setVector4", new Vector4(2, 5, 8, 9));
    storageBuffer.setArray("setArray", [1, 2, 3, 4, 5, 6]);
    storageBuffer.setColorArray("setColorArray", [
        new Color(1, 0, 0, 1),
        new Color(0, 1, 0, 1),
        new Color(0, 0, 1, 1),
    ]);
})

await test('clean() actually zeroes the CPU-side share buffer [audit W3]', async () => {
    await Engine3D.init();
    let buf = new StorageGPUBuffer(16);
    buf.setFloat32Array('data', new Float32Array([1, 2, 3, 4]));

    let view = new Float32Array(buf.memory.shareDataBuffer);
    let hasNonZero = false;
    for (let i = 0; i < view.length; i++) {
        if (view[i] !== 0) { hasNonZero = true; break; }
    }
    expect(hasNonZero).toEqual(true);

    // clean() used to wrap a Float32Array around undefined (view created
    // before allocation), making it a silent no-op.
    buf.clean();
    view = new Float32Array(buf.memory.shareDataBuffer);
    let allZero = true;
    for (let i = 0; i < view.length; i++) {
        if (view[i] !== 0) { allZero = false; break; }
    }
    expect(allZero).toEqual(true);
})

setTimeout(end, 500)
