import { Context3D } from '../../graphics/webGpu/Context3D';
import { View3D } from '../../../core/View3D';
import { OcclusionSystem } from '../occlusion/OcclusionSystem';
import { RTFrame } from '../frame/RTFrame';
import { GraphValidator, MissingCreatorError, topoSort, UnresolvedResourceError, WrongResourceKindError } from './GraphValidator';
import { RenderGraphBuilder, RenderGraphPass, RenderGraphPassContext } from './RenderGraphPass';
import { RenderGraphResourcePool } from './RenderGraphResourcePool';
import { BeginPassOptions, RenderGraphRenderTarget, RenderGraphRenderTargetDesc } from './RenderGraphRenderTarget';
import { RenderGraphRenderPass, RenderPipelineDesc } from './RenderGraphRenderPass';
import { ComputePipelineDesc, RenderGraphComputePass } from './RenderGraphComputePass';
import { TransientResourceRegistry } from './transient/TransientResourceRegistry';
import { TransientTexturePool } from './transient/TransientTexturePool';
import { TransientBufferPool } from './transient/TransientBufferPool';
import { LifetimeAnalyzer, ResourceLifetime } from './transient/LifetimeAnalyzer';
import { AccessHint, BufferDesc, TextureDesc } from './transient/ResourceDesc';
import { BufferHandle, TextureHandle, makeBufferHandle, makeTextureHandle, resourceName } from './transient/ResourceHandle';
import { RenderTexture } from '../../../textures/RenderTexture';
import { GPUBufferBase } from '../../graphics/webGpu/core/buffer/GPUBufferBase';
import { CResizeEvent } from '../../../event/CResizeEvent';
import { RTResourceMap } from '../frame/RTResourceMap';

/** Internal: per-graph metadata stamped onto a pass after add(). */
const PASS_META = Symbol('RenderGraphPass.meta');
interface PassMeta {
    insertedOrder: number;
}

/**
 * User-facing Frame Graph. Each {@link View3D} owns one — the graph
 * is bound to the view's Context3D in the constructor and uses that
 * view as the implicit owner for setup contexts and pass execution.
 *
 * Pass lifecycle:
 *
 *   graph.add(MyPass, ...args)
 *     → new MyPass(...args)            // ctor: nothing GPU
 *     → pass.setup(builder)            // alloc + b.read/b.write
 *     → graph.compile() (lazy)         // validator + topoSort
 *     → pass.execute(ctx)              // each frame, in topo order
 *     → pass.destroy()                 // on graph.destroy() or remove()
 *
 * The graph collects `b.read` / `b.write` calls into the pass's
 * `reads` / `writes` / `creates` arrays after setup runs, then freezes
 * them. See {@link RenderGraphPass} for the contract.
 *
 * ## Hot-swap contract
 *
 * Mutations are safe at any time between frames. Each one marks the
 * graph dirty so the next `compile()` rebuilds; wrap a sequence of
 * mutations in {@link beginUpdate} / {@link endUpdate} to coalesce.
 *
 * | Op | Effect on validator | Effect on pool |
 * |----|---------------------|----------------|
 * | `add(Ctor)` | new pass joins validation + topo | pass's `b.write(name, getter)` registers `name` |
 * | `remove(name)` | pass leaves validation + topo; consumers of its outputs fail compile | pass's `creates` are unregistered |
 * | `replace(name, Ctor)` | old leaves, new joins | old `creates` unregistered, then new `setup()` registers |
 * | `disablePass(name)` | pass is filtered out as if removed | unchanged (getter stays for cheap `enablePass`) |
 * | `enablePass(name)` | pass re-enters validation + topo | unchanged |
 *
 * `disable === remove` for the validator's purposes — disabling a
 * producer whose output is read by an enabled pass throws
 * `UnresolvedResourceError` at the next compile, instead of silently
 * delivering stale data at execute. Disable is the right choice when
 * you intend to flip the pass back on; remove is right when you don't.
 *
 * @group Graph
 */
