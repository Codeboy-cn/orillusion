import { MotionVector_cs } from '../../../../assets/shader/compute/MotionVector_cs';
import { MotionVectorDelta_cs } from '../../../../assets/shader/compute/MotionVectorDelta_cs';
import { ShaderLib } from '../../../../assets/shader/ShaderLib';
import { Matrix4 } from '../../../../math/Matrix4';
import { RenderTexture } from '../../../../textures/RenderTexture';
import { bindCtx, Context3D } from '../../../graphics/webGpu/Context3D';
import { GlobalBindGroup } from '../../../graphics/webGpu/core/bindGroups/GlobalBindGroup';
import { StorageGPUBuffer } from '../../../graphics/webGpu/core/buffer/StorageGPUBuffer';
import { UniformGPUBuffer } from '../../../graphics/webGpu/core/buffer/UniformGPUBuffer';
import { ComputeShader } from '../../../graphics/webGpu/shader/ComputeShader';
import { GPUTextureFormat } from '../../../graphics/webGpu/WebGPUConst';
import { GBufferFrame } from '../../frame/GBufferFrame';
import { RenderGraphBuilder, RenderGraphPass, RenderGraphPassContext } from '../RenderGraphPass';
import { TextureHandle } from '../transient/ResourceHandle';
import { TextureIdentityWatcher } from '../transient/TextureIdentityWatcher';

export const MOTION_VECTOR = '_MotionVector';

/**
 * Per-pixel screen-space motion vector pass.
 *
 * Two dispatches per frame:
 *  1. delta (MotionVectorDelta_cs): per allocated world matrix, compute
 *     prevWorld * affineInverse(currWorld) and roll the prev-matrix
 *     history — identity for static objects.
 *  2. reproject (MotionVector_cs): per pixel, carry the reconstructed
 *     world position back through the owning object's delta (object id
 *     comes from the gBuffer w channel) and project with the previous
 *     frame's viewProj. Output rg = currUv - prevUv, b = the expected
 *     previous-frame view depth (temporal disocclusion key).
 *
 * Covers camera motion and rigid object motion; skinned/morphed vertex
 * animation still needs a vertex-stage prev-position path.
 *
 * Consumed by TAA, motion blur, and temporal denoisers.
 *
 * Declares its output through the transient subsystem
 * (`b.declareTexture` + `b.write(h, 'storage')`) and resolves the
 * actual {@link RenderTexture} through `ctx.getTexture(handle)` each
 * frame.
 *
 * @group Graph
 */
export class MotionVectorPass extends RenderGraphPass {
    public readonly name = 'MotionVectorPass';

    protected _ctx!: Context3D;
    protected _mvHandle!: TextureHandle;
    protected _compute: ComputeShader | null = null;
    protected _deltaCompute: ComputeShader | null = null;
    protected _mvData: UniformGPUBuffer | null = null;
    protected _deltaData: UniformGPUBuffer | null = null;
    /** Previous-frame world matrices, rolled in the delta dispatch. */
    protected _prevMatrixBuffer: StorageGPUBuffer | null = null;
    /** Per-object motion deltas consumed by the reprojection dispatch. */
    protected _deltaBuffer: StorageGPUBuffer | null = null;
    /** Matrix capacity of the two buffers above. */
    protected _matrixCapacity: number = 0;
    /** Forces identity deltas while the prev buffer is unseeded
     *  (first frame ever, or the frame a capacity regrow rebuilt it). */
    protected _needSeed: boolean = true;
    protected readonly _prevViewProj: Matrix4 = new Matrix4().identity();
    protected readonly _currViewProj: Matrix4 = new Matrix4().identity();
    protected readonly _scratch: Matrix4 = new Matrix4().identity();
    /** Detects pool-driven texture identity swaps (resize, re-alias)
     *  so we know when to invalidate the cached compute shader. */
    protected readonly _watcher: TextureIdentityWatcher = new TextureIdentityWatcher();
    /** Last presentationSize seen by `_ensureCompute`; mismatch triggers
     *  a workgroup count refresh (the texture is also refreshed via
     *  the watcher, but workgroup math depends on logical size, not
     *  identity). */
    protected _lastWorkerW: number = 0;
    protected _lastWorkerH: number = 0;

    public setup(b: RenderGraphBuilder): void {
        this._ctx = b.context3D;
        // Declare a screen-sized rgba16float storage texture. rgba16float
        // (not rg16float) because the latter is not in WebGPU's default
        // storage-texture format set — would require an extension on
        // some adapters. The b channel carries the prev-frame depth key.
        // aliasable:false + publishToLegacyMap so post-chain consumers
        // (TAAPost) can resolve the texture by name through
        // RTResourceMap with a stable wrapper identity.
        this._mvHandle = b.declareTexture(MOTION_VECTOR, {
            format: GPUTextureFormat.rgba16float,
            width: 'screen',
            height: 'screen',
            label: MOTION_VECTOR,
            aliasable: false,
            publishToLegacyMap: true,
        });
        b.write(this._mvHandle, 'storage');
    }

