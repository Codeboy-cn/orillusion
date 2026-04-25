import { RenderTexture } from '../../../../textures/RenderTexture';
import { GPUTextureFormat } from '../../../graphics/webGpu/WebGPUConst';
import { Context3D } from '../../../graphics/webGpu/Context3D';
import { GBufferFrame } from '../../frame/GBufferFrame';
import { FeatureContext, RenderFeature } from '../RenderFeature';
import { RenderStage } from '../RenderStage';
import { COLOR_BUFFER } from './ColorFeature';

/**
 * Published handle name for the scene color snapshot produced after
 * opaque rendering finishes and before transparent rendering begins.
 * Transmission materials (glass / water / clear plastic) sample this
 * texture through a fragment shader refraction term — see
 * `KHR_materials_transmission` + `Transmission_frag.ts`.
 *
 * This is a single-level copy of `_ColorBuffer` (no mip chain) — it
 * is called "pyramid" for forward compatibility with the P3 upgrade
 * path where `roughness`-aware refraction samples filtered mips. For
 * v1 the refraction is always sharp, which is correct for polished
 * glass and acceptable for frosted variants.
 *
 * @group Graph
 */
export const SCENE_COLOR_PYRAMID = '_SceneColorPyramid';

/**
 * Frame Graph feature that snapshots `_ColorBuffer` at
 * {@link RenderStage.AfterOpaque}. Runs between `ColorFeature`
 * (opaque-only, via `maskTr=true`) and `SortedTransparentFeature`
 * (transparent-only, via `maskOp=true`) so transmission materials
 * sample the opaque-world backdrop without seeing other transparents.
 *
 * Allocates one `RenderTexture` per Context3D, sized to match the
 * current color buffer and recreated on resize.
 *
 * @group Graph
 */
export class SceneColorPyramidFeature extends RenderFeature {
    public readonly name = 'SceneColorPyramidFeature';
    public readonly stage = RenderStage.AfterOpaque;
    public readonly reads = [COLOR_BUFFER];
    public readonly writes = [SCENE_COLOR_PYRAMID];

    private readonly _ctx: Context3D;
    private _pyramid: RenderTexture | null = null;

    constructor(ctx: Context3D) {
        super();
        this._ctx = ctx;
    }

    public registerResources(pool: { registerExternal<T>(name: string, getter: () => T): void }): void {
        pool.registerExternal<RenderTexture>(SCENE_COLOR_PYRAMID, () => this._getOrAllocate());
    }

    private _getOrAllocate(): RenderTexture {
        const colorBuffer = GBufferFrame.getGBufferFrame(GBufferFrame.colorPass_GBuffer, this._ctx).getColorTexture();
        if (!this._pyramid || this._pyramid.width !== colorBuffer.width || this._pyramid.height !== colorBuffer.height) {
            // Format matches the color buffer so the fragment shader
            // can sample with a filtering sampler (rgba16float
            // supports linear filtering in WebGPU without the
            // float32-filterable extension).
            this._pyramid = new RenderTexture(
                colorBuffer.width, colorBuffer.height,
                GPUTextureFormat.rgba16float,
                false, undefined, 1, 0, false, true, this._ctx,
            );
            this._pyramid.name = SCENE_COLOR_PYRAMID;
        }
        return this._pyramid;
    }

    public execute(ctx: FeatureContext): void {
        const colorBuffer = ctx.get<RenderTexture>(COLOR_BUFFER);
        if (!colorBuffer) return;
        const pyramid = this._getOrAllocate();
        const gpu = ctx.view.engine3D.context3D.gpuContext;
        const command = gpu.beginCommandEncoder();
        command.copyTextureToTexture(
            { texture: colorBuffer.getGPUTexture(), mipLevel: 0, origin: { x: 0, y: 0, z: 0 } },
            { texture: pyramid.getGPUTexture(), mipLevel: 0, origin: { x: 0, y: 0, z: 0 } },
            { width: colorBuffer.width, height: colorBuffer.height, depthOrArrayLayers: 1 },
        );
        gpu.endCommandEncoder(command);
    }
}
