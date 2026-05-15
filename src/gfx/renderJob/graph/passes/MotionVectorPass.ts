import { MotionVector_cs } from '../../../../assets/shader/compute/MotionVector_cs';
import { ShaderLib } from '../../../../assets/shader/ShaderLib';
import { Matrix4 } from '../../../../math/Matrix4';
import { RenderTexture } from '../../../../textures/RenderTexture';
import { Context3D } from '../../../graphics/webGpu/Context3D';
import { GlobalBindGroup } from '../../../graphics/webGpu/core/bindGroups/GlobalBindGroup';
import { UniformGPUBuffer } from '../../../graphics/webGpu/core/buffer/UniformGPUBuffer';
import { ComputeShader } from '../../../graphics/webGpu/shader/ComputeShader';
import { GPUTextureFormat } from '../../../graphics/webGpu/WebGPUConst';
import { GBufferFrame } from '../../frame/GBufferFrame';
import { RenderGraphBuilder, RenderGraphPass, RenderGraphPassContext } from '../RenderGraphPass';

export const MOTION_VECTOR = '_MotionVector';

/**
 * Per-pixel screen-space motion vector pass. Reverse-reprojects each
 * fragment's world position with the previous frame's viewProj matrix
 * to produce `(currUv - prevUv)` in rg16float storage.
 *
 * Consumed by TAA, motion blur, temporal denoisers.
 *
 * MVP limitation: works only for camera-driven motion. Per-vertex
 * prev-clip output for skinned meshes is the upgrade path.
 *
 * @group Graph
 */
export class MotionVectorPass extends RenderGraphPass {
    public readonly name = 'MotionVectorPass';

    private _ctx!: Context3D;
    private _mv: RenderTexture | null = null;
    private _compute: ComputeShader | null = null;
    private _mvData: UniformGPUBuffer | null = null;
    private readonly _prevViewProj: Matrix4 = new Matrix4().identity();
    private readonly _currViewProj: Matrix4 = new Matrix4().identity();
    private readonly _scratch: Matrix4 = new Matrix4().identity();

    public setup(b: RenderGraphBuilder): void {
        this._ctx = b.context3D;
        // Lazy alloc: pyramid size depends on presentation size which
        // can change post-init; getter rebuilds on resize.
        b.write<RenderTexture>(MOTION_VECTOR, () => this._getOrAllocate());
    }

    private _getOrAllocate(): RenderTexture {
        const [w, h] = this._ctx.presentationSize;
        if (this._mv && this._mv.width === w && this._mv.height === h) return this._mv;
        // rgba16float (not rg16) — rg16float is not in WebGPU's default
        // storage texture format set; rgba16float wastes 2 channels but
        // works on every adapter without an extension. Build directly
        // so we can include STORAGE_BINDING usage (RTResourceMap's
        // default RT usage doesn't have it).
        this._mv = new RenderTexture(
            w, h, GPUTextureFormat.rgba16float, false,
            GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
            1, 0, false, true, this._ctx,
        );
        this._mv.name = MOTION_VECTOR;
        // Recreate compute (texture binding changed)
        this._compute = null;
        return this._mv;
    }

    private _ensureCompute(ctx: RenderGraphPassContext): void {
        if (this._compute) return;
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
        this._compute.setStorageTexture('outTex', this._mv!);

        const [w, h] = this._ctx.presentationSize;
        this._compute.workerSizeX = Math.ceil(w / 8);
        this._compute.workerSizeY = Math.ceil(h / 8);
        this._compute.workerSizeZ = 1;
    }

    public execute(ctx: RenderGraphPassContext): void {
        this._getOrAllocate();
        this._ensureCompute(ctx);

        // Capture current viewProj BEFORE updating prev so the first
        // frame uploads the (identity) prev → motion vectors land at 0
        // and there's no first-frame ghosting.
        const camera = ctx.view.camera;
        this._scratch.multiplyMatrices(camera.projectionMatrix, camera.viewMatrix);

        // Upload PREV (the prior frame's viewProj).
        this._mvData!.setMatrix('prevViewProj', this._prevViewProj);
        this._mvData!.apply();

        const gpu = this._ctx.gpuContext;
        const command = gpu.beginCommandEncoder();
        gpu.computeCommand(command, [this._compute!]);
        gpu.endCommandEncoder(command);

        // Roll: this frame's viewProj becomes next frame's prev.
        this._prevViewProj.copy(this._scratch);
        this._currViewProj.copy(this._scratch);
    }
}