    /** Grow (never shrink) the prev/delta buffers to hold `count`
     *  matrices. A rebuild leaves the prev history unseeded, so the
     *  next delta dispatch runs in identity mode for one frame. */
    protected _ensureMatrixCapacity(count: number): void {
        if (count <= this._matrixCapacity && this._prevMatrixBuffer) return;
        // Amortized growth; floats per matrix = 16.
        const capacity = Math.max(1024, 1 << Math.ceil(Math.log2(count)));
        this._prevMatrixBuffer?.destroy();
        this._deltaBuffer?.destroy();
        this._prevMatrixBuffer = new StorageGPUBuffer(capacity * 16);
        bindCtx(this._prevMatrixBuffer, this._ctx);
        this._prevMatrixBuffer.buffer.label = 'MV_prevWorldMatrix';
        this._deltaBuffer = new StorageGPUBuffer(capacity * 16);
        bindCtx(this._deltaBuffer, this._ctx);
        this._deltaBuffer.buffer.label = 'MV_motionDelta';
        this._matrixCapacity = capacity;
        this._needSeed = true;
        // Rebind on both shaders if they already exist.
        if (this._deltaCompute) {
            this._deltaCompute.setStorageBuffer('prevModels', this._prevMatrixBuffer);
            this._deltaCompute.setStorageBuffer('deltaOut', this._deltaBuffer);
        }
        if (this._compute) {
            this._compute.setStorageBuffer('deltaModels', this._deltaBuffer);
        }
    }

    protected _ensureCompute(ctx: RenderGraphPassContext, mv: RenderTexture): void {
        const [w, h] = this._ctx.presentationSize;
        const sizeChanged = w !== this._lastWorkerW || h !== this._lastWorkerH;
        if (this._compute && !sizeChanged) return;
        if (!this._compute) {
            ShaderLib.register('MotionVector_cs', MotionVector_cs);
            this._compute = new ComputeShader(MotionVector_cs);

            // mat4x4<f32> = 16 floats
            this._mvData = new UniformGPUBuffer(16);
            this._compute.setUniformBuffer('mvData', this._mvData);

            const cameraGroup = GlobalBindGroup.getCameraGroup(ctx.view.camera);
            this._compute.setUniformBuffer('globalUniform', cameraGroup.uniformGPUBuffer);

            const rtFrame = GBufferFrame.getGBufferFrame(GBufferFrame.colorPass_GBuffer, this._ctx);
            this._compute.setSamplerTexture('gBufferTexture', rtFrame.getCompressGBufferTexture());
            this._compute.setSamplerTexture('inTex', rtFrame.getColorTexture());
            this._compute.setStorageTexture('outTex', mv);
            this._compute.setStorageBuffer('deltaModels', this._deltaBuffer!);
        } else {
            // Identity-change path: keep the compiled shader, just
            // re-bind to the new storage texture (resize / pool re-alias).
            this._compute.setStorageTexture('outTex', mv);
        }
        this._compute.workerSizeX = Math.ceil(w / 8);
        this._compute.workerSizeY = Math.ceil(h / 8);
        this._compute.workerSizeZ = 1;
        this._lastWorkerW = w;
        this._lastWorkerH = h;
    }

    protected _ensureDeltaCompute(): void {
        if (this._deltaCompute) return;
        ShaderLib.register('MotionVectorDelta_cs', MotionVectorDelta_cs);
        this._deltaCompute = new ComputeShader(MotionVectorDelta_cs);
        this._deltaData = new UniformGPUBuffer(4);
        this._deltaCompute.setUniformBuffer('deltaData', this._deltaData);
        const matrixGroup = GlobalBindGroup.getModelMatrixBindGroup(this._ctx);
        this._deltaCompute.setStorageBuffer('models', matrixGroup.matrixBufferDst);
        this._deltaCompute.setStorageBuffer('prevModels', this._prevMatrixBuffer!);
        this._deltaCompute.setStorageBuffer('deltaOut', this._deltaBuffer!);
    }

    public execute(ctx: RenderGraphPassContext): void {
        const mv = ctx.getTexture(this._mvHandle);
        // Pool may have handed us a different RenderTexture wrapper
        // (canvas resize → compile re-ran → new bucket entry) or the
        // wrapper's GPUTexture may have been recreated under us. Watch
        // ALL bound textures — not just our own output: the gBuffer and
        // scene-color textures also rebuild on resize, and if that
        // rebuild lands after the ComputeShader's own RESIZE listener
        // fired, the cached bind group keeps referencing the destroyed
        // texture forever ("Destroyed texture used in a submit" every
        // frame, whole submit dropped).
        const rtFrame = GBufferFrame.getGBufferFrame(GBufferFrame.colorPass_GBuffer, this._ctx);
        const dirty = this._watcher.update([
            { key: 'mv', tex: mv },
            { key: 'gbuffer', tex: rtFrame.getCompressGBufferTexture() },
            { key: 'color', tex: rtFrame.getColorTexture() },
        ]);
        if (dirty) this._compute = null;

        const matrixCount = Math.max(1, Matrix4.useCount);
        this._ensureMatrixCapacity(matrixCount);
        this._ensureDeltaCompute();
        this._ensureCompute(ctx, mv);

        // Capture current viewProj BEFORE updating prev so the first
        // frame uploads the (identity) prev → motion vectors land at 0
        // and there's no first-frame ghosting.
        const camera = ctx.view.camera;
        this._scratch.multiplyMatrices(camera.projectionMatrix, camera.viewMatrix);

        // Upload PREV (the prior frame's viewProj).
        this._mvData!.setMatrix('prevViewProj', this._prevViewProj);
        this._mvData!.apply();

        this._deltaData!.setFloat('count', matrixCount);
        this._deltaData!.setFloat('firstFrame', this._needSeed ? 1 : 0);
        this._deltaData!.apply();
        this._deltaCompute!.workerSizeX = Math.ceil(matrixCount / 64);
        this._deltaCompute!.workerSizeY = 1;
        this._deltaCompute!.workerSizeZ = 1;

        const gpu = this._ctx.gpuContext;
        const command = gpu.beginCommandEncoder();
        gpu.computeCommand(command, [this._deltaCompute!, this._compute!]);
        gpu.endCommandEncoder(command);
        this._needSeed = false;

        // Roll: this frame's viewProj becomes next frame's prev.
        this._prevViewProj.copy(this._scratch);
        this._currViewProj.copy(this._scratch);
    }
}
