import { WebGPUDescriptorCreator } from '../../graphics/webGpu/descriptor/WebGPUDescriptorCreator';
import { RTFrame } from '../frame/RTFrame';
import { RendererPassState } from '../passRenderer/state/RendererPassState';
import { RenderGraphPassContext } from './RenderGraphPass';
import { RenderGraphRenderTarget } from './RenderGraphRenderTarget';

/**
 * Per-call open options for a {@link RenderGraphRenderPass}.
 *
 * Any field left `undefined` (or any array slot left `undefined`)
 * defaults via the auto-derive rule:
 *
 *   - first writer of the RT this frame ⇒ `'clear'`
 *   - subsequent writer of the same RT ⇒ `'load'`
 *
 * Pass authors explicitly set a field when they need to override the
 * default — typical case is a `ClearDepthPass` mid-frame that wants
 * `depthLoadOp: 'clear'` even though it isn't the first writer.
 *
 * @group Graph
 */
export interface RenderPassOpenOptions {
    /** Per-color-attachment loadOp. Length matches the RT's color
     *  count. Each slot independently auto-derives when left
     *  `undefined`. */
    colorLoadOps?: (GPULoadOp | undefined)[];
    /** Optional override of per-attachment clearValue (defaults to the
     *  RT descriptor's clearValue). */
    colorClearValues?: GPUColor[];
    depthLoadOp?: GPULoadOp;
    depthClearValue?: number;
    stencilLoadOp?: GPULoadOp;
    /** Suffix appended to the underlying command encoder + render pass
     *  for devtools. Defaults to the owning pass name. */
    label?: string;
}

/**
 * Handle for "open a render pass on a {@link RenderGraphRenderTarget}".
 * Created in `setup()` via `b.useRenderTarget(name, opts)`; opened
 * each frame in `execute()` via `ctx.beginRenderPass(handle)`.
 *
 * One handle = one (owner pass × target × options) instance. The
 * framework caches one {@link RendererPassState} per distinct
 * (target, resolved-loadOp-combination) tuple on the target itself
 * — so two passes that resolve to the same options bucket share a
 * cached state (and the bundle cache built on top of it).
 *
 * Each `begin()` opens a **fresh** `GPUCommandEncoder` + render-pass
 * encoder. WebGPU does not need encoders to be shared across passes
 * for `loadOp='load'` chaining — the attachment contents are what
 * carry over, not the encoder identity.
 *
 * @group Graph
 */
export class RenderGraphRenderPass {
    public readonly name: string;
    public readonly ownerPassName: string;
    public readonly target: RenderGraphRenderTarget;
    public readonly options: Readonly<RenderPassOpenOptions>;

    /** Runtime — populated by {@link begin}, cleared by {@link end}. */
    public encoder: GPURenderPassEncoder | null = null;
    /** The cached {@link RendererPassState} this begin() resolved to.
     *  Pass authors thread it into {@link buildOpBundles} / `drawNodes`
     *  in place of the old shared `RendererPassState`. */
    public passState: RendererPassState | null = null;
    /** The fresh {@link GPUCommandEncoder} opened in {@link begin}.
     *  Closed in {@link end}. */
    public command: GPUCommandEncoder | null = null;

    constructor(
        name: string,
        ownerPassName: string,
        target: RenderGraphRenderTarget,
        options: RenderPassOpenOptions,
    ) {
        this.name = name;
        this.ownerPassName = ownerPassName;
        this.target = target;
        this.options = options;
    }