export class RenderGraph {
    private readonly _view: View3D;
    private readonly _ctx: Context3D;
    private readonly _pool: RenderGraphResourcePool;
    private readonly _passes: RenderGraphPass[] = [];
    private readonly _byName: Map<string, RenderGraphPass> = new Map();
    /** name → RenderGraphRenderTarget for every typed RT registered
     *  through `b.createRenderTarget` / `b.adoptRenderTarget`. Lets
     *  {@link execute} reset the per-frame first-writer flag in O(RT)
     *  rather than scanning the pool. */
    private readonly _renderTargets: Map<string, RenderGraphRenderTarget> = new Map();
    /** Per-graph transient resource subsystem. Populated by `b.declareTexture`
     *  / `b.declareBuffer` / `b.importExternalTexture` during pass setup;
     *  consumed by {@link LifetimeAnalyzer} + the physical pools in
     *  {@link compile}. */
    private readonly _transient: TransientResourceRegistry = new TransientResourceRegistry();
    private readonly _texturePool: TransientTexturePool;
    private readonly _bufferPool: TransientBufferPool;
    /** Latest lifetime analysis output. Held across frames so future
     *  Phase 6 work (storeOp='discard' derivation, debug dumpDot)
     *  can consult per-resource intervals without re-running analyze. */
    private _lifetimes: ResourceLifetime[] = [];
    /** logical name → pool-resolved RenderTexture for the current
     *  compile window. Cleared each {@link compile} and repopulated
     *  from {@link TransientTexturePool.assign}. */
    private _textureBindings: Map<string, RenderTexture> = new Map();
    private _bufferBindings: Map<string, GPUBufferBase> = new Map();
    private _compiled: string[] | null = null;
    private _dirty: boolean = true;
    private _insertCounter: number = 0;
    private _batchDepth: number = 0;
    private readonly _onDeviceLost: (event: { data: unknown }) => void;
    private readonly _onCanvasResize: () => void;

    constructor(view: View3D) {
        this._view = view;
        this._ctx = view.engine3D.context3D;
        this._pool = new RenderGraphResourcePool(this._ctx);
        this._texturePool = new TransientTexturePool(this._ctx);
        this._bufferPool = new TransientBufferPool(this._ctx);

        // Release pool registrations when the device is lost. Fresh
        // textures + buffers come back via re-init, so the next
        // `add()` cycle re-registers everything.
        this._onDeviceLost = () => {
            this._pool.dispose();
            this._texturePool.dispose();
            this._bufferPool.dispose();
            this._textureBindings.clear();
            this._bufferBindings.clear();
            this._dirty = true;
        };
        // Canvas resize invalidates size-token resolution (e.g.
        // `width: 'screen/2'`). Mark dirty so the next `compile()`
        // re-analyzes lifetimes against the new presentationSize and
        // the pool re-allocates same-bucket-but-new-resolution slots.
        // Skip if the addEventListener API isn't present (test stubs).
        this._onCanvasResize = () => { this._dirty = true; };
        if (typeof this._ctx.addEventListener === 'function') {
            this._ctx.addEventListener(Context3D.DEVICE_LOST, this._onDeviceLost, this);
            this._ctx.addEventListener(CResizeEvent.RESIZE, this._onCanvasResize, this);
        }
    }

    public get context(): Context3D {
        return this._ctx;
    }

    public get view(): View3D {
        return this._view;
    }

    public get pool(): RenderGraphResourcePool {
        return this._pool;
    }

    public get passes(): readonly RenderGraphPass[] {
        return this._passes;
    }

    /**
     * Construct a pass, run its `setup`, register it. The factory
     * signature passes ctor args through to `new Ctor(...args)`; the
     * builder captures `b.read` / `b.write` calls into the pass's
     * `reads` / `writes` / `creates` arrays.
     *
     * Returns the constructed pass so callers can hold a reference if
     * needed — but the canonical way to reach a pass after add is
     * `graph.getPass<T>(name)`.
     */
    public add<C extends new (...args: any[]) => RenderGraphPass>(
        Ctor: C,
        ...args: ConstructorParameters<C>
    ): InstanceType<C> {
        const pass = new Ctor(...args) as InstanceType<C>;
        this._setupAndRegister(pass);
        this._passes.push(pass);
        this._byName.set(pass.name, pass);
        this._dirty = true;
        return pass;
    }

    /** Replace a pass by name. The replacement runs through the same
     *  factory + setup pipeline as `add`. The old pass's `destroy()` is
     *  called and any resource handles it created are unregistered from
     *  the pool before the new pass's `setup()` runs, so stale getters
     *  never co-exist with the replacement. */
    public replace<C extends new (...args: any[]) => RenderGraphPass>(
        name: string,
        Ctor: C,
        ...args: ConstructorParameters<C>
    ): InstanceType<C> {
        const idx = this._passes.findIndex(p => p.name === name);
        if (idx < 0) throw new Error(`RenderGraph.replace: pass '${name}' not found.`);
        const prev = this._passes[idx];
        // Preserve the original insertion order. replace is "in-place
        // swap of one pass for another", and `insertedOrder` is the
        // single tie-break key used by topoSort's chain-writers /
        // resource-flow edges (GraphValidator.topoSort). Without
        // preserving it, the new pass moves to the back of the order
        // and any mutator-writer of one of its outputs (e.g.
        // SortedTransparentPass mutating COLOR_BUFFER that ColorPass
        // creates) flips relative to it, producing a fake cycle.
        const prevOrder = this._insertedOrder(prev);
        prev.destroy();
        for (const n of prev.creates) this._releaseCreated(n);
        const pass = new Ctor(...args) as InstanceType<C>;
        this._setupAndRegister(pass);
        if (prevOrder >= 0) {
            (pass as any)[PASS_META] = { insertedOrder: prevOrder } satisfies PassMeta;
        }
        this._passes.splice(idx, 1, pass);
        this._byName.delete(name);
        this._byName.set(pass.name, pass);
        this._dirty = true;
        return pass;
    }

