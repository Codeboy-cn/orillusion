import { Texture } from '../gfx/graphics/webGpu/core/texture/Texture';
import { TextureMipmapGenerator } from '../gfx/graphics/webGpu/core/texture/TextureMipmapGenerator';
import { GPUTextureFormat } from '../gfx/graphics/webGpu/WebGPUConst';
import { Context3D } from '../gfx/graphics/webGpu/Context3D';
import { toHalfFloat } from '../util/Convert';
/**
 * @internal
 * Float16Array texture
 * @group Texture
 */
export class Float16ArrayTexture extends Texture {
    public uint16Array: Uint16Array;
    public floatArray: number[];
    /**
     * fill this texture by array of numbers;the format as [red0, green0, blue0, alpha0, red1, green1, blue1, alpha1...]
     * @param width assign the texture width
     * @param height assign the texture height
     * @param numbers color of each pixel
     * @param useMipmap  whether or not gen mipmap
     * @returns
     */
    public create(width: number, height: number, numbers: number[] = null, mipmap: boolean = true, ctx?: Context3D): this {
        if (numbers == null) {
            numbers = [];
            for (let i = 0, c = width * height * 4; i < c; i++) {
                numbers[i] = 0;
            }
        }
        this.updateTexture(width, height, numbers, mipmap, ctx);
        return this;
    }

    /**
     * validate the change of this texture
     */
    public updateTexture(width: number, height: number, numbers: number[], mipmap: boolean = true, ctx?: Context3D) {
        if (width != this.width || height != this.height) {
            this.gpuTexture && this.gpuTexture.destroy();
            this.gpuTexture = null;
        }

        this.floatArray = numbers;
        this._ensureBound(ctx);
        let device = this._boundCtx!.device;
        if (numbers.length < width * height * 4) {
            throw new Error(`Float16ArrayTexture: data holds ${numbers.length} values but ${width}x${height} RGBA needs ${width * height * 4}`);
        }
        this.format = GPUTextureFormat.rgba16float;

        // max(1, ...) — a 1-pixel dimension used to produce mipmapCount 0
        // (invalid descriptor), and height was ignored entirely.
        this.mipmapCount = mipmap ? Math.max(1, Math.floor(Math.log2(Math.max(width, height)))) : 1;
        this.createTextureDescriptor(width, height, this.mipmapCount, this.format);
        if (!this.uint16Array || this.uint16Array.length != numbers.length) {
            this.uint16Array = new Uint16Array(numbers.length);
        }
        let uint16Array = this.uint16Array;
        for (let i = 0, c = uint16Array.length; i < c; i++) {
            uint16Array[i] = toHalfFloat(numbers[i]);
        }
        // writeTexture accepts tightly-packed rows of any width — the old
        // staging copyBufferToTexture path required 256-byte row alignment
        // (only widths that are multiples of 32 texels were legal).
        device.queue.writeTexture(
            { texture: this.getGPUTexture() },
            uint16Array as unknown as BufferSource,
            { bytesPerRow: width * 4 * 2, rowsPerImage: height },
            { width: width, height: height, depthOrArrayLayers: 1 },
        );
        if (!this.useMipmap) {
            this.samplerBindingLayout.type = `filtering`;
            this.textureBindingLayout.sampleType = `float`;
        }

        this.gpuSampler = device.createSampler(this);
        this.gpuTexture = this.getGPUTexture();

        if (this.mipmapCount > 1) TextureMipmapGenerator.webGPUGenerateMipmap(this);
    }
}
