import { Matrix4 } from '../../../../../math/Matrix4';
import { splitDouble } from '../../../../../math/DoublePrecision';
import { UUID } from '../../../../../util/Global';
import { bindCtx, Context3D } from '../../Context3D';
import { MatrixGPUBuffer } from '../buffer/MatrixGPUBuffer';
/**
 * @author sirxu
 * @internal
 * @group GFX
 */
export class MatrixBindGroup {
    public uuid: string;
    public index: number;
    public usage: number;
    public groupBufferSize: number;
    public matrixBufferDst: MatrixGPUBuffer;
    constructor(ctx: Context3D) {
        this.uuid = UUID();
        this.groupBufferSize = 0;
        this.usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
        this.cacheWorldMatrix(ctx);
    }


    private cacheWorldMatrix(ctx: Context3D) {
        this.groupBufferSize = Matrix4.maxCount * Matrix4.blockBytes;
        this.matrixBufferDst = new MatrixGPUBuffer(this.groupBufferSize / 4 + Matrix4.maxCount * 8);
        bindCtx(this.matrixBufferDst, ctx);
        this.matrixBufferDst.visibility = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE
        this.matrixBufferDst.buffer.label = this.groupBufferSize.toString();
    }

    writeBuffer(len: number) {
        const ctx = this.matrixBufferDst._boundCtx;
        const setting = ctx?.engine?.setting;
        if (setting?.doublePrecision) {
            Matrix4.dynamicMatrixBytes_32bit.set(Matrix4.dynamicMatrixBytes);
            this.matrixBufferDst.mapAsyncWrite(Matrix4.dynamicMatrixBytes_32bit, len);
        } else {
            this.matrixBufferDst.mapAsyncWrite(Matrix4.dynamicMatrixBytes, len);
        }

        if (setting?.useRTE) {
            if (ctx) {
                MatrixBindGroup._populateWorldPositionHL(setting.RTEScale);
                ctx.device.queue.writeBuffer(this.matrixBufferDst.buffer, Matrix4.maxCount * (16 * 4), Matrix4.matrixWorldPositionHLDatas as unknown as BufferSource);
            }
        }
    }

    /**
     * CPU-side RTE split-double population. Derives each active
     * matrix's world translation (cols 12/13/14) split into
     * high/low floats via {@link splitDouble} and writes them into
     * {@link Matrix4.matrixWorldPositionHLDatas} — the same layout
     * the WGSL `GetDoubleWorldPosition(index)` reads.
     *
     * **Why this lives in JS instead of the wasm:** the wasm-exported
     * `_updateAllMatrixContinueTransform(..., RTEScale)` takes an
     * RTE-scale arg but does not populate the HL buffer — empirically
     * verified 2026-04-24 by snapshotting `matrixWorldPositionHLBuffer`
     * after the wasm call (all zeros with `useRTE=true`, double-checked
     * against a fresh `Float32Array(HEAPF32, ptr, len)` view to rule
     * out emscripten heap-grow detach). The WASM source is not in the
     * repo (only compiled `.wasm`), so fixing WASM is out of scope;
     * this JS fallback writes correct HL data and takes the RTE code
     * path off the regression list.
     *
     * Cost: `useCount * (3 splits × ~5 fp ops) = ~15 * useCount`
     * fp ops per frame. At 500 objects that is ~7500 fp ops, dwarfed
     * by even a single WebGPU draw call.
     */
    private static _populateWorldPositionHL(rteScale: number): void {
        const matrices = Matrix4.dynamicMatrixBytes;
        const hl = Matrix4.matrixWorldPositionHLDatas;
        if (!matrices || !hl) return;

        const useCount = Matrix4.useCount;
        const stride = 16; // floats per matrix
        // HL layout per matrix: 8 floats [hx, hy, hz, hw, lx, ly, lz, lw].
        const hlStride = 8;
        for (let i = 0; i < useCount; i++) {
            const mOff = i * stride;
            const tx = matrices[mOff + 12];
            const ty = matrices[mOff + 13];
            const tz = matrices[mOff + 14];
            const hlOff = i * hlStride;
            const [hx, lx] = splitDouble(tx, rteScale);
            const [hy, ly] = splitDouble(ty, rteScale);
            const [hz, lz] = splitDouble(tz, rteScale);
            hl[hlOff + 0] = hx; hl[hlOff + 1] = hy; hl[hlOff + 2] = hz; hl[hlOff + 3] = 1;
            hl[hlOff + 4] = lx; hl[hlOff + 5] = ly; hl[hlOff + 6] = lz; hl[hlOff + 7] = 0;
        }
    }

}
