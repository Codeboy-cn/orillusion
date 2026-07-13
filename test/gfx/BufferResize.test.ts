import { test, expect, end, delay } from '../util'
import { ComputeShader, Engine3D, StorageGPUBuffer } from '@orillusion/core'

// Regression tests for audit finding W4: resizeBuffer destroyed the
// in-flight GPUBuffer synchronously and never told bind-group holders,
// so the next submit failed with "destroyed buffer used in a submit".

const CS = /* wgsl */ `
    @group(0) @binding(0) var<storage, read_write> dataBuf : array<f32>;
    @compute @workgroup_size(1)
    fn CsMain(@builtin(global_invocation_id) id : vec3<u32>) {
        dataBuf[id.x] = dataBuf[id.x] + 1.0;
    }
`

await test('dispatch, resize, dispatch: no destroyed-buffer error, correct readback [audit W4]', async () => {
    const engine = await Engine3D.init()
    const ctx = engine.context3D

    const uncaptured: string[] = []
    ctx.device.addEventListener('uncapturederror', (e: any) => { uncaptured.push(String(e.error?.message ?? e)) })

    const buf = new StorageGPUBuffer(4, GPUBufferUsage.COPY_SRC)
    buf.setFloat32Array('data', new Float32Array([1, 2, 3, 4]))
    buf.apply(ctx)

    const cs = new ComputeShader(CS)
    cs.setStorageBuffer('dataBuf', buf)
    cs.workerSizeX = 4

    const gpu = ctx.gpuContext
    let cmd = gpu.beginCommandEncoder()
    gpu.computeCommand(cmd, [cs])
    gpu.endCommandEncoder(cmd)

    // Grow the buffer. The old GPUBuffer may still be referenced by the
    // submitted work above — it must be retired via onSubmittedWorkDone,
    // and the compute shader's bind group must be rebuilt lazily.
    buf.resizeBuffer(8)
    buf.setFloat32Array('data', new Float32Array([10, 20, 30, 40, 50, 60, 70, 80]))
    buf.apply(ctx)

    cs.workerSizeX = 8
    cmd = gpu.beginCommandEncoder()
    gpu.computeCommand(cmd, [cs])
    gpu.endCommandEncoder(cmd)

    const data = await buf.readBuffer(true)
    expect(data[0]).toEqual(11)
    expect(data[7]).toEqual(81)

    await delay(300)
    expect(uncaptured.length).toEqual(0)
})

await test('same-frame worst case: encode, resize, encode, submit — no errors [audit W4]', async () => {
    const engine = await Engine3D.init()
    const ctx = engine.context3D

    const uncaptured: string[] = []
    ctx.device.addEventListener('uncapturederror', (e: any) => { uncaptured.push(String(e.error?.message ?? e)) })

    const buf = new StorageGPUBuffer(4, GPUBufferUsage.COPY_SRC)
    buf.setFloat32Array('data', new Float32Array([1, 1, 1, 1]))
    buf.apply(ctx)

    const cs = new ComputeShader(CS)
    cs.setStorageBuffer('dataBuf', buf)
    cs.workerSizeX = 4

    // Everything below is synchronous: the first pass encodes against the
    // old buffer, the resize retires it (delayed destroy), the second pass
    // rebuilds the bind group against the new buffer, and both encoders
    // submit before any microtask can run the delayed destroy.
    const gpu = ctx.gpuContext
    let cmd = gpu.beginCommandEncoder()
    gpu.computeCommand(cmd, [cs])
    gpu.endCommandEncoder(cmd)

    buf.resizeBuffer(4)
    buf.setFloat32Array('data', new Float32Array([5, 5, 5, 5]))
    buf.apply(ctx)

    cmd = gpu.beginCommandEncoder()
    gpu.computeCommand(cmd, [cs])
    gpu.endCommandEncoder(cmd)

    const data = await buf.readBuffer(true)
    expect(data[0]).toEqual(6)

    await delay(300)
    expect(uncaptured.length).toEqual(0)
})

setTimeout(end, 500)
