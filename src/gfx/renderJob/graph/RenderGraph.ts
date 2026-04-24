import { Context3D } from '../../graphics/webGpu/Context3D';
import { View3D } from '../../../core/View3D';
import { OcclusionSystem } from '../occlusion/OcclusionSystem';
import { GraphValidator, topoSort } from './GraphValidator';
import { FeatureContext, RenderFeature, RenderGraphBuilder } from './RenderFeature';
import { RenderGraphResourcePool } from './RenderGraphResourcePool';
import { ResourceHandle } from './ResourceHandle';
import { RenderStage } from './RenderStage';

/**
 * User-facing Frame Graph. Features register declaratively, the graph
 * compiles a topological order, then `execute(view, occlusion)` drives
 * one frame.
 *
 * Compile is **lazy** — `addFeature` / `disableFeature` etc. set a
 * dirty flag and compilation runs once at the next execute(). This
 * keeps feature mutation cheap during app startup and lets scenes
 * reconfigure their graphs without paying validation cost every time.
 *
 * The graph instance is per-Context3D. Multi-instance apps need one
 * graph per engine; cross-engine resource sharing is not a goal (Plan
 * B single-owner rule applies here too).
 *
 * @group Graph
 */
export class RenderGraph {
    private readonly _ctx: Context3D;
    private readonly _pool: RenderGraphResourcePool;
    private readonly _features: RenderFeature[] = [];
    private readonly _byName: Map<string, RenderFeature> = new Map();
    private _compiled: string[] | null = null;
    private _dirty: boolean = true;
    private readonly _onDeviceLost: (event: { data: unknown }) => void;

    constructor(ctx: Context3D) {
        this._ctx = ctx;
        this._pool = new RenderGraphResourcePool(ctx);

        // Phase E: release pool-owned GPU objects when the device
        // is lost. Fresh buffers / textures are unusable against the
        // new device that comes back via re-init; clearing here lets
        // the next frame rebuild them lazily on first pool.resolve()
        // call. The listener is torn down in `destroy()`.
        this._onDeviceLost = () => this._pool.dispose();
        // Unit tests pass a plain-object Context3D stub that does not
        // extend CEventDispatcher — skip the listener wiring when
        // the method isn't present so tests stay ctx-agnostic.
        if (typeof ctx.addEventListener === 'function') {
            ctx.addEventListener(Context3D.DEVICE_LOST, this._onDeviceLost, this);
        }
    }

    public get context(): Context3D {
        return this._ctx;
    }

    public get pool(): RenderGraphResourcePool {
        return this._pool;
    }

    public get features(): readonly RenderFeature[] {
        return this._features;
    }

    /**
     * Register a feature. Insertion order is preserved as a tie-break
     * for features in the same stage with no mutual data dependencies.
     */
    public addFeature(feature: RenderFeature): this {
        if (this._byName.has(feature.name)) {
            throw new Error(`RenderGraph.addFeature('${feature.name}') — a feature with this name already exists. ` +
                `Use replaceFeature('${feature.name}', newFeature) instead.`);
        }
        this._features.push(feature);
        this._byName.set(feature.name, feature);
        this._dirty = true;
        return this;
    }

    /** Tier 2 API: insert `feature` so it runs right after `anchor`.
     *  Does not create a data edge — users are still expected to fill
     *  reads/writes; the anchor is just an insertion-order hint. */
    public insertAfter(anchorName: string, feature: RenderFeature): this {
        const idx = this._features.findIndex(f => f.name === anchorName);
        if (idx < 0) throw new Error(`RenderGraph.insertAfter: anchor '${anchorName}' not found.`);
        if (this._byName.has(feature.name)) {
            throw new Error(`RenderGraph.insertAfter('${anchorName}', '${feature.name}') — feature '${feature.name}' already registered.`);
        }
        this._features.splice(idx + 1, 0, feature);
        this._byName.set(feature.name, feature);
        this._dirty = true;
        return this;
    }

