import { GPUAddressMode, GPUFilterMode } from '../../WebGPUConst';
import { TextureMipmapGenerator } from './TextureMipmapGenerator';
import { Context3D, webGPUContext, perContextResource } from '../../Context3D';

/**
 * Texture — CPU-authoritative scene-graph object. GPU resources
 * (`gpuTexture`, `view`, `gpuSampler`, `gpuSampler_comparison`) are
 * context-local: writes land on the currently-active `Context3D`'s slot,
 * reads return the slot for the active context. This lets the same
 * Texture instance participate in multiple Engine3D instances with each
 * engine owning its own device-local GPU copy.
 * @group Texture
 */
export class Texture implements GPUSamplerDescriptor {

    /**
     * name of texture
     */
    public name: string;

    /**
     * source url
     */
    public url: string;

    /**
     * gpu texture (per-Context3D). Reads auto-materialize against the
     * currently-active Context3D if a descriptor is set: the first access
     * from a new context creates the GPUTexture and replays the source
     * image upload (if any) so the texture is usable immediately.
     */
    private _gpuTextures: Map<Context3D, GPUTexture> = new Map();
    protected get gpuTexture(): GPUTexture {
        let t = this._gpuTextures.get(webGPUContext);
        if (!t && this.textureDescriptor) {
            t = webGPUContext.device.createTexture(this.textureDescriptor);
            this._gpuTextures.set(webGPUContext, t);
            this._uploadSourceImage(t);
        }
        return t;
    }
    protected set gpuTexture(v: GPUTexture) {
        if (v == null) this._gpuTextures.delete(webGPUContext);
        else this._gpuTextures.set(webGPUContext, v);
    }

    /**
     * Return index in texture array
     */
    public pid: number;

    /**
     * GPUTextureView (per-Context3D). Reads auto-materialize from
     * `viewDescriptor` against the currently-active context when the
     * underlying gpuTexture is a real GPUTexture (not an external one).
     */
    private _views: Map<Context3D, GPUTextureView | GPUExternalTexture> = new Map();
    public get view(): GPUTextureView | GPUExternalTexture {
        let v = this._views.get(webGPUContext);
        if (!v && this.viewDescriptor) {
            const t = this.gpuTexture;
            if (t instanceof GPUTexture) {
                v = t.createView(this.viewDescriptor);
                if (this.name) (v as GPUTextureView).label = this.name;
                this._views.set(webGPUContext, v);
            }
        }
        return v;
    }
    public set view(v: GPUTextureView | GPUExternalTexture) {
        if (v == null) this._views.delete(webGPUContext);
        else this._views.set(webGPUContext, v);
    }

    /**
     * GPUSampler (per-Context3D). Auto-materializes using this Texture as
     * its own GPUSamplerDescriptor the first time each context asks.
     */
    private _gpuSamplers: Map<Context3D, GPUSampler> = new Map();
    public get gpuSampler(): GPUSampler {
        let s = this._gpuSamplers.get(webGPUContext);
        if (!s) {
            s = webGPUContext.device.createSampler(this);
            this._gpuSamplers.set(webGPUContext, s);
        }
        return s;
    }
    public set gpuSampler(v: GPUSampler) {
        if (v == null) this._gpuSamplers.delete(webGPUContext);
        else this._gpuSamplers.set(webGPUContext, v);
    }

    /**
     * GPUSampler for comparison (per-Context3D). Auto-materializes with
     * `compare: 'less'` when the format/binding requests a comparison
     * sampler (depth textures) and no explicit sampler has been set.
     */
    private _gpuSamplers_cmp: Map<Context3D, GPUSampler> = new Map();
    public get gpuSampler_comparison(): GPUSampler {
        let s = this._gpuSamplers_cmp.get(webGPUContext);
        if (!s) {
            s = webGPUContext.device.createSampler({
                compare: this._compare || 'less',
                label: 'sampler_comparison',
            });
            this._gpuSamplers_cmp.set(webGPUContext, s);
        }
        return s;
    }
    public set gpuSampler_comparison(v: GPUSampler) {
        if (v == null) this._gpuSamplers_cmp.delete(webGPUContext);
        else this._gpuSamplers_cmp.set(webGPUContext, v);
    }

    /**
     * GPUTextureFormat
     */
    public format: GPUTextureFormat;

    /**
     * GPUTextureUsage
     */
    public usage: GPUFlagsConstant;

    /**
     * texture width
     */
    public width: number = 4;

    /**
     * texture height
     */
    public height: number = 4;

    /**
     * depth or layers, default value is 1
     */
    public depthOrArrayLayers: number = 1;

