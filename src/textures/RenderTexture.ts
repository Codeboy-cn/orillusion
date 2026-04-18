import { Texture } from '../gfx/graphics/webGpu/core/texture/Texture';
import { GPUAddressMode, GPUTextureFormat } from '../gfx/graphics/webGpu/WebGPUConst';
import { Context3D } from '../gfx/graphics/webGpu/Context3D';
import { UUID } from '../util/Global';
import { CResizeEvent } from '..';
/**
 * @internal
 * Render target texture 
 * Render what we want to render onto a texture instead of rendering it onto the screen as we usually do
 * @group Texture
 */
export class RenderTexture extends Texture {
    public resolveTarget: GPUTextureView;

    sampleCount: number;
    autoResize?: boolean;
    clear?: boolean;
    /**
     * create virtual texture
     * @param width width of texture
     * @param height height of texture
     * @param format GPUTextureFormat, default value is rgba8unorm
     * @param useMipmap whether or not gen mipmap
     * @returns
     */
    constructor(width: number, height: number,
        format: GPUTextureFormat = GPUTextureFormat.rgba8unorm,
        useMipMap: boolean = false, usage?: GPUFlagsConstant,
        numberLayer: number = 1, sampleCount: number = 0,
        clear: boolean = true, autoResize: boolean = true,
        ctx?: Context3D) {

        super(width, height, numberLayer);
        this.name = UUID();

        this.autoResize = autoResize;
        this.useMipmap = useMipMap;
        this.sampleCount = sampleCount;
        this.format = format;
        this.numberLayer = numberLayer;
        this.clear = clear;

        if (usage != undefined) {
            this.usage = usage;
        } else {
            this.usage = usage | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
        }

        this.resize(width, height, ctx);

        if (this.autoResize) {
            this._boundCtx!.addEventListener(CResizeEvent.RESIZE, (e) => {
                let { width, height } = e.data;
                this.resize(width, height);
                this._textureChange = true;
            }, this);
        }
    }

    public resize(width, height, ctx?: Context3D) {
        this._ensureBound(ctx);
        let device = this._boundCtx!.device;
        if (this.gpuTexture) {
            Texture.delayDestroyTexture(this._boundCtx!, this.gpuTexture);
            this.gpuTexture = null;
            this.view = null;
        }

        this.width = width;
        this.height = height;

        this.createTextureDescriptor(width, height, 1, this.format, this.usage, this.numberLayer, this.sampleCount);
        // this.loadOp = clear ? `clear` : `load`
        // this.loadOp = `clear`

        this.useMipmap = false;

        this.visibility = GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;

        if (this.format == GPUTextureFormat.rgba32float) {
            this.samplerBindingLayout.type = `non-filtering`;
            this.textureBindingLayout.sampleType = `unfilterable-float`;
            this.gpuSampler = device.createSampler({});
        } else if (this.format == GPUTextureFormat.depth32float) {
            this.samplerBindingLayout.type = `filtering`;
            this.sampler_comparisonBindingLayout.type = `comparison`;
            this.textureBindingLayout.sampleType = `depth`;
            this.gpuSampler = device.createSampler({});
            this.gpuSampler_comparison = device.createSampler({
                compare: 'less',
                label: "sampler_comparison"
            });
        } else if (this.format == GPUTextureFormat.depth24plus) {
            this.samplerBindingLayout = {
                type: `filtering`,
            }
            this.sampler_comparisonBindingLayout = {
                type: 'comparison',
            }
            this.textureBindingLayout.sampleType = `depth`;
            this.gpuSampler = device.createSampler({});
            this.gpuSampler_comparison = device.createSampler({
                compare: 'less',
                label: "sampler_comparison"
            });
        } else {
            this.samplerBindingLayout.type = `filtering`;
            this.textureBindingLayout.sampleType = `float`;
            if (this.sampleCount > 0) {
                this.textureBindingLayout.multisampled = true;
            }
            this.minFilter = 'linear';
            this.magFilter = 'linear';
            this.mipmapFilter = `linear`;
            // this.maxAnisotropy = 16;

            this.addressModeU = GPUAddressMode.clamp_to_edge;
            this.addressModeV = GPUAddressMode.clamp_to_edge;
            // this.visibility = GPUShaderStage.FRAGMENT;
            this.gpuSampler = device.createSampler(this);
        }

        this._textureChange = true;
    }

    /**
    * create rt texture
    * @param width texture width
    * @param height texture height
    * @param data  texture pixel data
    * @param useMipmap texture use mipmap switch
    * @returns
    */
    public create(width: number, height: number, useMiamp: boolean = true) {
        let device = this._boundCtx!.device;
        const bytesPerRow = width * 4;
        let td = new Float32Array(width * height * 4);

        const textureDataBuffer = device.createBuffer({
            size: td.byteLength,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });

        device.queue.writeBuffer(textureDataBuffer, 0, td);
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
    }

    public clone() {
        let texture = new RenderTexture(this.width, this.height, this.format, this.useMipmap, this.usage, this.numberLayer, this.sampleCount, this.clear, this.autoResize);
        texture.name = "clone_" + texture.name;
        return texture;
    }

    public readTextureToImage() {
        const ctx = this._boundCtx!;
        let device = ctx.device;
        let w = ctx.windowWidth;
        let h = ctx.windowHeight;
        const bytesPerRow = w * 4;
        let td = new Float32Array(w * h * 4);

        const textureBuffer = device.createBuffer({
            size: td.byteLength,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        const commandEncoder = ctx.gpuContext.beginCommandEncoder();
        commandEncoder.copyTextureToBuffer(
            {
                texture: this.getGPUTexture()
            },
            {
                buffer: textureBuffer
            },
            [w, h]
        );

        let arryBuffer = textureBuffer.getMappedRange(0, td.byteLength);
        return arryBuffer;
    }

}