    /** Remove a pass by name. Idempotent — returns `false` if `name`
     *  isn't registered (callers can use this for unconditional
     *  cleanup). On a hit: `pass.destroy()` runs, every name in
     *  `pass.creates` is dropped from the pool, and the pass is
     *  unlinked from the graph. The next `compile()` rebuilds without
     *  it, and `UnresolvedResourceError` surfaces for any consumer that
     *  still references the removed pass's outputs. */
    public remove(name: string): boolean {
        const idx = this._passes.findIndex(p => p.name === name);
        if (idx < 0) return false;
        const pass = this._passes[idx];
        pass.destroy();
        for (const n of pass.creates) this._releaseCreated(n);
        this._passes.splice(idx, 1);
        this._byName.delete(name);
        this._dirty = true;
        return true;
    }

    /** Runtime kill switch. Disabled passes are treated as if they
     *  weren't in the graph: they don't participate in validation or
     *  topo sort, and they're skipped during execute. Disabling a
     *  producer whose output is read by another enabled pass will make
     *  the next `compile()` throw `UnresolvedResourceError`. Use this
     *  for temporary off switches you intend to flip back on; use
     *  {@link remove} for permanent removal. */
    public disablePass(name: string): this {
        const p = this._byName.get(name);
        if (!p) throw new Error(`RenderGraph.disablePass: pass '${name}' not found.`);
        if (p.enabled) {
            p.enabled = false;
            this._dirty = true;
        }
        return this;
    }

    public enablePass(name: string): this {
        const p = this._byName.get(name);
        if (!p) throw new Error(`RenderGraph.enablePass: pass '${name}' not found.`);
        if (!p.enabled) {
            p.enabled = true;
            this._dirty = true;
        }
        return this;
    }

    /** Look up a pass by name. */
    public getPass<T extends RenderGraphPass = RenderGraphPass>(name: string): T | null {
        return (this._byName.get(name) as T | undefined) ?? null;
    }

    /** Open a mutation batch. `compile()` short-circuits until the
     *  matching `endUpdate()` runs, so a sequence of `add` / `remove` /
     *  `replace` / `disablePass` / `enablePass` calls produces at most
     *  one validation + topo sort. Pairs are reentrant: nesting two
     *  `beginUpdate()` calls requires two `endUpdate()` calls to flush.
     *  Calling `execute()` mid-batch is allowed but will run against
     *  the last compiled order (i.e. ignores in-flight mutations);
     *  flush the batch before the next frame if you want the new
     *  structure to take effect. */
    public beginUpdate(): this {
        this._batchDepth++;
        return this;
    }

    /** Close a mutation batch opened with {@link beginUpdate}. When the
     *  outermost batch closes, `compile()` runs if any mutation
     *  happened inside. */
    public endUpdate(): this {
        if (this._batchDepth <= 0) {
            throw new Error('RenderGraph.endUpdate: no matching beginUpdate.');
        }
        this._batchDepth--;
        if (this._batchDepth === 0 && this._dirty) this.compile();
        return this;
    }

