import { Texture } from '../gfx/graphics/webGpu/core/texture/Texture';
import { TextureMipmapGenerator } from '../gfx/graphics/webGpu/core/texture/TextureMipmapGenerator';
import { GPUTextureFormat } from '../gfx/graphics/webGpu/WebGPUConst';
import { Context3D } from '../gfx/graphics/webGpu/Context3D';
import { toHalfFloat } from '../util/Convert';
/**
 * @internal
 * Uint16 texture
 * @group Texture
 */
export class Uint16Texture extends Texture {

    /**
     * create texture by number array, which format is uint8
     * @param width width of texture
     * @param height height of texture
     * @param data uint8 array
     * @param useMipmap whether or not gen mipmap
     * @returns
     */
    public create(width: number, height: number, data: Float32Array, useMiamp: boolean = true, ctx?: Context3D) {
        this._ensureBound(ctx);
        let device = this._boundCtx!.device;
        this.format = GPUTextureFormat.rgba16float;

        // max(1, ...): log2(1)=0 produced an invalid zero-mip descriptor.
        this.mipmapCount = useMiamp ? Math.max(1, Math.floor(Math.log2(width))) : 1;
        this.createTextureDescriptor(width, height, this.mipmapCount, this.format);

        // Convert f32 -> f16: the raw Float32Array was previously copied
        // bit-for-bit into the rgba16float texture with an 16-byte-per-pixel
        // row stride (this format is 8), producing noise and misaligned rows.
        const half = new Uint16Array(width * height * 4);
        for (let i = 0, c = Math.min(half.length, data.length); i < c; i++) {
            half[i] = toHalfFloat(data[i]);
        }
        device.queue.writeTexture(
            { texture: this.getGPUTexture() },
            half,
            { bytesPerRow: width * 4 * 2, rowsPerImage: height },
            { width: width, height: height, depthOrArrayLayers: 1 },
        );

        this.minFilter = `nearest`;
        this.magFilter = `nearest`;
        this.mipmapFilter = `nearest`;
        this.samplerBindingLayout.type = `non-filtering`;
        this.textureBindingLayout.sampleType = `unfilterable-float`;

        // not suport float this
        this.minFilter = `linear`;
        this.magFilter = `linear`;
        this.mipmapFilter = `nearest`;
        this.samplerBindingLayout.type = `filtering`;
        this.textureBindingLayout.sampleType = `float`;
        this.gpuSampler = device.createSampler(this);

        if (this.mipmapCount > 1) {
            TextureMipmapGenerator.webGPUGenerateMipmap(this);
        }
    }

}
