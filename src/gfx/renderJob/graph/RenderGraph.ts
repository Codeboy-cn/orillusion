import { Context3D } from '../../graphics/webGpu/Context3D';
import { View3D } from '../../../core/View3D';
import { OcclusionSystem } from '../occlusion/OcclusionSystem';
import { GraphValidator, MissingCreatorError, topoSort, UnresolvedResourceError } from './GraphValidator';
import { RenderGraphBuilder, RenderGraphPass, RenderGraphPassContext } from './RenderGraphPass';
import { RenderGraphResourcePool } from './RenderGraphResourcePool';

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
 *     → pass.destroy()                 // on graph.destroy()
 *
 * The graph collects `b.read` / `b.write` calls into the pass's
 * `reads` / `writes` / `creates` arrays after setup runs, then freezes
 * them. See {@link RenderGraphPass} for the contract.
 *
 * @group Graph
 */
export class RenderGraph {
    private readonly _view: View3D;
    private readonly _ctx: Context3D;
    private readonly _pool: RenderGraphResourcePool;
    private readonly _passes: RenderGraphPass[] = [];
    private readonly _byName: Map<string, RenderGraphPass> = new Map();
    private _compiled: string[] | null = null;
    private _dirty: boolean = true;
    private _insertCounter: number = 0;
    private readonly _onDeviceLost: (event: { data: unknown }) => void;

    constructor(view: View3D) {
        this._view = view;
        this._ctx = view.engine3D.context3D;
        this._pool = new RenderGraphResourcePool(this._ctx);

        // Release pool registrations when the device is lost. Fresh
        // textures + buffers come back via re-init, so the next
        // `add()` cycle re-registers everything.
        this._onDeviceLost = () => this._pool.dispose();
        if (typeof this._ctx.addEventListener === 'function') {
            this._ctx.addEventListener(Context3D.DEVICE_LOST, this._onDeviceLost, this);
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
     *  factory + setup pipeline as `add`. */
    public replace<C extends new (...args: any[]) => RenderGraphPass>(
        name: string,
        Ctor: C,
        ...args: ConstructorParameters<C>
    ): InstanceType<C> {
        const idx = this._passes.findIndex(p => p.name === name);
        if (idx < 0) throw new Error(`RenderGraph.replace: pass '${name}' not found.`);
        const prev = this._passes[idx];
        prev.destroy();
        const pass = new Ctor(...args) as InstanceType<C>;
        this._setupAndRegister(pass);
        this._passes.splice(idx, 1, pass);
        this._byName.delete(name);
        this._byName.set(pass.name, pass);
        this._dirty = true;
        return pass;
    }

    /** Runtime kill switch. Disabled passes are skipped during execute
     *  but still participate in topology so the validator can still
     *  diagnose missing-producer errors against them. */
    public disablePass(name: string): this {
        const p = this._byName.get(name);
        if (!p) throw new Error(`RenderGraph.disablePass: pass '${name}' not found.`);
        p.enabled = false;
        return this;
    }

    public enablePass(name: string): this {
        const p = this._byName.get(name);
        if (!p) throw new Error(`RenderGraph.enablePass: pass '${name}' not found.`);
        p.enabled = true;
        return this;
    }

    /** Look up a pass by name. */
    public getPass<T extends RenderGraphPass = RenderGraphPass>(name: string): T | null {
        return (this._byName.get(name) as T | undefined) ?? null;
    }

    /** Validate + topologically sort. Idempotent — short-circuits if
     *  no mutation since the last compile. Throws GraphCompileError
     *  subclasses on validation failure. */
    public compile(): void {
        if (!this._dirty && this._compiled) return;
        const validator = new GraphValidator(this._passes);
        validator.validateSingleCreator();
        validator.validateResolvable();
        this._compiled = topoSort(this._passes, this._byName, this._insertedOrder.bind(this));
        this._dirty = false;
        console.debug('[RenderGraph] compiled pass order:', this._compiled.join(' → '));
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
        const ctx: RenderGraphPassContext = {
            view,
            occlusion,
            graph,
            frameIndex,
            get<T>(name: string): T {
                return pool.get<T>(name);
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
        }
        for (const p of this._passes) p.destroy();
        this._passes.length = 0;
        this._byName.clear();
        this._compiled = null;
        this._dirty = true;
        this._pool.dispose();
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
        const builder: RenderGraphBuilder = {
            context3D: this._ctx,
            view: this._view,
            graph: this,
            read: (n: string) => {
                if (!this._pool.has(n)) {
                    throw new UnresolvedResourceError(pass.name, n);
                }
                reads.push(n);
            },
            write: <T>(n: string, getter?: () => T): T | void => {
                if (!getter && !this._pool.has(n)) {
                    throw new MissingCreatorError(pass.name, n);
                }
                writes.push(n);
                if (getter) {
                    // Pool stores the getter itself — pool.get() calls it
                    // fresh each time. Pass authors close over a local
                    // variable / instance field for stable identity, or
                    // implement internal caching with rebuild-on-resize
                    // (see HiZPass._getOrAllocate).
                    this._pool.register(n, getter);
                    creates.push(n);
                    return getter();
                }
                return undefined;
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