    /** Validate + topologically sort. Idempotent — short-circuits if
     *  no mutation since the last compile. Throws GraphCompileError
     *  subclasses on validation failure.
     *
     *  Disabled passes are filtered out before validation and topo sort
     *  — `disable === remove` from the validator's point of view. This
     *  means disabling a producer whose output is read by another
     *  enabled pass throws `UnresolvedResourceError` here, instead of
     *  silently leaving the consumer with stale/zero data at execute.
     *  Use `remove(name)` for permanent removal; use `disablePass(name)`
     *  + matching `disablePass` on every reader for a temporary off
     *  switch. */
    public compile(): void {
        if (this._batchDepth > 0) return;
        if (!this._dirty && this._compiled) return;
        const activePasses = this._passes.filter(p => p.enabled);
        const activeByName: Map<string, RenderGraphPass> = new Map();
        for (const p of activePasses) activeByName.set(p.name, p);
        const validator = new GraphValidator(activePasses);
        validator.validateSingleCreator();
        validator.validateResolvable();
        this._compiled = topoSort(activePasses, activeByName, this._insertedOrder.bind(this));

        // Transient pool: analyze lifetimes against the freshly-compiled
        // order, then ask the pools to assign physical wrappers (aliasing
        // when intervals don't overlap). The bindings re-register over
        // the placeholder getters installed at declare time.
        this._lifetimes = LifetimeAnalyzer.analyze(
            this._compiled,
            activeByName,
            this._transient,
            this._ctx.presentationSize as [number, number],
        );
        const texAssign = this._texturePool.assign(this._lifetimes);
        const bufAssign = this._bufferPool.assign(this._lifetimes);
        this._textureBindings = texAssign.bindings;
        this._bufferBindings = bufAssign.bindings;
        const legacyMap = RTResourceMap.forContext(this._ctx);
        for (const [name, rt] of texAssign.bindings) {
            // Persistent textures were registered as `() => tex` at
            // import time and don't appear in `texAssign.bindings`
            // (the pool filters persistent out). Transient ones get
            // their placeholder swapped for the resolved wrapper here.
            this._pool.register(name, () => rt, 'texture');
            // Back-compat: descriptors marked `publishToLegacyMap`
            // (typically dedicated mip-pyramids that historical
            // material code reads via RTResourceMap.getTexture)
            // get their pool wrapper published into the legacy map
            // under the logical name. Only valid for `aliasable:false`
            // resources — publishing an aliased wrapper would let
            // material readers cache a pointer that the pool later
            // hands to another logical resource.
            const decl = this._transient.get(name);
            const desc = decl?.desc as TextureDesc | undefined;
            if (desc?.publishToLegacyMap) {
                legacyMap.rtTextureMap.set(name, rt);
            }
        }
        for (const [name, buf] of bufAssign.bindings) {
            this._pool.register(name, () => buf, 'buffer');
        }
        this._dirty = false;
        console.debug('[RenderGraph] compiled pass order:', this._compiled.join(' → '));
        if (this._lifetimes.length > 0) {
            const ts = this._texturePool.stats();
            console.debug(
                `[RenderGraph] transient: ${this._lifetimes.length} lifetimes ` +
                `(${texAssign.bindings.size} tex / ${bufAssign.bindings.size} buf bound), ` +
                `tex pool ${ts.slotCount} slots / ${(ts.currentBytes / 1024 / 1024).toFixed(2)} MB ` +
                `(peak ${(ts.peakBytes / 1024 / 1024).toFixed(2)} MB)`,
            );
        }
    }

    /** Run one frame. Lazy-compiles on first call (or after a
     *  mutation). Disabled passes are skipped. In dev mode each
     *  execute is wrapped in a `device.pushErrorScope('validation')`
     *  so the offending pass name shows up next to any WebGPU error. */
    public execute(occlusion: OcclusionSystem, frameIndex: number): void {
        this.compile();
        const order = this._compiled!;
        const pool = this._pool;
        const view = this._view;
        const graph = this;
        // Reset per-frame first-writer flag on every registered RT so
        // the auto-derive rule reapplies each frame: the first pass
        // that opens this RT this frame gets clear-by-default; any
        // later pass gets load-by-default.
        for (const rt of this._renderTargets.values()) {
            rt._firstWriterFiredThisFrame = false;
        }
        const ctx: RenderGraphPassContext = {
            view,
            occlusion,
            graph,
            frameIndex,
            get<T>(name: string): T {
                return pool.get<T>(name);
            },
            getTexture(name: string | TextureHandle): RenderTexture {
                const n = resourceName(name);
                const kind = pool.kindOf(n);
                if (kind !== 'texture' && kind !== 'opaque') {
                    // 'opaque' covers legacy `b.write(name, getter)`
                    // texture resources whose kind was never typed —
                    // accept them so callers can migrate to
                    // ctx.getTexture without first re-declaring
                    // upstream producers.
                    throw new WrongResourceKindError('<ctx.getTexture>', n, 'texture', kind ?? 'unregistered');
                }
                return pool.get<RenderTexture>(n);
            },
            getBuffer(name: string | BufferHandle): GPUBufferBase {
                const n = resourceName(name);
                const kind = pool.kindOf(n);
                if (kind !== 'buffer' && kind !== 'opaque') {
                    throw new WrongResourceKindError('<ctx.getBuffer>', n, 'buffer', kind ?? 'unregistered');
                }
                return pool.get<GPUBufferBase>(n);
            },
            getRenderTarget(name: string): RenderGraphRenderTarget {
                const kind = pool.kindOf(name);
                if (kind !== 'rendertarget') {
                    throw new WrongResourceKindError('<ctx.getRenderTarget>', name, 'rendertarget', kind ?? 'unregistered');
                }
                return pool.get<RenderGraphRenderTarget>(name);
            },
            beginRenderPass(handle: RenderGraphRenderPass): GPURenderPassEncoder {
                return handle.begin(this);
            },
            endRenderPass(handle: RenderGraphRenderPass): void {
                handle.end(this);
            },
            beginComputePass(handle: RenderGraphComputePass): GPUComputePassEncoder {
                return handle.begin(this);
            },
            endComputePass(handle: RenderGraphComputePass): void {
                handle.end(this);
            },
        };
        const device = this._ctx.device;
        const devMode = this._ctx.engine?.setting.render.debug === true;
        if (devMode && device) device.pushErrorScope('validation');
        for (const name of order) {
            const p = this._byName.get(name)!;
            if (!p.enabled) continue;
            p.execute(ctx);
        }
        if (devMode && device) {
            void device.popErrorScope().then(err => {
                if (err) {
                    console.error(`[RenderGraph] validation error in frame ${frameIndex}: ${err.message}. ` +
                        `Passes ran: ${order.join(' → ')}.`);
                }
            }).catch(() => { /* device lost or scope empty */ });
        }
    }