    /** Tier 2 API: insert `feature` so it runs right before `anchor`. */
    public insertBefore(anchorName: string, feature: RenderFeature): this {
        const idx = this._features.findIndex(f => f.name === anchorName);
        if (idx < 0) throw new Error(`RenderGraph.insertBefore: anchor '${anchorName}' not found.`);
        if (this._byName.has(feature.name)) {
            throw new Error(`RenderGraph.insertBefore('${anchorName}', '${feature.name}') — feature '${feature.name}' already registered.`);
        }
        this._features.splice(idx, 0, feature);
        this._byName.set(feature.name, feature);
        this._dirty = true;
        return this;
    }

    /** Tier 3 API: insert `feature` at the tail of the given stage. */
    public addToStage(stage: RenderStage, feature: RenderFeature): this {
        if (feature.stage !== stage) {
            throw new Error(`RenderGraph.addToStage(${RenderStage[stage]}, '${feature.name}') — feature.stage is ${RenderStage[feature.stage]}. ` +
                `The stage argument exists to document intent; it must match feature.stage.`);
        }
        return this.addFeature(feature);
    }

    /** Runtime kill switch for a feature without removing it from the graph. */
    public disableFeature(name: string): this {
        const f = this._byName.get(name);
        if (!f) throw new Error(`RenderGraph.disableFeature: feature '${name}' not found.`);
        f.enabled = false;
        return this;
    }

    /** Counterpart of disableFeature. */
    public enableFeature(name: string): this {
        const f = this._byName.get(name);
        if (!f) throw new Error(`RenderGraph.enableFeature: feature '${name}' not found.`);
        f.enabled = true;
        return this;
    }

    /** Replace a feature by name. Compile is re-run on next execute. */
    public replaceFeature(name: string, next: RenderFeature): this {
        const idx = this._features.findIndex(f => f.name === name);
        if (idx < 0) throw new Error(`RenderGraph.replaceFeature: feature '${name}' not found.`);
        const prev = this._features[idx];
        prev.destroy();
        this._features.splice(idx, 1, next);
        this._byName.delete(name);
        this._byName.set(next.name, next);
        this._dirty = true;
        return this;
    }

    /** Look up a feature by name. */
    public getFeature<T extends RenderFeature = RenderFeature>(name: string): T | null {
        return (this._byName.get(name) as T | undefined) ?? null;
    }

    /**
     * Validate + topologically sort the graph. Idempotent — later
     * calls with no mutation short-circuit. Mutations flip `_dirty`
     * and force a recompile.
     *
     * Throws GraphCompileError subclasses (CyclicDependencyError,
     * UnresolvedResourceError, StageConstraintViolation,
     * DuplicateWriterError) — all carry feature/resource names in
     * the message so users can grep to the culprit.
     */
    public compile(): void {
        if (!this._dirty && this._compiled) return;

        // Run each feature's setup() to collect handle declarations.
        const builder: RenderGraphBuilder = {
            declare: (_handle: ResourceHandle) => {
                // Phase A: declaration is advisory — writes[] still
                // drives producer discovery. The builder hook exists
                // so Phase C features can hand descriptors to the
                // pool without a second roundtrip.
            },
            require: (_name: string) => { /* reserved for Phase C */ },
        };
        for (const f of this._features) f.setup(builder);

        // Check external resources to let the validator whitelist them.
        const externals = new Set<string>();
        for (const f of this._features) {
            for (const r of f.reads) {
                if (this._pool.has(r) && !this._producedBy(r)) externals.add(r);
            }
        }

        const validator = new GraphValidator(this._features, externals);
        validator.validateSingleWriter();
        validator.validateResolvable();
        validator.validateStageOrdering();

        const producers = new Map<string, string[]>();
        for (const f of this._features) {
            for (const w of f.writes) {
                if (!producers.has(w)) producers.set(w, []);
                producers.get(w)!.push(f.name);
            }
        }
        this._compiled = topoSort(this._features, producers);
        this._dirty = false;
    }

