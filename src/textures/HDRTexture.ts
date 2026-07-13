import { Texture } from '../gfx/graphics/webGpu/core/texture/Texture';
import { GPUTextureFormat } from '../gfx/graphics/webGpu/WebGPUConst';
import { Context3D } from '../gfx/graphics/webGpu/Context3D';
import { FileLoader } from '../loader/FileLoader';
import { LoaderFunctions } from '../loader/LoaderFunctions';
import { RGBEParser } from '../loader/parser/RGBEParser';
import { toHalfFloat } from '../util/Convert';
/**
 * HDR Texture
 * @group Texture
 */
export class HDRTexture extends Texture {

    constructor() {
        super(32, 32, null);
        this.isHDRTexture = true;
    }

    /**
     * fill this texture by array of numbers;the format as [red0, green0, blue0, e0, red1, green1, blue1, e1...]
     * @param width assign the texture width
     * @param height assign the texture height
     * @param data color of each pixel
     * @param useMipmap gen mipmap or not
     * @returns
     */
    public create(width: number = 32, height: number = 32, data: ArrayBuffer = null, useMipmap: boolean = true, ctx?: Context3D): this {
        this.width = width;
        this.height = height;
        this._ensureBound(ctx);
        let device = this._boundCtx!.device;

        this.format = GPUTextureFormat.rgba16float;
        this.useMipmap = useMipmap;

        this.updateTextureDescription();

        this.updateGPUTexture();

        // `data` holds raw RGBE bytes (4 B/px, shared exponent). Decode to
        // rgba16float on the CPU — the bytes were previously copied
        // bit-for-bit as if they already were half floats, which both
        // failed the copy size validation (needs 8 B/px) and would have
        // produced noise. writeTexture also lifts the 256-byte row
        // alignment restriction of copyBufferToTexture.
        const rgbe = new Uint8Array(data);
        const pixelCount = width * height;
        const half = new Uint16Array(pixelCount * 4);
        const HALF_ONE = toHalfFloat(1);
        for (let i = 0; i < pixelCount; i++) {
            const s = i * 4;
            const e = rgbe[s + 3];
            const scale = Math.pow(2.0, e - 128.0) / 255.0;
            half[s + 0] = toHalfFloat(rgbe[s + 0] * scale);
            half[s + 1] = toHalfFloat(rgbe[s + 1] * scale);
            half[s + 2] = toHalfFloat(rgbe[s + 2] * scale);
            half[s + 3] = HALF_ONE;
        }
        device.queue.writeTexture(
            { texture: this.getGPUTexture() },
            half,
            { bytesPerRow: width * 4 * 2, rowsPerImage: height },
            { width: width, height: height, depthOrArrayLayers: 1 },
        );

        if (!this.useMipmap) {
            this.samplerBindingLayout.type = `filtering`;
            this.textureBindingLayout.sampleType = `float`;
        }

        this.gpuSampler = device.createSampler(this);

        // if (this.useMipmap && this.mipmapCount > 1) TextureMipmapGenerator.webGPUGenerateMipmap(this);

        return this;
    }


    /**
     * load one hdr image
     * @param url the url of hdr image
     * @param loaderFunctions callback when load complete
     * @returns
     */
    public async load(url: string, loaderFunctions?: LoaderFunctions, ctx?: Context3D): Promise<HDRTexture> {
        let loader = new FileLoader(ctx);
        let parser = await loader.load(url, RGBEParser, loaderFunctions);
        return parser.getHDRTexture();
    }
}