    /** Graphviz DOT representation of the compiled graph. Stable
     *  iteration order so snapshot tests can diff against a fixture.
     *  Edges go from the LAST writer of each resource to each reader;
     *  multiple mutators of the same resource appear as a chain.
     *  Explicit `dependencies` edges are rendered as dotted lines. */
    public dumpDot(): string {
        this.compile();
        const lines: string[] = ['digraph RenderGraph {'];
        lines.push('  rankdir=LR;');
        lines.push('  node [shape=box, style=rounded];');

        for (const name of this._compiled!) {
            lines.push(`  "${name}";`);
        }

        // Build sorted writer chains per resource.
        const writers = this._buildSortedWriters();
        // Edges:
        //   - chain edges between consecutive writers (same name, dashed)
        //   - last-writer → reader (solid, labeled by resource name)
        for (const [name, ws] of writers) {
            for (let i = 1; i < ws.length; i++) {
                const prev = ws[i - 1];
                const curr = ws[i];
                if (prev !== curr) lines.push(`  "${prev}" -> "${curr}" [style=dashed, label="mutate(${name})"];`);
            }
        }
        for (const reader of this._compiled!) {
            const p = this._byName.get(reader)!;
            for (const r of p.reads) {
                const ws = writers.get(r);
                if (!ws || ws.length === 0) continue;
                const last = ws[ws.length - 1];
                if (last !== reader) lines.push(`  "${last}" -> "${reader}" [label="${r}"];`);
            }
            if (p.dependencies) {
                for (const dep of p.dependencies) {
                    if (!this._byName.has(dep)) continue;
                    lines.push(`  "${dep}" -> "${reader}" [style=dotted, label="dependsOn"];`);
                }
            }
        }
        lines.push('}');
        return lines.join('\n');
    }

    /** Tear down all passes, the resource pool, and the device-lost
     *  listener. Called from RendererJob.destroy on engine dispose. */
    public destroy(): void {
        if (typeof this._ctx.removeEventListener === 'function') {
            this._ctx.removeEventListener(Context3D.DEVICE_LOST, this._onDeviceLost, this);
            this._ctx.removeEventListener(CResizeEvent.RESIZE, this._onCanvasResize, this);
        }
        for (const p of this._passes) p.destroy();
        for (const rt of this._renderTargets.values()) rt.destroy(this._ctx);
        this._renderTargets.clear();
        this._passes.length = 0;
        this._byName.clear();
        this._compiled = null;
        this._dirty = true;
        this._pool.dispose();
        this._transient.dispose();
        this._texturePool.dispose();
        this._bufferPool.dispose();
        this._textureBindings.clear();
        this._bufferBindings.clear();
    }

    /**
     * Snapshot of the transient pools' current allocations + HWM stats.
     * Use this to monitor whether lifetime-aliasing is actually saving
     * memory after migrating a pass to `b.declareTexture`. The numbers
     * are rough estimates (4 bpp fallback for unknown formats) — useful
     * for ratio comparisons, not absolute accounting.
     */
    public transientStats(): {
        texture: { currentBytes: number; peakBytes: number; bucketCount: number; slotCount: number };
        buffer: { currentBytes: number; peakBytes: number; bucketCount: number; slotCount: number };
        lifetimes: number;
    } {
        return {
            texture: this._texturePool.stats(),
            buffer: this._bufferPool.stats(),
            lifetimes: this._lifetimes.length,
        };
    }

    /**
     * @internal Test/debug accessor for the transient registry.
     */
    public get transientRegistry(): TransientResourceRegistry {
        return this._transient;
    }

