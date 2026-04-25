import { HiZ_Init_cs, HiZ_Reduce_cs } from '../../../../assets/shader/compute/HiZGenerate_cs';
import { Context3D } from '../../../graphics/webGpu/Context3D';
import { GPUTextureFormat } from '../../../graphics/webGpu/WebGPUConst';
import { RenderTexture } from '../../../../textures/RenderTexture';
import { GBufferFrame } from '../../frame/GBufferFrame';
import { FeatureContext, RenderFeature } from '../RenderFeature';
import { RenderStage } from '../RenderStage';

export const HIZ_PYRAMID = '_HiZPyramid';

/**
 * Hi-Z depth pyramid generation. Reads `gBuffer.x` from the compressed
 * GBuffer; writes a r16float mip chain where each mip stores the
 * **maximum** NDC z over its 2×2 footprint. Downstream consumers
 * (GPU occlusion culling, SSR cone-trace, Volumetric Fog visibility)
 * sample the pyramid at a mip level matching the screen-space size of
 * their query for log2(N) lookups instead of per-pixel ray marches.
 *
 * Two pipelines:
 *  - `HiZ_Init_cs`: extracts depth from compressGBuffer.x into pyramid
 *    mip 0 at full scene resolution.
 *  - `HiZ_Reduce_cs`: 2×2 max reduction from mip N to mip N+1.
 *
 * Per-frame: one init dispatch + (numMips-1) reduction dispatches.
 *
 * @group Graph
 */
export class HiZFeature extends RenderFeature {
    public readonly name = 'HiZFeature';
    public readonly stage = RenderStage.HiZ;
    public readonly reads: readonly string[] = [];
    public readonly writes = [HIZ_PYRAMID];

    private readonly _ctx: Context3D;
    private _pyramid: RenderTexture | null = null;
    private _numMips: number = 1;
    private _initPipeline: GPUComputePipeline | null = null;
    private _reducePipeline: GPUComputePipeline | null = null;
    private _bindGroupLayout: GPUBindGroupLayout | null = null;
    private _initBindGroup: GPUBindGroup | null = null;
    private _reduceBindGroups: GPUBindGroup[] = [];

    constructor(ctx: Context3D) {
        super();
        this._ctx = ctx;
    }

    public registerResources(pool: { registerExternal<T>(name: string, getter: () => T): void }): void {
        pool.registerExternal<RenderTexture>(HIZ_PYRAMID, () => this._getOrAllocate());
    }

    private _mipCount(w: number, h: number): number {
        return 1 + Math.floor(Math.log2(Math.max(w, h)));
    }

    private _getOrAllocate(): RenderTexture {
        const depthTex = GBufferFrame.getGBufferFrame(GBufferFrame.colorPass_GBuffer, this._ctx).depthTexture;
        const w = depthTex.width;
        const h = depthTex.height;
        const wantMips = this._mipCount(w, h);
        if (this._pyramid && this._pyramid.width === w && this._pyramid.height === h && this._numMips === wantMips) {
            return this._pyramid;
        }
        // r32float is in WebGPU's default storage-texture format set
        // (r16float is NOT — needs the `r16float-renderable` proposal).
        // Single channel; precision more than sufficient for [0,1] NDC z.
        // RenderTexture's useMipmap path is unreliable for storage RTs,
        // so build the descriptor directly with the explicit mip count.
        this._pyramid = new RenderTexture(
            w, h, GPUTextureFormat.r32float,
            true, // useMipMap (constructor flag — actual mipLevelCount is forced below)
            GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
            1, 0, false, true, this._ctx,
        );
        // Force the texture descriptor to actually carry the mip chain
        // (RenderTexture.resize internally toggles useMipmap=false).
        const desc = (this._pyramid as any).textureDescriptor as GPUTextureDescriptor;
        if (desc) {
            (desc as any).mipLevelCount = wantMips;
            // Discard any auto-built non-mip GPU texture so re-access
            // through `gpuTexture` materialises with the right level count.
            (this._pyramid as any).gpuTexture = null;
            (this._pyramid as any).view = null;
        }
        this._pyramid.name = HIZ_PYRAMID;
        this._numMips = wantMips;
        // Force a re-bind on next execute since the pyramid identity
        // (and thus its views) changed.
        this._initBindGroup = null;
        this._reduceBindGroups = [];
        return this._pyramid;
    }