    /**
     * depth or layers, default value is 1
     */
    public numberLayer: number = 1;

    /**
     * GPUTextureViewDescriptor
     */
    public viewDescriptor: GPUTextureViewDescriptor;

    /**
     * GPUTextureDescriptor
     */
    public textureDescriptor: GPUTextureDescriptor;

    /**
     * GPUShaderStage
     */
    public visibility: number = GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;


    /**
     * GPUTextureBindingLayout, contains viewDimension and multisampled
     */
    public textureBindingLayout: GPUTextureBindingLayout = {
        viewDimension: `2d`,
        multisampled: false,
    };

    /**
     * GPUSamplerBindingLayout
     */
    public samplerBindingLayout: GPUSamplerBindingLayout = {
        type: `filtering`,
    };

    /**
     * GPUSamplerBindingLayout
     */
    public sampler_comparisonBindingLayout: GPUSamplerBindingLayout = {
        type: `comparison`,
    };

    /**
     * whether to flip the image on the y-axis
     */
    public flipY: boolean;

    /**
     *  whether is video texture
     */
    public isVideoTexture?: boolean;
    public isHDRTexture?: boolean;

    private _useMipmap: boolean = false;

    private _sourceImageData: HTMLCanvasElement | ImageBitmap | OffscreenCanvas;

    //****************************************/
    /**
    */
    private _addressModeU?: GPUAddressMode;

    /**
     * 
     */
    private _addressModeV?: GPUAddressMode;

    /**
     * Specifies the {{GPUAddressMode|address modes}} for the texture width, height, and depth
     * coordinates, respectively.
     */
    private _addressModeW?: GPUAddressMode;

    /**
     * Specifies the sampling behavior when the sample footprint is smaller than or equal to one
     * texel.
     */
    private _magFilter?: GPUFilterMode;

    /**
     * Specifies the sampling behavior when the sample footprint is larger than one texel.
     */
    private _minFilter?: GPUFilterMode;

    /**
     * Specifies behavior for sampling between mipmap levels.
     */
    private _mipmapFilter?: GPUMipmapFilterMode;

    /**
    */
    private _lodMinClamp?: number;

    /**
     * Specifies the minimum and maximum levels of detail, respectively, used internally when
     * sampling a texture.
     */
    private _lodMaxClamp?: number;

    /**
     * When provided the sampler will be a comparison sampler with the specified
     * {@link GPUCompareFunction}.
     * Note: Comparison samplers may use filtering, but the sampling results will be
     * implementation-dependent and may differ from the normal filtering rules.
     */
    private _compare?: GPUCompareFunction;

    /**
     * Specifies the maximum anisotropy value clamp used by the sampler.
     * Note: Most implementations support {@link GPUSamplerDescriptor#maxAnisotropy} values in range
     * between 1 and 16, inclusive. The used value of {@link GPUSamplerDescriptor#maxAnisotropy} will
     * be clamped to the maximum value that the platform supports.
     */
    private _maxAnisotropy?: number;

    /**
     *  mipmap Count, default value is 1
     */
    public mipmapCount: number = 1;

    protected _textureChange: boolean = false;

    /**
     * Create a texture2D
     * @param width size of texture width
     * @param height height of texture width
     * @param numberLayer number layer of texture
     * @returns
     */
    constructor(width: number = 32, height: number = 32, numberLayer: number = 1) {
        this.width = width;
        this.height = height;
        this.numberLayer = numberLayer;

        this.minFilter = GPUFilterMode.linear;
        this.magFilter = GPUFilterMode.linear;
        this.mipmapFilter = GPUFilterMode.linear;
        this.addressModeU = GPUAddressMode.repeat;
        this.addressModeV = GPUAddressMode.repeat;
        // this.visibility = GPUShaderStage.FRAGMENT;
    }

    public init(): this {
        let self = this;
        if (self[`internalCreateBindingLayoutDesc`]) {
            self[`internalCreateBindingLayoutDesc`]();
        }
        if (self[`internalCreateTexture`]) {
            self[`internalCreateTexture`]();
        }
        if (self[`internalCreateView`]) {
            self[`internalCreateView`]();
        }
        if (self[`internalCreateSampler`]) {
            self[`internalCreateSampler`]();
        }
        return this;
    }

