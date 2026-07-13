import { Texture } from '../gfx/graphics/webGpu/core/texture/Texture';
import { GPUTextureFormat } from '../gfx/graphics/webGpu/WebGPUConst';
import { Context3D } from '../gfx/graphics/webGpu/Context3D';
/**
 * @internal
 * Float32Array texture
 * @group Texture
 */
export class Float32ArrayTexture extends Texture {
    /**
     * fill this texture by array of numbers;the format as [red0, green0, blue0, alpha0, red1, green1, blue1, alpha1...]
     * @param width assign the texture width
     * @param height assign the texture height
     * @param data color of each pixel
     * @param filtering request a filtering sampler binding. Defaults to
     *        false: rgba32float is only filterable when the device has
     *        the 'float32-filterable' feature, so the non-filtering
     *        binding is the universally legal one. (The old parameter
     *        was inverted — passing true configured NON-filtering.)
     * @returns
     */
    public create(width: number, height: number, data: Float32Array, filtering: boolean = false, ctx?: Context3D) {
        this._ensureBound(ctx);
        let device = this._boundCtx!.device;
        if (data.length < width * height * 4) {
            throw new Error(`Float32ArrayTexture: data holds ${data.length} floats but ${width}x${height} RGBA needs ${width * height * 4}`);
        }
        this.format = GPUTextureFormat.rgba32float;

        this.mipmapCount = 1;
        this.createTextureDescriptor(width, height, this.mipmapCount, this.format);

        // writeTexture accepts tightly-packed rows of any width — the old
        // staging copyBufferToTexture path required 256-byte row alignment
        // (only widths that are multiples of 16 texels were legal) and its
        // staging buffer was never destroyed.
        device.queue.writeTexture(
            { texture: this.getGPUTexture() },
            data as unknown as BufferSource,
            { bytesPerRow: width * 4 * 4, rowsPerImage: height },
            { width: width, height: height, depthOrArrayLayers: 1 },
        );

        if (!filtering) {
            this.samplerBindingLayout.type = `non-filtering`;
            this.textureBindingLayout.sampleType = `unfilterable-float`;
        }

        this.gpuSampler = device.createSampler({});
    }

    /**
     * fill this texture GPUBuffer. Kept on the copy path (the source is
     * already a GPUBuffer); copyBufferToTexture requires 256-byte-aligned
     * rows, so only widths that are multiples of 16 texels are legal.
     * @param width assign the texture width
     * @param height assign the texture height
     * @param textureDataBuffer GPUBuffer
     * @returns
     */
    public fromBuffer(width: number, height: number, textureDataBuffer: GPUBuffer, ctx?: Context3D): this {
        this._ensureBound(ctx);
        let device = this._boundCtx!.device;
        const bytesPerRow = width * 4 * 4;
        if (bytesPerRow % 256 !== 0) {
            throw new Error(`Float32ArrayTexture.fromBuffer: width ${width} gives bytesPerRow ${bytesPerRow}, but copyBufferToTexture requires a multiple of 256 (width must be a multiple of 16)`);
        }
        this.format = GPUTextureFormat.rgba32float;

        this.mipmapCount = 1;
        this.createTextureDescriptor(width, height, this.mipmapCount, this.format);

        const commandEncoder = this._boundCtx!.gpuContext.beginCommandEncoder();
        commandEncoder.copyBufferToTexture(
            {
                buffer: textureDataBuffer,
                bytesPerRow: bytesPerRow,
            },
            {
                texture: this.getGPUTexture(),
            },
            {
                width: width,
                height: height,
                depthOrArrayLayers: 1,
            },
        );

        this._boundCtx!.gpuContext.endCommandEncoder(commandEncoder);

        this.samplerBindingLayout.type = `non-filtering`;
        this.textureBindingLayout.sampleType = `unfilterable-float`;
        this.gpuSampler = device.createSampler({});
        return this;
    }
}