    /**
     * Back-compat helper for `desc.publishToLegacyMap` resources that
     * need to be readable through `RTResourceMap.getTexture(name)` BEFORE
     * the first {@link compile} runs (e.g. transmission materials whose
     * constructors look up `_SceneColorPyramid` during scene setup).
     *
     * Allocates the dedicated pool slot eagerly (the wrapper identity
     * is stable because `aliasable:false` resources always go through
     * the per-name dedicated path), registers it in the graph pool,
     * and publishes the wrapper into the legacy map. The next compile
     * re-runs through {@link TransientTexturePool.assign} and returns
     * the same wrapper from `_dedicatedByName`, then re-publishes
     * (idempotent set).
     *
     * @internal
     */
    private _eagerAllocateAndPublish(name: string, desc: TextureDesc): void {
        const [pw, ph] = this._ctx.presentationSize as [number, number];
        const w = typeof desc.width === 'number' ? desc.width
            : desc.width === 'screen' ? pw
            : desc.width === 'screen/2' ? Math.max(1, Math.floor(pw / 2))
            : desc.width === 'screen/4' ? Math.max(1, Math.floor(pw / 4))
            : desc.width === 'screen/8' ? Math.max(1, Math.floor(pw / 8))
            : pw;
        const h = typeof desc.height === 'number' ? desc.height
            : desc.height === 'screen' ? ph
            : desc.height === 'screen/2' ? Math.max(1, Math.floor(ph / 2))
            : desc.height === 'screen/4' ? Math.max(1, Math.floor(ph / 4))
            : desc.height === 'screen/8' ? Math.max(1, Math.floor(ph / 8))
            : ph;
        const usage = typeof desc.usage === 'number' ? desc.usage
            : (GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
               | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST);
        // Synthesize a minimal ResourceLifetime so the pool's
        // _allocateSlot can take its normal dedicated path. The
        // first/last idx are placeholders; the pool ignores them on
        // dedicated allocation.
        const lt: ResourceLifetime = {
            name, kind: 'texture', desc,
            firstUseIdx: 0, lastUseIdx: 0,
            resolvedUsage: usage,
            resolvedWidth: w, resolvedHeight: h,
            persistent: false,
        };
        const single = this._texturePool.assign([lt]);
        const rt = single.bindings.get(name);
        if (!rt) {
            // Defensive: should be unreachable because pool always
            // allocates dedicated slots for aliasable:false.
            return;
        }
        this._pool.register(name, () => rt, 'texture');
        const legacyMap = RTResourceMap.forContext(this._ctx);
        legacyMap.rtTextureMap.set(name, rt);
    }