    /**
     * Resolve the final loadOp / clearValue combination, look up (or
     * build) the cached {@link RendererPassState}, open a fresh
     * `GPUCommandEncoder`, begin the render pass encoder on the
     * underlying target, and return the encoder. After this call the
     * caller can drive draws on `this.encoder` and read state from
     * `this.passState`.
     */
    public begin(ctx: RenderGraphPassContext): GPURenderPassEncoder {
        if (this.encoder) {
            throw new Error(`RenderGraphRenderPass '${this.name}': begin() called twice without end().`);
        }
        const engineCtx = ctx.view.engine3D.context3D;
        const target = this.target;

        // Resolve options against the auto-derive rule. The cache key
        // is built from the *resolved* values, so first-writer (clear)
        // and subsequent-writer (load) live in different buckets even
        // when the user passed no options.
        const firstWriter = !target._firstWriterFiredThisFrame;
        const colorCount = target.rtFrame.rtDescriptors.length;

        const resolvedColorLoadOps: GPULoadOp[] = new Array(colorCount);
        for (let i = 0; i < colorCount; i++) {
            const userOp = this.options.colorLoadOps?.[i];
            resolvedColorLoadOps[i] = userOp ?? (firstWriter ? 'clear' : 'load');
        }
        const resolvedDepthLoadOp: GPULoadOp =
            this.options.depthLoadOp ?? (firstWriter ? 'clear' : 'load');

        const key = this._stateKey(resolvedColorLoadOps, resolvedDepthLoadOp);
        let entry = target._stateCache.get(key);
        if (!entry) {
            // Clone the source rtFrame and stamp the resolved ops on
            // the clone so the cached RendererPassState in
            // WebGPUDescriptorCreator (keyed by rtFrame identity)
            // matches this options bucket alone.
            const clonedFrame = target.rtFrame.clone();
            clonedFrame.label = `${target.rtFrame.label ?? target.name}::${key}`;
            clonedFrame.depthLoadOp = resolvedDepthLoadOp;
            clonedFrame.depthCleanValue =
                this.options.depthClearValue ?? target.rtFrame.depthCleanValue;
            clonedFrame.sampleCount = target.rtFrame.sampleCount;
            clonedFrame.customSize = target.rtFrame.customSize;
            clonedFrame.isOutTarget = target.rtFrame.isOutTarget;
            for (let i = 0; i < colorCount; i++) {
                const d = clonedFrame.rtDescriptors[i];
                d.loadOp = resolvedColorLoadOps[i];
                const override = this.options.colorClearValues?.[i];
                if (override !== undefined) {
                    d.clearValue = override;
                }
            }
            const passState = WebGPUDescriptorCreator.createRendererPassState(engineCtx, clonedFrame);
            entry = { rtFrame: clonedFrame, passState };
            target._stateCache.set(key, entry);
        } else {
            // Re-call so any external resize-driven stateVersion bump
            // propagates into the cached entry (no-op when nothing
            // changed; the inner cache short-circuits by rtFrame
            // identity).
            WebGPUDescriptorCreator.createRendererPassState(engineCtx, entry.rtFrame);
        }

        const gpu = engineCtx.gpuContext;
        this.command = gpu.beginCommandEncoder();
        this.passState = entry.passState;
        this.encoder = gpu.beginRenderPass(this.command, this.passState);
        target._firstWriterFiredThisFrame = true;
        return this.encoder;
    }

    /**
     * End the render pass encoder and submit the per-pass command
     * buffer. Clears runtime fields so a stale handle from the
     * previous frame surfaces as a clear error rather than encoder
     * misuse.
     */
    public end(ctx: RenderGraphPassContext): void {
        const gpu = ctx.view.engine3D.context3D.gpuContext;
        if (this.encoder) gpu.endPass(this.encoder);
        if (this.command) gpu.endCommandEncoder(this.command);
        this.encoder = null;
        this.passState = null;
        this.command = null;
    }

    private _stateKey(colorLoadOps: GPULoadOp[], depthLoadOp: GPULoadOp): string {
        // Cheap stable serialization. Avoids JSON.stringify allocation
        // on the hot path while remaining deterministic across
        // identical option buckets.
        let s = '';
        for (let i = 0; i < colorLoadOps.length; i++) {
            s += colorLoadOps[i];
            s += '|';
        }
        s += depthLoadOp;
        s += '|';
        s += this.options.depthClearValue ?? '';
        s += '|';
        if (this.options.colorClearValues) {
            for (const cv of this.options.colorClearValues) {
                s += JSON.stringify(cv);
                s += ',';
            }
        }
        return s;
    }
}
