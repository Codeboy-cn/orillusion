import { RenderTexture } from '../../../textures/RenderTexture';
import { Context3D } from '../../graphics/webGpu/Context3D';
import { RTDescriptor } from '../../graphics/webGpu/descriptor/RTDescriptor';
import { RTFrame } from '../frame/RTFrame';
import { RTResourceMap } from '../frame/RTResourceMap';
import { RendererPassState } from '../passRenderer/state/RendererPassState';

/**
 * Per-color-attachment description.
 *
 * @group Graph
 */
export interface RTColorAttachmentDesc {
    /** Logical attachment name. Used as the sub-key in
     *  {@link RTResourceMap} when the RT allocates fresh, and as a
     *  human-readable label for debug. Inside one
     *  {@link RenderGraphRenderTargetDesc} every `name` must be unique. */
    name: string;
    format: GPUTextureFormat;
    /** Default clearValue used by the first writer's auto-clear path.
     *  Can be overridden per-`useRenderTarget` via
     *  {@link RenderPassOpenOptions.colorClearValues}. */
    clearValue?: GPUColor;
    /** Default storeOp. Defaults to `'store'`. */
    storeOp?: GPUStoreOp;
    /** Adopt mode: pre-existing texture. If provided the RT does not
     *  allocate a new one through {@link RTResourceMap}. */
    texture?: RenderTexture;
}

/**
 * Depth (+ optional stencil) attachment description.
 *
 * @group Graph
 */
export interface RTDepthAttachmentDesc {
    format: GPUTextureFormat;
    /** Default 1.0. */
    depthClearValue?: number;
    /** Default `'store'`. */
    depthStoreOp?: GPUStoreOp;
    stencilLoadOp?: GPULoadOp;
    stencilStoreOp?: GPUStoreOp;
    texture?: RenderTexture;
}

/**
 * Declarative description of a render target.
 *
 * @group Graph
 */
export interface RenderGraphRenderTargetDesc {
    label: string;
    /** 0 / undefined => canvas-sized; the underlying {@link RenderTexture}
     *  installs its own {@link CResizeEvent.RESIZE} listener so the GPU
     *  resource follows the canvas. */
    width?: number;
    height?: number;
    customSize?: boolean;
    /** MSAA sample count — 0 disables. Forwarded to
     *  {@link RTFrame.sampleCount} so
     *  {@link WebGPUDescriptorCreator.createRendererPassState} allocates
     *  matching side-band textures. */
    sampleCount?: number;
    colors: RTColorAttachmentDesc[];
    depth?: RTDepthAttachmentDesc;
    /** When true the RT participates in the canvas swapchain present
     *  path. Mirrors {@link RTFrame.isOutTarget}; default `false`. */
    isOutTarget?: boolean;
}

/**
 * Typed render target = color attachment(s) + (optional) depth +
 * creation description. Wraps {@link RTFrame} without replacing it —
 * the rtFrame field is still the single source of truth that
 * {@link WebGPUDescriptorCreator.createRendererPassState} consumes.
 *
 * Two construction modes:
 *
 * - **Adopt** via {@link fromRTFrame}: bind to an externally-allocated
 *   {@link RTFrame} (typical: {@link GBufferFrame}). The RT does not
 *   own the underlying {@link RenderTexture}s; cleanup is the source's
 *   responsibility.
 * - **Allocate** via {@link allocate}: allocate fresh
 *   {@link RenderTexture}s through {@link RTResourceMap.createRTTexture}
 *   (auto-resize via the texture's built-in resize handler) and
 *   compose them into a private {@link RTFrame}.
 *
 * Multi-writer rule: only one pass creates the RT (calls
 * `b.createRenderTarget` / `b.adoptRenderTarget`). Downstream passes
 * call `b.useRenderTarget(name, opts)` which records a mutator-write
 * and returns a {@link RenderGraphRenderPass} handle for that writer.
 *
 * @group Graph
 */
export class RenderGraphRenderTarget {
    /** Pool handle name. */
    public readonly name: string;
    public readonly desc: Readonly<RenderGraphRenderTargetDesc>;
    public readonly rtFrame: RTFrame;
    public readonly colorTextures: ReadonlyArray<RenderTexture>;
    public readonly depthTexture: RenderTexture | null;
    public readonly sampleCount: number;
    /** True if this RT owns the underlying textures (allocate mode).
     *  False for adopt mode — textures are owned by the upstream
     *  {@link RTFrame} source (e.g. {@link GBufferFrame}). */
    public readonly owned: boolean;

    /** Per-frame flag flipped by the first {@link RenderGraphRenderPass.begin}
     *  call against this RT, reset by {@link RenderGraph.execute} at the
     *  start of every frame. Drives the load-op auto-derive rule
     *  (first writer => 'clear' default, subsequent => 'load' default). */
    /** @internal */
    public _firstWriterFiredThisFrame: boolean = false;

    /** Cache of `(loadOp/clearValue combination)` → cloned {@link RTFrame}
     *  + cached {@link RendererPassState}. Keyed by a stable string built
     *  by {@link RenderGraphRenderPass}._stateKey. Each entry's
     *  clonedFrame.renderTargets array identity is stable across frames,
     *  so {@link WebGPUDescriptorCreator}'s internal `stateVersion` does
     *  not bump on every begin — only on actual rebuilds (e.g. resize). */
    /** @internal */
    public _stateCache: Map<string, { rtFrame: RTFrame; passState: RendererPassState }> = new Map();