    /**
     * creatTextureDescriptor
     */
    protected createTextureDescriptor(
        width: number,
        height: number,
        mipLevelCount: number,
        format: GPUTextureFormat,
        usage: number = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.STORAGE_BINDING,
        sizeCount: number = 1,
        sampleCount: number = 0,
    ) {
        this.width = width;
        this.height = height;
        this.format = format;
        this.usage = usage;
        this.textureDescriptor = {
            size: [width, height, sizeCount],
            mipLevelCount: mipLevelCount,
            format: format,
            usage: usage,
            label: `${this.name + this.width + this.height + this.format}`
        };

        if (sampleCount > 0) {
            this.textureDescriptor.sampleCount = sampleCount;
        }

        if (sizeCount > 1) {
            this.viewDescriptor = {
                format: format,
                dimension: `2d-array`,
            };
        } else {
            this.viewDescriptor = {
                format: format,
                dimension: this.textureBindingLayout.viewDimension,
                mipLevelCount: mipLevelCount,
                baseMipLevel: 0
            };
        }
    }

    protected generate(imageBitmap: HTMLCanvasElement | ImageBitmap | OffscreenCanvas) {
        let width = 32;
        let height = 32;

        if ('width' in imageBitmap) {
            width = imageBitmap.width;
            height = imageBitmap.height;
        }

        if (width < 32 || height < 32) {
            console.log(imageBitmap['name'] + 'Size must be greater than 32!');
        }

        this.width = width;
        this.height = height;

        // this.visibility = GPUShaderStage.FRAGMENT;

        this.createTexture(imageBitmap);
    }

    private createTexture(imageBitmap: HTMLCanvasElement | ImageBitmap | OffscreenCanvas) {
        this._sourceImageData = imageBitmap;
        this.updateTextureDescription();

        this.updateGPUTexture();

        // gpuTexture getter auto-uploads _sourceImageData for fresh slots,
        // so accessing it here materializes the current context's copy.
        const tex = this.gpuTexture;
        if (tex instanceof GPUTexture && this.useMipmap) {
            TextureMipmapGenerator.webGPUGenerateMipmap(this);
        }
    }

    /**
     * Upload the cached source image (if any) into the given GPU texture.
     * Called from the gpuTexture getter when materializing a fresh slot on
     * a new Context3D so multi-engine users don't have to re-issue loads.
     */
    private _uploadSourceImage(tex: GPUTexture) {
        if (!this._sourceImageData) return;
        webGPUContext.device.queue.copyExternalImageToTexture(
            { source: this._sourceImageData },
            { texture: tex },
            [this.width, this.height],
        );
    }

    /**
     * enable/disable mipmap
     */
    public get useMipmap(): boolean {
        return this._useMipmap;
    }

    /**
     * get mipmap
     */
    public set useMipmap(value: boolean) {
        if (value) {
            this.samplerBindingLayout.type = 'filtering';
            if (this._useMipmap == false && this._sourceImageData) {
                this._useMipmap = true;
                this.updateTextureDescription();
                this.updateGPUTexture();

                if (this.gpuTexture instanceof GPUTexture) {
                    TextureMipmapGenerator.webGPUGenerateMipmap(this);
                }
            }
        } else {
            this.samplerBindingLayout.type = 'non-filtering';
            if (this._useMipmap == true && this._sourceImageData) {
                this._useMipmap = false;
                this.updateTextureDescription();
                this.updateGPUTexture();
                // gpuTexture getter re-uploads _sourceImageData on access.
                void this.gpuTexture;
            }
        }

        this._textureChange = true;
        this._useMipmap = value;
        this.noticeChange();
    }

    public get sourceImageData() {
        return this._sourceImageData;
    }

    public getMipmapCount() {
        let w = this.width;
        let h = this.height;
        let maxSize = Math.max(w, h);
        return 1 + Math.log2(maxSize) | 0;
    }

    protected updateTextureDescription() {
        // let mipmapCount = this.useMipmap ? Math.floor(Math.log2(this.width)) : 1;
        this.mipmapCount = Math.floor(this.useMipmap ? this.getMipmapCount() : 1);
        this.createTextureDescriptor(this.width, this.height, this.mipmapCount, this.format);
    }

    protected updateGPUTexture() {
        // Descriptor changed: destroy the GPU texture on every context this
        // Texture has been materialized on and invalidate all views/samplers.
        // The next access on each context re-materializes lazily from the
        // current descriptor via the gpuTexture/view/gpuSampler getters.
        for (const t of this._gpuTextures.values()) {
            if (t instanceof GPUTexture) {
                try { t.destroy(); } catch { /* ignore */ }
            }
        }
        this._gpuTextures.clear();
        this._views.clear();
        this._gpuSamplers.clear();
        this._gpuSamplers_cmp.clear();
    }