    /**
     * Execute one frame. Runs `compile()` on demand. Features are
     * called in compiled order; disabled features are skipped.
     *
     * Callers must supply the occlusion snapshot — the graph does
     * not own OcclusionSystem (it's a view-level concern).
     *
     * In dev mode (when the device supports `pushErrorScope`) each
     * execute is wrapped in a validation scope. Any WebGPU
     * validation error raised by a feature is logged with the
     * feature name attached so the culprit is obvious. The scope is
     * popped asynchronously so it does not block the render loop.
     */
    public execute(view: View3D, occlusion: OcclusionSystem, frameIndex: number): void {
        this.compile();
        const order = this._compiled!;
        const pool = this._pool;
        const ctx: FeatureContext = {
            view,
            occlusion,
            frameIndex,
            get<T>(name: string): T {
                return pool.get<T>(name);
            },
        };
        const device = this._ctx.device;
        const devMode = this._ctx.engine?.setting.render.debug === true;
        if (devMode && device) device.pushErrorScope('validation');
        for (const name of order) {
            const f = this._byName.get(name)!;
            if (!f.enabled) continue;
            f.execute(ctx);
        }
        if (devMode && device) {
            void device.popErrorScope().then(err => {
                if (err) {
                    console.error(`[RenderGraph] validation error in frame ${frameIndex}: ${err.message}. ` +
                        `Features ran: ${order.join(' → ')}.`);
                }
            }).catch(() => { /* device lost or scope empty */ });
        }
    }

    /**
     * Produce a graphviz DOT representation of the compiled graph.
     * Stable (deterministic iteration order) so snapshot tests can
     * diff against a fixture. Used for debugging only; not on the
     * hot path.
     */
    public dumpDot(): string {
        this.compile();
        const lines: string[] = ['digraph RenderGraph {'];
        lines.push('  rankdir=LR;');
        lines.push('  node [shape=box, style=rounded];');

        // Cluster features by stage.
        const stages = new Map<RenderStage, string[]>();
        for (const name of this._compiled!) {
            const f = this._byName.get(name)!;
            if (!stages.has(f.stage)) stages.set(f.stage, []);
            stages.get(f.stage)!.push(name);
        }
        const sortedStages = [...stages.keys()].sort((a, b) => a - b);
        for (const stage of sortedStages) {
            lines.push(`  subgraph cluster_${stage} {`);
            lines.push(`    label="${RenderStage[stage]}";`);
            lines.push('    style=dashed;');
            for (const n of stages.get(stage)!) lines.push(`    "${n}";`);
            lines.push('  }');
        }

        // Edges: producer → consumer for every reads/writes match.
        const producers = new Map<string, string>();
        for (const name of this._compiled!) {
            const f = this._byName.get(name)!;
            for (const w of f.writes) producers.set(w, name);
        }
        for (const name of this._compiled!) {
            const f = this._byName.get(name)!;
            for (const r of f.reads) {
                const p = producers.get(r);
                if (p && p !== name) lines.push(`  "${p}" -> "${name}" [label="${r}"];`);
            }
        }
        lines.push('}');
        return lines.join('\n');
    }

    /** Tear down all features, the resource pool, and the
     *  device-lost listener. Called by
     *  {@link FrameGraphRendererJob.destroy} on engine dispose. */
    public destroy(): void {
        if (typeof this._ctx.removeEventListener === 'function') {
            this._ctx.removeEventListener(Context3D.DEVICE_LOST, this._onDeviceLost, this);
        }
        for (const f of this._features) f.destroy();
        this._features.length = 0;
        this._byName.clear();
        this._compiled = null;
        this._dirty = true;
        this._pool.dispose();
    }

    private _producedBy(resource: string): boolean {
        for (const f of this._features) {
            if (f.writes.includes(resource)) return true;
        }
        return false;
    }
}