    /** Construct a builder for `pass`, run `setup`, capture the
     *  reads/writes/creates into frozen arrays on the pass.
     *
     *  Incremental validation: `b.read(name)` and mutator-form
     *  `b.write(name)` throw immediately if no preceding pass has
     *  created `name`. This catches missing-producer mistakes at the
     *  builder call site (clear stack pointing into the pass's setup)
     *  rather than at first execute. The convention is therefore
     *  "register producer passes before consumer passes" — which
     *  matches every default RendererJob today. */
    private _setupAndRegister(pass: RenderGraphPass): void {
        const reads: string[] = [];
        const writes: string[] = [];
        const creates: string[] = [];
        const deps: Set<string> = new Set(pass.dependencies ?? []);
        const registerRT = (n: string, rt: RenderGraphRenderTarget): RenderGraphRenderTarget => {
            this._pool.register(n, () => rt, 'rendertarget');
            this._renderTargets.set(n, rt);
            writes.push(n);
            creates.push(n);
            return rt;
        };
        // Placeholder getter installed when a transient resource is
        // declared; replaced by the real pool-assigned getter after
        // compile. Throwing here surfaces a programmer error where
        // someone tries to fetch a transient resource via the legacy
        // `pool.get(name)` from inside setup() (no resources are
        // materialized until compile).
        const placeholderGetter = (name: string) => () => {
            throw new Error(
                `RenderGraph: transient resource '${name}' has not been materialized yet — ` +
                `it can only be resolved via ctx.getTexture/getBuffer(name) inside execute(), ` +
                `not via pool.get during setup.`,
            );
        };
        const recordHintIfTransient = (name: string, mode: 'read' | 'write', access?: AccessHint): void => {
            const decl = this._transient.get(name);
            if (!decl) return;
            // Default hints reflect the typical mode:
            //   read → 'sample' (most reads sample), write → 'storage'
            //   (compute writes; for attachment writes pass authors are
            //   expected to flow through b.useRenderTarget which folds
            //   in the 'attachment' bit elsewhere).
            const hint: AccessHint = access ?? (mode === 'read' ? 'sample' : 'storage');
            this._transient.recordAccessHint(name, decl.kind, hint, mode);
        };
        const builder: RenderGraphBuilder = {
            context3D: this._ctx,
            view: this._view,
            graph: this,
            read: ((target: string | TextureHandle | BufferHandle, access?: AccessHint) => {
                const n = resourceName(target);
                if (!this._pool.has(n)) {
                    throw new UnresolvedResourceError(pass.name, n);
                }
                reads.push(n);
                recordHintIfTransient(n, 'read', access);
            }) as RenderGraphBuilder['read'],
            write: (<T>(target: string | TextureHandle | BufferHandle, getterOrAccess?: (() => T) | AccessHint): T | void => {
                // Disambiguate the three overloads:
                //   write(name, getter)      — legacy creator
                //   write(handle, access?)   — new mutator + hint
                //   write(name, access?)     — string mutator + hint
                // The legacy form's second arg is a function; everything
                // else is undefined or a string AccessHint.
                if (typeof getterOrAccess === 'function') {
                    const n = resourceName(target);
                    const getter = getterOrAccess as () => T;
                    writes.push(n);
                    this._pool.register(n, getter);
                    creates.push(n);
                    return getter();
                }
                const n = resourceName(target);
                if (!this._pool.has(n)) {
                    throw new MissingCreatorError(pass.name, n);
                }
                writes.push(n);
                recordHintIfTransient(n, 'write', getterOrAccess as AccessHint | undefined);
                return undefined;
            }) as RenderGraphBuilder['write'],
            readWrite: (target: TextureHandle | BufferHandle, access?: AccessHint): void => {
                const n = resourceName(target);
                if (!this._pool.has(n)) {
                    throw new UnresolvedResourceError(pass.name, n);
                }
                reads.push(n);
                writes.push(n);
                recordHintIfTransient(n, 'read', access);
                recordHintIfTransient(n, 'write', access);
            },
            declareTexture: (n: string, desc: TextureDesc): TextureHandle => {
                this._transient.declareTexture(n, desc, pass.name);
                // creates marks this pass as the single creator for the
                // single-creator validator; writes / reads are NOT
                // auto-pushed here — callers must follow up with
                // `b.write(handle, hint)` / `b.read(handle, hint)` /
                // `b.readWrite(handle, hint)` to declare the actual
                // access pattern. That keeps the per-pass writes / reads
                // arrays free of duplicates and makes the access intent
                // explicit at the call site (good for grep + review).
                creates.push(n);
                // Back-compat early-publish path: resources marked
                // `publishToLegacyMap` are typically read by materials
                // (LitMaterial.transmissionFactor setter looks up
                // `_SceneColorPyramid` via `RTResourceMap.getTexture`)
                // BEFORE the first compile runs — Sample code instantiates
                // these materials in `initScene()`, which sits between
                // `graph.add(...)` and the first `graph.execute(...)`.
                // If we defer allocation to compile, the material's setter
                // sees a missing entry and binds the white-texture
                // placeholder forever. Eager-allocate the wrapper here so
                // the RTResourceMap entry exists by the time the material
                // setter runs; the wrapper's identity is stable because
                // `aliasable:false` resources always go through the
                // pool's dedicated path (lookup-by-name) and never get
                // re-aliased. The next compile re-registers the same
                // wrapper through the normal `pool.assign` path and
                // sets `publishToLegacyMap.set` (idempotent).
                if (desc.publishToLegacyMap && desc.aliasable === false) {
                    this._eagerAllocateAndPublish(n, desc);
                } else {
                    // Placeholder so other passes' setup() can b.read(n)
                    // before compile materializes the real binding.
                    this._pool.register(n, placeholderGetter(n), 'texture');
                }
                return makeTextureHandle(n);
            },
            declareBuffer: (n: string, desc: BufferDesc): BufferHandle => {
                this._transient.declareBuffer(n, desc, pass.name);
                this._pool.register(n, placeholderGetter(n), 'buffer');
                creates.push(n);
                return makeBufferHandle(n);
            },
            importExternalTexture: (n: string, tex: RenderTexture): TextureHandle => {
                this._transient.importExternalTexture(n, tex, pass.name);
                this._pool.register(n, () => tex, 'texture');
                this._pool.markPersistent(n);
                // Imports DO push writes — the import semantically is
                // "this pass produces the resource" (single-creator
                // rule via creates, mutator-chain root via writes), so
                // downstream b.read/b.write callers can find a writer
                // when topo sort walks the resource flow. There's no
                // separate access call expected for imports.
                writes.push(n);
                creates.push(n);
                return makeTextureHandle(n);
            },
            importExternalBuffer: (n: string, buf: GPUBufferBase): BufferHandle => {
                this._transient.importExternalBuffer(n, buf, pass.name);
                this._pool.register(n, () => buf, 'buffer');
                this._pool.markPersistent(n);
                writes.push(n);
                creates.push(n);
                return makeBufferHandle(n);
            },
            dependsOn: (passName: string) => {
                if (!this._byName.has(passName)) {
                    throw new Error(
                        `RenderGraph: pass '${pass.name}' calls b.dependsOn('${passName}') but no pass named '${passName}' is registered yet. ` +
                        `Add the upstream pass before this one.`,
                    );
                }
                deps.add(passName);
            },
            dependsOnIfPresent: (passName: string) => {
                if (this._byName.has(passName)) deps.add(passName);
            },
            createRenderTarget: (n: string, desc: RenderGraphRenderTargetDesc): RenderGraphRenderTarget => {
                return registerRT(n, RenderGraphRenderTarget.allocate(n, this._ctx, desc));
            },
            adoptRenderTarget: (n: string, rtFrame: RTFrame, opts?: { label?: string }): RenderGraphRenderTarget => {
                return registerRT(n, RenderGraphRenderTarget.fromRTFrame(n, rtFrame, opts));
            },
            useRenderTarget: (n: string): RenderGraphRenderTarget => {
                if (!this._pool.has(n)) {
                    throw new MissingCreatorError(pass.name, n);
                }
                const kind = this._pool.kindOf(n);
                if (kind !== 'rendertarget') {
                    throw new WrongResourceKindError(pass.name, n, 'rendertarget', kind ?? 'unregistered');
                }
                writes.push(n);
                const rt = this._pool.get<RenderGraphRenderTarget>(n);
                rt._writers.push(pass.name);
                return rt;
            },
            borrowRenderTarget: (n: string): RenderGraphRenderTarget => {
                // Same as useRenderTarget but skips the writes.push(n).
                // ColorPass and chained-opaque subclasses use this so they
                // don't pollute the MAIN_COLOR_RT mutator chain — which
                // would conflict with the transparent passes' explicit
                // dependsOn edges (see GISLayerComposition sample for the
                // canonical chained-opaque pipeline that motivated this).
                if (!this._pool.has(n)) {
                    throw new MissingCreatorError(pass.name, n);
                }
                const kind = this._pool.kindOf(n);
                if (kind !== 'rendertarget') {
                    throw new WrongResourceKindError(pass.name, n, 'rendertarget', kind ?? 'unregistered');
                }
                const rt = this._pool.get<RenderGraphRenderTarget>(n);
                rt._writers.push(pass.name);
                return rt;
            },
            createRenderPass: (
                name: string,
                target: RenderGraphRenderTarget,
                desc: RenderPipelineDesc,
                openOptions?: BeginPassOptions,
            ): RenderGraphRenderPass => {
                return new RenderGraphRenderPass(name, target, desc, openOptions);
            },
            createComputePass: (name: string, desc: ComputePipelineDesc): RenderGraphComputePass => {
                return new RenderGraphComputePass(name, desc);
            },
        };
        pass.setup(builder);
        (pass as any).reads = Object.freeze(reads);
        (pass as any).writes = Object.freeze(writes);
        (pass as any).creates = Object.freeze(creates);
        if (deps.size > 0) {
            pass.dependencies = deps;
        }
        // Stamp insertion order for stable topo tie-break.
        (pass as any)[PASS_META] = { insertedOrder: this._insertCounter++ } satisfies PassMeta;
    }

