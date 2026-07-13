import { Context3D } from '../gfx/graphics/webGpu/Context3D';
import { Texture } from '../gfx/graphics/webGpu/core/texture/Texture';
import { TextureMipmapGenerator } from '../gfx/graphics/webGpu/core/texture/TextureMipmapGenerator';
import { GPUTextureFormat } from '../gfx/graphics/webGpu/WebGPUConst';

/**
 * create texture by number array, which format is uint8
 * @group Texture
 */
export class Uint8ArrayTexture extends Texture {

    private _upload(width: number, height: number, data: Uint8Array) {
        if (data.length < width * height * 4) {
            throw new Error(`Uint8ArrayTexture: data holds ${data.length} bytes but ${width}x${height} RGBA needs ${width * height * 4}`);
        }
        // writeTexture accepts any tightly-packed row width — the old
        // staging copyBufferToTexture path rounded bytesPerRow up to 256
        // while the CPU data stayed tightly packed, so any width that
        // wasn't a multiple of 64 texels either failed validation or
        // sampled skewed rows.
        this._boundCtx!.device.queue.writeTexture(
            { texture: this.getGPUTexture() },
            data as unknown as BufferSource,
            { bytesPerRow: width * 4, rowsPerImage: height },
            { width: width, height: height, depthOrArrayLayers: 1 },
        );
    }

    /**
     * create texture by number array, which format is uint8
     * @param width width of texture
     * @param height height of texture
     * @param data uint8 array
     * @param useMipmap whether or not gen mipmap
     * @returns
     */
    public create(width: number, height: number, data: Uint8Array, useMipmap: boolean = false, ctx?: Context3D): this {
        this._ensureBound(ctx);

        this.format = GPUTextureFormat.rgba8unorm;
        // max(1, ...) — a 1-pixel dimension used to produce mipmapCount 0
        // (invalid descriptor), and height was ignored entirely.
        this.mipmapCount = useMipmap ? Math.max(1, Math.floor(Math.log2(Math.max(width, height)))) : 1;
        this.createTextureDescriptor(width, height, this.mipmapCount, this.format);

        this._upload(width, height, data);

        if (this.mipmapCount > 1) {
            TextureMipmapGenerator.webGPUGenerateMipmap(this);
        }
        return this;
    }

    /**
     * validate the change of this texture
     */
    public updateTexture(width: number, height: number, data: Uint8Array) {
        let device = this._boundCtx!.device;
        this.mipmapCount = Math.max(1, Math.floor(Math.log2(Math.max(width, height))));

        this._upload(width, height, data);
        this.gpuSampler = device.createSampler(this);

        if (this.mipmapCount > 1) {
            TextureMipmapGenerator.webGPUGenerateMipmap(this);
        }
    }
}
