import { GPUTextureFormat } from "../gfx/graphics/webGpu/WebGPUConst";
import { ITexture } from "../gfx/graphics/webGpu/core/texture/ITexture";
import { Texture } from "../gfx/graphics/webGpu/core/texture/Texture";
import { Context3D } from "../gfx/graphics/webGpu/Context3D";

/**
 * cube texture witch data if for depth
 * @internal
 * @group Texture
 */
export class DepthCubeTexture extends Texture implements ITexture {

    // NOTE: no width/height/depthOrArrayLayers field re-declarations here —
    // with useDefineForClassFields their initializers would run AFTER
    // super(width, height, 6) and stomp the constructor arguments
    // (every instance ended up 4x4x6 regardless of what was requested).

    /**
     * GPUShaderStage
     */
    public visibility: number = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE;

    /**
     * @constructor
     */
    constructor(width: number, height: number, ctx?: Context3D) {
        super(width, height, 6);

        // texture_depth_2d_array
        this.format = GPUTextureFormat.depth32float;
        this.mipmapCount = 1;

        this._ensureBound(ctx);
        this.init();
    }

    public internalCreateBindingLayoutDesc() {
        this.samplerBindingLayout.type = `non-filtering`;
        // Depth formats must bind with sampleType 'depth' —
        // 'unfilterable-float' fails bind-group validation for depth textures.
        this.textureBindingLayout.sampleType = `depth`;
        this.textureBindingLayout.viewDimension = 'cube';
    }

    public internalCreateTexture() {
        this.textureDescriptor = {
            // Use the declared format — the descriptor previously hardcoded
            // depth24plus while this.format claimed depth32float.
            format: this.format,
            size: { width: this.width, height: this.height, depthOrArrayLayers: 6 },
            dimension: '2d',
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
        }
        this.gpuTexture = this.getGPUTexture();
    }

    public internalCreateView() {
        this.viewDescriptor = {
            dimension: `cube`,
        };
        this.view = this.getGPUView();
        // this.view = this.gpuTexture.createView(this.viewDescriptor);
    }

    public internalCreateSampler() {
        this._ensureBound();
        const device = this._boundCtx!.device;
        this.gpuSampler = device.createSampler({});
        this.gpuSampler_comparison = device.createSampler({
            compare: 'less',
            label: "sampler_comparison"
        });
    }

}