    private _insertedOrder(p: RenderGraphPass): number {
        return ((p as any)[PASS_META] as PassMeta | undefined)?.insertedOrder ?? -1;
    }

    /** Drop a name from the pool. If the entry is a typed
     *  {@link RenderGraphRenderTarget} also call its `destroy` hook
     *  and remove it from the per-frame reset map. Transient
     *  declarations are unregistered from the registry so the
     *  single-creator check stays clean for any subsequent re-add. */
    private _releaseCreated(name: string): void {
        if (this._pool.kindOf(name) === 'rendertarget') {
            const rt = this._renderTargets.get(name);
            if (rt) {
                rt.destroy(this._ctx);
                this._renderTargets.delete(name);
            }
        }
        this._pool.unregister(name);
        this._transient.unregister(name);
        this._textureBindings.delete(name);
        this._bufferBindings.delete(name);
    }

    /** name → writers sorted by insertion order. Used by `dumpDot`
     *  to render the writer chain for each resource. */
    private _buildSortedWriters(): Map<string, string[]> {
        const writers = new Map<string, string[]>();
        for (const p of this._passes) {
            for (const w of p.writes) {
                if (!writers.has(w)) writers.set(w, []);
                writers.get(w)!.push(p.name);
            }
        }
        for (const [, list] of writers) {
            list.sort((a, b) => this._insertedOrder(this._byName.get(a)!) - this._insertedOrder(this._byName.get(b)!));
        }
        return writers;
    }
}