    /**
     * create or get GPUTexture (delegates to the per-context gpuTexture
     * getter, which handles lazy creation + source-image upload).
     */
    public getGPUTexture() {
        return this.gpuTexture;
    }

    /**
     * create or get GPUTextureView (delegates to the per-context view
     * getter, which handles lazy creation from `viewDescriptor`).
     */
    public getGPUView(_index: number = 0): GPUTextureView | GPUExternalTexture {
        return this.view;
    }

    protected _stateChangeRef: Map<any, Function> = new Map();

    public bindStateChange(fun: Function, ref: any) {
        this._stateChangeRef.set(ref, fun);
    }

    public unBindStateChange(ref: any) {
        this._stateChangeRef.delete(ref);
    }

    protected noticeChange() {
        // Descriptor-affecting change: drop every context's cached sampler
        // so the next access rebuilds from the updated GPUSamplerDescriptor.
        this._gpuSamplers.clear();
        this._gpuSamplers_cmp.clear();
        this._stateChangeRef.forEach((v) => {
            v();
        });
    }

    /**
     * release the texture on every context it's materialized on
     */
    public destroy(force?: boolean) {
        if (force) {
            for (const t of this._gpuTextures.values()) {
                if (t instanceof GPUTexture) {
                    try { t.destroy(); } catch { /* ignore */ }
                }
            }
            this._gpuTextures.clear();
            this._views.clear();
            this._gpuSamplers.clear();
            this._gpuSamplers_cmp.clear();
            this.textureBindingLayout = null;
            this.textureDescriptor = null;
        }
        this._stateChangeRef.clear();
    }

    public get addressModeU(): GPUAddressMode {
        return this._addressModeU;
    }

    public set addressModeU(value: GPUAddressMode) {
        if (this._addressModeU != value) {
            this._addressModeU = value;
            this.noticeChange();
        }
    }

    public get addressModeV(): GPUAddressMode {
        return this._addressModeV;
    }

    public set addressModeV(value: GPUAddressMode) {
        if (this._addressModeV != value) {
            this._addressModeV = value;
            this.noticeChange();
        }
    }

    public get addressModeW(): GPUAddressMode {
        return this._addressModeW;
    }

    public set addressModeW(value: GPUAddressMode) {
        if (this._addressModeW != value) {
            this._addressModeW = value;
            this.noticeChange();
        }
    }

    public get magFilter(): GPUFilterMode {
        return this._magFilter;
    }

    public set magFilter(value: GPUFilterMode) {
        if (this._magFilter != value) {
            this._magFilter = value;
            this.noticeChange();
        }
    }

    public get minFilter(): GPUFilterMode {
        return this._minFilter;
    }

    public set minFilter(value: GPUFilterMode) {
        if (this._minFilter != value) {
            this._minFilter = value;
            this.noticeChange();
        }
    }

    public get mipmapFilter(): GPUMipmapFilterMode {
        return this._mipmapFilter;
    }

    public set mipmapFilter(value: GPUMipmapFilterMode) {
        if (this._mipmapFilter != value) {
            this._mipmapFilter = value;
            this.noticeChange();
        }
    }

    public get lodMinClamp(): number {
        return this._lodMinClamp;
    }

    public set lodMinClamp(value: number) {
        if (this._lodMinClamp != value) {
            this._lodMinClamp = value;
            this.noticeChange();
        }
    }

    public get lodMaxClamp(): number {
        return this._lodMaxClamp;
    }

    public set lodMaxClamp(value: number) {
        if (this._lodMaxClamp != value) {
            this._lodMaxClamp = value;
            this.noticeChange();
        }
    }

    public get compare(): GPUCompareFunction {
        return this._compare;
    }

    public set compare(value: GPUCompareFunction) {
        if (this._compare != value) {
            this._compare = value;
            this.noticeChange();
        }
    }

    public get maxAnisotropy(): number {
        return this._maxAnisotropy;
    }

    public set maxAnisotropy(value: number) {
        if (this._maxAnisotropy != value) {
            this._maxAnisotropy = value;
            this.noticeChange();
        }
    }

    private static _texsStore = perContextResource<GPUTexture[]>();
    private static _texs(): GPUTexture[] {
        return this._texsStore(() => []);
    }
    public static delayDestroyTexture(tex: GPUTexture) {
        let list = this._texs();
        if (!list.includes(tex)) {
            list.push(tex);
        }
    }

    public static destroyTexture() {
        let list = this._texs();
        if (list.length > 0) {
            while (list.length > 0) {
                list.shift().destroy();
            }
        }
    }
}