    private _ensurePipelines(): void {
        if (this._initPipeline && this._reducePipeline && this._bindGroupLayout) return;
        const device = this._ctx.device;
        // One layout reused by both pipelines (they have identical
        // bindings — sampleable input + storage write output).
        this._bindGroupLayout = device.createBindGroupLayout({
            label: 'HiZBindGroupLayout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float', viewDimension: '2d' } },
            ],
        });
        const pipelineLayout = device.createPipelineLayout({
            label: 'HiZPipelineLayout',
            bindGroupLayouts: [this._bindGroupLayout],
        });
        this._initPipeline = device.createComputePipeline({
            label: 'HiZ_Init',
            layout: pipelineLayout,
            compute: {
                module: device.createShaderModule({ code: HiZ_Init_cs }),
                entryPoint: 'CsMain',
            },
        });
        this._reducePipeline = device.createComputePipeline({
            label: 'HiZ_Reduce',
            layout: pipelineLayout,
            compute: {
                module: device.createShaderModule({ code: HiZ_Reduce_cs }),
                entryPoint: 'CsMain',
            },
        });
    }

    private _ensureBindGroups(): void {
        if (this._initBindGroup && this._reduceBindGroups.length === this._numMips - 1) return;
        const device = this._ctx.device;
        const pyramid = this._pyramid!;
        const compressGBuffer = GBufferFrame.getGBufferFrame(GBufferFrame.colorPass_GBuffer, this._ctx).getCompressGBufferTexture();

        // Init bind group: input = compressGBuffer (full mip view via
        // its default view); output = pyramid mip 0.
        this._initBindGroup = device.createBindGroup({
            label: 'HiZ_InitBG',
            layout: this._bindGroupLayout!,
            entries: [
                { binding: 0, resource: compressGBuffer.getGPUTexture().createView({ format: compressGBuffer.format, dimension: '2d', baseMipLevel: 0, mipLevelCount: 1 }) },
                { binding: 1, resource: pyramid.getGPUTexture().createView({ format: pyramid.format, dimension: '2d', baseMipLevel: 0, mipLevelCount: 1 }) },
            ],
        });

        // Reduce bind groups, one per (mip N → mip N+1).
        this._reduceBindGroups = [];
        for (let i = 0; i < this._numMips - 1; i++) {
            const srcView = pyramid.getGPUTexture().createView({
                format: pyramid.format, dimension: '2d',
                baseMipLevel: i, mipLevelCount: 1,
            });
            const dstView = pyramid.getGPUTexture().createView({
                format: pyramid.format, dimension: '2d',
                baseMipLevel: i + 1, mipLevelCount: 1,
            });
            this._reduceBindGroups.push(device.createBindGroup({
                label: `HiZ_ReduceBG_mip${i + 1}`,
                layout: this._bindGroupLayout!,
                entries: [
                    { binding: 0, resource: srcView },
                    { binding: 1, resource: dstView },
                ],
            }));
        }
    }

    public execute(_ctx: FeatureContext): void {
        this._getOrAllocate();
        this._ensurePipelines();
        this._ensureBindGroups();
        const gpu = this._ctx.gpuContext;
        const command = gpu.beginCommandEncoder();
        const pass = command.beginComputePass({ label: 'HiZGenerate' });

        // Init: extract depth into mip 0 at full scene resolution.
        const w = this._pyramid!.width;
        const h = this._pyramid!.height;
        pass.setPipeline(this._initPipeline!);
        pass.setBindGroup(0, this._initBindGroup!);
        pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8), 1);

        // Reduce per mip.
        let mipW = Math.max(1, w >> 1);
        let mipH = Math.max(1, h >> 1);
        pass.setPipeline(this._reducePipeline!);
        for (let i = 0; i < this._reduceBindGroups.length; i++) {
            pass.setBindGroup(0, this._reduceBindGroups[i]);
            pass.dispatchWorkgroups(Math.max(1, Math.ceil(mipW / 8)), Math.max(1, Math.ceil(mipH / 8)), 1);
            mipW = Math.max(1, mipW >> 1);
            mipH = Math.max(1, mipH >> 1);
        }
        pass.end();
        gpu.endCommandEncoder(command);
    }
}
