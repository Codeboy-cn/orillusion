import { RenderTexture } from '../../../../textures/RenderTexture';
import { GPUTextureFormat } from '../../../graphics/webGpu/WebGPUConst';
import { Context3D } from '../../../graphics/webGpu/Context3D';
import { TextureMipmapGenerator } from '../../../graphics/webGpu/core/texture/TextureMipmapGenerator';
import { GBufferFrame } from '../../frame/GBufferFrame';
import { RTResourceMap } from '../../frame/RTResourceMap';
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
 * The pyramid carries a full mip chain so frosted-glass / rough-glass
 * transmission can sample blurred levels via `textureSampleLevel`.
 * Mip 0 is the raw `_ColorBuffer` copy; mips 1..N are progressively
 * downsampled box filters generated each frame after the copy via
 * {@link TextureMipmapGenerator}. PBRLitShader's transmission block
 * picks an LOD from `roughness` so polished glass reads from mip 0
 * (sharp refraction) and frosted glass reads from a higher LOD
 * (blurred backdrop) — the path Three.js's getTransmissionSample
 * follows.
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
            // Allocate via RTResourceMap (not `new RenderTexture(...)`)
            // so LitMaterial.transmissionFactor's setter can find the
            // pyramid via `RTResourceMap.getTexture(ctx, '_SceneColorPyramid')`.
            // Without going through the map, transmission materials
            // would forever bind the white-texture placeholder and
            // refraction would render as flat lit color.
            this._pyramid = RTResourceMap.createRTTexture(
                this._ctx, SCENE_COLOR_PYRAMID,
                colorBuffer.width, colorBuffer.height,
                GPUTextureFormat.rgba16float,
                false, 0,
            );
            this._pyramid.name = SCENE_COLOR_PYRAMID;
            // RenderTexture.resize() unconditionally writes useMipmap
            // = false and mipLevelCount = 1, so we can't get a mipped
            // RT through the public constructor. Patch the descriptor
            // and re-allocate the GPUTexture in-place after the RT
            // wrapper exists — only this specific RT needs the chain;
            // keeping the change scoped here avoids cascading impacts
            // on r32float / depth / etc. RTs whose sampler bindings
            // depend on the single-mip layout.
            this._installMipChain(this._pyramid);
        }
        return this._pyramid;
    }

    /** Re-create the pyramid's underlying GPUTexture with a full mip
     *  chain. The wrapper RenderTexture, viewDescriptor, etc. stay
     *  the same so RTResourceMap and LitMaterial bindings keep
     *  pointing at the same handle. */
    private _installMipChain(rt: RenderTexture): void {
        const mipLevelCount = Math.floor(Math.log2(Math.max(rt.width, rt.height))) + 1;
        rt.mipmapCount = mipLevelCount;
        rt.textureDescriptor.mipLevelCount = mipLevelCount;
        if (rt.viewDescriptor) {
            rt.viewDescriptor.mipLevelCount = mipLevelCount;
        }
        // gpuTexture is `protected` on Texture; cast to any so this
        // feature (which lives outside the texture class hierarchy)
        // can swap the underlying GPU handle without losing the
        // wrapper instance the rest of the engine already holds
        // references to.
        const rtAny = rt as any;
        const old = rtAny.gpuTexture;
        if (old instanceof GPUTexture) {
            old.destroy();
        }
        rtAny.gpuTexture = this._ctx.device.createTexture(rt.textureDescriptor);
        // Force view recreation on next access so the shader sees the
        // new mip layout.
        rtAny._view = null;
        rt.view = null as any;
    }

    public execute(ctx: FeatureContext): void {
        const colorBuffer = ctx.get<RenderTexture>(COLOR_BUFFER);
        if (!colorBuffer) return;
        const pyramid = this._getOrAllocate();
        const gpu = ctx.view.engine3D.context3D.gpuContext;
        const command = gpu.beginCommandEncoder();
        // Copy mip 0 from the live color buffer.
        command.copyTextureToTexture(
            { texture: colorBuffer.getGPUTexture(), mipLevel: 0, origin: { x: 0, y: 0, z: 0 } },
            { texture: pyramid.getGPUTexture(), mipLevel: 0, origin: { x: 0, y: 0, z: 0 } },
            { width: colorBuffer.width, height: colorBuffer.height, depthOrArrayLayers: 1 },
        );
        gpu.endCommandEncoder(command);
        // Refresh mips 1..N. webGPUGenerateMipmap submits its own
        // command encoder (it has to — running inside the live one
        // would auto-finish the main loop's encoder mid-frame and
        // explode the next end-pass). It reads mip i and writes
        // mip i+1 with hardware blits, so for an HD-ish viewport
        // (1080p) the cost is ~0.05ms.
        TextureMipmapGenerator.webGPUGenerateMipmap(pyramid);
    }
}
