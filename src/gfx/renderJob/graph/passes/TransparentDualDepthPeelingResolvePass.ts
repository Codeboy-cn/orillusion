import { DDPResolveShader } from '../../../../assets/shader/post/DDPResolveShader';
import { RenderTexture } from '../../../../textures/RenderTexture';
import { Context3D } from '../../../graphics/webGpu/Context3D';
import { RTResourceMap } from '../../frame/RTResourceMap';
import { RenderGraphBuilder, RenderGraphPass, RenderGraphPassContext } from '../RenderGraphPass';
import { RenderStage } from '../RenderStage';
import { COLOR_BUFFER } from './ColorPass';
import { DDP_FRONT_TEX } from './TransparentDualDepthPeelingPass';

/**
 * Composite the Dual Depth Peeling front-color attachment back into
 * `_ColorBuffer` via a full-screen pass with hardware blend
 * `(SRC=ONE, DST=ONE_MINUS_SRC_ALPHA)` — the over operator. Pairs
 * with {@link TransparentDualDepthPeelingPass}.
 *
 * Mirrors {@link TransparentResolvePass}'s shape (private pipeline,
 * fresh bind group per frame). Runs at AfterTransparent so it composites
 * after both WBOIT resolve and any sorted transparent pass.
 *
 * @group Graph
 */
export class TransparentDualDepthPeelingResolvePass extends RenderGraphPass {
    public readonly name = 'TransparentDualDepthPeelingResolvePass';
    public readonly stage = RenderStage.AfterTransparent;

    private _ctx!: Context3D;
    private _pipeline: GPURenderPipeline | null = null;
    private _bindGroupLayout: GPUBindGroupLayout | null = null;
    private _sampler: GPUSampler | null = null;

    public setup(b: RenderGraphBuilder): void {
        this._ctx = b.context3D;
        b.read(DDP_FRONT_TEX);
        b.write(COLOR_BUFFER);  // mutator: composite DDP front into ColorBuffer
    }

    private _ensurePipeline(colorBuffer: RenderTexture): void {
        if (this._pipeline) return;
        const device = this._ctx.device;
        const module = device.createShaderModule({
            label: 'DDPResolveShader',
            code: DDPResolveShader,
        });
        this._sampler = device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });
        this._bindGroupLayout = device.createBindGroupLayout({
            label: 'DDPResolveBindGroupLayout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
            ],
        });
        const pipelineLayout = device.createPipelineLayout({
            label: 'DDPResolvePipelineLayout',
            bindGroupLayouts: [this._bindGroupLayout],
        });
        this._pipeline = device.createRenderPipeline({
            label: 'DDPResolvePipeline',
            layout: pipelineLayout,
            vertex: { module, entryPoint: 'vs_main' },
            fragment: {
                module,
                entryPoint: 'fs_main',
                targets: [{
                    format: colorBuffer.format,
                    // Pre-multiplied over operator: front pass writes
                    // (rgb·α, α); hardware blend produces
                    // final = src.rgb·1 + dst·(1 - src.a)
                    blend: {
                        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                    },
                }],
            },
            primitive: { topology: 'triangle-list' },
        });
    }

    public execute(ctx: RenderGraphPassContext): void {
        const front = RTResourceMap.getTexture(this._ctx, DDP_FRONT_TEX);
        const colorBuffer = ctx.get<RenderTexture>(COLOR_BUFFER);
        if (!front || !colorBuffer) return;

        this._ensurePipeline(colorBuffer);

        const gpu = ctx.view.engine3D.context3D.gpuContext;
        const command = gpu.beginCommandEncoder();

        const bindGroup = this._ctx.device.createBindGroup({
            label: 'DDPResolveBindGroup',
            layout: this._bindGroupLayout!,
            entries: [
                { binding: 0, resource: this._sampler! },
                { binding: 1, resource: front.getGPUTexture().createView() },
            ],
        });

        const passDesc: GPURenderPassDescriptor = {
            label: 'DDPResolvePass',
            colorAttachments: [{
                view: colorBuffer.getGPUTexture().createView(),
                loadOp: 'load',
                storeOp: 'store',
                clearValue: [0, 0, 0, 0],
            }],
        };
        const encoder = command.beginRenderPass(passDesc);
        encoder.setPipeline(this._pipeline!);
        encoder.setBindGroup(0, bindGroup);
        encoder.draw(3, 1, 0, 0);
        encoder.end();
        gpu.endCommandEncoder(command);
    }
}
