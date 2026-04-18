import { GPUTextureFormat } from '../gfx/graphics/webGpu/WebGPUConst';
import { ITexture } from '../gfx/graphics/webGpu/core/texture/ITexture';
import { Texture } from '../gfx/graphics/webGpu/core/texture/Texture';
import { Context3D } from '../gfx/graphics/webGpu/Context3D';
/**
 * Depth 2D TextureArray
 * @internal
 * @group Texture
 */
export class Depth2DTextureArray extends Texture implements ITexture {

    /**
     * @constructor
     * @width texture width (pixel)
     * @width texture height (pixel)
     * @width texture format, default value is depth32float
     */
    constructor(width: number, height: number, format: GPUTextureFormat = GPUTextureFormat.depth32float, numberLayer: number = 4, ctx?: Context3D) {
        super(width, height, numberLayer);

        // this.visibility = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE;

        // texture_depth_2d_array
        this.format = format;
        this.mipmapCount = 1;

        this._ensureBound(ctx);
        this.init();
    }

    internalCreateBindingLayoutDesc() {
        this.textureBindingLayout.sampleType = `depth`;
        this.textureBindingLayout.viewDimension = `2d-array`;
        this.samplerBindingLayout.type = `filtering`;
        this.sampler_comparisonBindingLayout.type = `comparison`;
    }

    internalCreateTexture() {
        this.textureDescriptor = {
            format: this.format,
            size: { width: this.width, height: this.height, depthOrArrayLayers: this.numberLayer },
            dimension: '2d',
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
        }
        this.gpuTexture = this.getGPUTexture();
    }

    internalCreateView() {
        this.viewDescriptor = {
            dimension: `2d-array`,
        };
        this.view = this.getGPUView();
        // this.view = this.gpuTexture.createView(this.viewDescriptor);
    }

    internalCreateSampler() {
        this._ensureBound();
        const device = this._boundCtx!.device;
        this.gpuSampler = device.createSampler({});
        this.gpuSampler_comparison = device.createSampler({
            compare: 'less',
            label: "sampler_comparison"
        });
    }

}