    /** Names of passes that have called `b.useRenderTarget(this.name)`.
     *  Populated in registration order; used by tooling (`dumpDot`) and
     *  by the validator's dev-mode assertion. */
    /** @internal */
    public readonly _writers: string[] = [];

    /** Use {@link fromRTFrame} or {@link allocate} — direct construction
     *  is reserved for internal use. */
    constructor(
        name: string,
        desc: RenderGraphRenderTargetDesc,
        rtFrame: RTFrame,
        owned: boolean,
    ) {
        this.name = name;
        this.desc = desc;
        this.rtFrame = rtFrame;
        this.colorTextures = rtFrame.renderTargets;
        this.depthTexture = rtFrame.depthTexture ?? null;
        this.sampleCount = rtFrame.sampleCount | 0;
        this.owned = owned;
    }

    /**
     * Adopt an externally-allocated {@link RTFrame}. The wrapper does
     * not own the textures; only descriptor / cache state is reset on
     * {@link destroy}. Typical use: {@link GBufferResourcePass} wraps a
     * {@link GBufferFrame}.
     */
    public static fromRTFrame(
        name: string,
        rtFrame: RTFrame,
        opts?: { label?: string },
    ): RenderGraphRenderTarget {
        const colors: RTColorAttachmentDesc[] = rtFrame.renderTargets.map((tex, i) => ({
            name: tex.name || `color${i}`,
            format: tex.format,
            clearValue: rtFrame.rtDescriptors[i]?.clearValue,
            storeOp: rtFrame.rtDescriptors[i]?.storeOp as GPUStoreOp,
            texture: tex,
        }));
        const depth: RTDepthAttachmentDesc | undefined = rtFrame.depthTexture
            ? {
                format: rtFrame.depthTexture.format,
                depthClearValue: rtFrame.depthCleanValue,
                texture: rtFrame.depthTexture,
            }
            : undefined;
        const desc: RenderGraphRenderTargetDesc = {
            label: opts?.label ?? rtFrame.label ?? name,
            customSize: rtFrame.customSize,
            sampleCount: rtFrame.sampleCount,
            colors,
            depth,
            isOutTarget: rtFrame.isOutTarget,
        };
        return new RenderGraphRenderTarget(name, desc, rtFrame, /*owned*/ false);
    }

    /**
     * Allocate fresh textures via {@link RTResourceMap} (auto-resize
     * inherited) and assemble a private {@link RTFrame}. The
     * per-attachment cache key in `RTResourceMap` is
     * `"<rt-name>::<attachment-name>"` to avoid colliding with other
     * registries that use bare attachment names.
     */
    public static allocate(
        name: string,
        ctx: Context3D,
        desc: RenderGraphRenderTargetDesc,
    ): RenderGraphRenderTarget {
        const presentation = ctx.presentationSize;
        const width = desc.width && desc.width > 0 ? desc.width : presentation[0];
        const height = desc.height && desc.height > 0 ? desc.height : presentation[1];
        const sampleCount = desc.sampleCount ?? 0;

        const colorTextures: RenderTexture[] = [];
        const rtDescriptors: RTDescriptor[] = [];
        for (const c of desc.colors) {
            const tex = c.texture ?? RTResourceMap.createRTTexture(
                ctx,
                `${name}::${c.name}`,
                width,
                height,
                c.format,
                /*useMipmap*/ false,
                sampleCount,
            );
            colorTextures.push(tex);
            const rtDesc = new RTDescriptor();
            rtDesc.loadOp = 'clear';
            rtDesc.storeOp = (c.storeOp ?? 'store') as GPUStoreOp;
            rtDesc.clearValue = c.clearValue ?? [0, 0, 0, 0];
            rtDescriptors.push(rtDesc);
        }

        let depthTexture: RenderTexture | undefined;
        if (desc.depth) {
            depthTexture = desc.depth.texture ?? RTResourceMap.createRTTexture(
                ctx,
                `${name}::depth`,
                width,
                height,
                desc.depth.format,
                /*useMipmap*/ false,
                sampleCount,
            );
        }

        const rtFrame = new RTFrame(
            colorTextures,
            rtDescriptors,
            depthTexture,
            undefined,
            desc.isOutTarget ?? false,
        );
        rtFrame.label = desc.label;
        rtFrame.sampleCount = sampleCount;
        rtFrame.customSize = desc.customSize ?? false;
        if (desc.depth) {
            rtFrame.depthCleanValue = desc.depth.depthClearValue ?? 1;
        }
        return new RenderGraphRenderTarget(name, desc, rtFrame, /*owned*/ true);
    }

    /**
     * Release per-RT framework state. Owned textures are not destroyed
     * here — {@link RTResourceMap} retains them so that a subsequent
     * graph rebuild can reuse them without reallocating. Pass authors
     * that want explicit destruction must do it themselves.
     */
    public destroy(_ctx: Context3D): void {
        this._stateCache.clear();
        this._writers.length = 0;
        this._firstWriterFiredThisFrame = false;
    }
}
