import { Context3D } from '../../graphics/webGpu/Context3D';
import { View3D } from '../../../core/View3D';
import { CEventDispatcher } from '../../../event/CEventDispatcher';
import { OcclusionSystem } from '../occlusion/OcclusionSystem';
import { PassType } from '../passRenderer/state/PassType';
import { RenderGraph } from './RenderGraph';
import { RenderStage } from './RenderStage';

/**
 * Setup-time builder handed to {@link RenderGraphPass.setup}. A pass
 * uses this to declare its graph-level dependencies (`read`) and
 * outputs (`write`). The builder also exposes the owning view's
 * Context3D and the graph itself so passes can look up earlier-added
 * sibling passes when a setup-time reference is required.
 *
 * Two modes for `write`:
 * - **Creator** — `write(name, factory)`. Calls the factory to allocate
 *   the resource, registers it in the graph pool under `name`, and
 *   records `name` in this pass's `creates` set. Single-creator rule:
 *   only one pass per name may pass a factory.
 * - **Mutator** — `write(name)`. Declares this pass mutates a resource
 *   created elsewhere. Multiple passes may declare write without a
 *   factory; their order is determined by stage + insertion. Downstream
 *   reads see the latest writer's state.
 *
 * @group Graph
 */
export interface RenderGraphBuilder {
    /** Pass-owning view's Context3D. */
    readonly context3D: Context3D;

    /** Pass-owning view. */
    readonly view: View3D;

    /** The graph this pass is being added to. Use
     *  `graph.getPass<T>(name)` to look up earlier-added sibling
     *  passes (later ones aren't in the graph yet during setup). */
    readonly graph: RenderGraph;

    /** Declare a read dependency on a named resource. The named
     *  handle must have a creator before this pass executes;
     *  validator enforces. */
    read(name: string): void;

    /** Creator overload: declare a write to `name`, register `getter`
     *  in the pool. The `getter` is called every `pool.get(name)` —
     *  pass authors typically close over a local variable / instance
     *  field for stable identity (eager case), or implement internal
     *  caching that rebuilds on resize (lazy case). Returns
     *  `getter()` once for caller convenience. Single-creator rule
     *  applies. */
    write<T>(name: string, getter: () => T): T;

    /** Mutator overload: declare this pass writes to an existing
     *  named resource (created by another pass). Multi-mutator OK;
     *  ordering is by stage + insertion. */
    write(name: string): void;
}

/**
 * Runtime context handed to {@link RenderGraphPass.execute} once per
 * frame. `get<T>(name)` resolves a named handle through the graph
 * pool; `graph` is exposed so passes can look up sibling passes for
 * RPC-style calls (e.g. transparent passes calling into ColorPass's
 * public render methods).
 *
 * @group Graph
 */
export interface RenderGraphPassContext {
    readonly view: View3D;
    readonly occlusion: OcclusionSystem;
    readonly graph: RenderGraph;
    readonly frameIndex: number;

    /** Resolve a named resource through the graph pool. */
    get<T>(name: string): T;
}

/**
 * A single rendering capability in the graph. Subclasses declare
 * their position via `name` + `stage`, allocate GPU resources and
 * declare dependencies in `setup`, and submit GPU work in `execute`.
 *
 * `reads`, `writes`, and `creates` are populated by {@link RenderGraph.add}
 * after `setup()` runs, by recording the `b.read` / `b.write` calls
 * the pass made. They are then frozen.
 *
 * @group Graph
 */
export abstract class RenderGraphPass extends CEventDispatcher {
    /** Unique pass identifier. Used as the graph-node key and in
     *  error messages — prefer PascalCase ending in `Pass`
     *  (e.g. `ShadowPass`, `ColorPass`). */
    public abstract readonly name: string;

    /** Coarse bucket; see {@link RenderStage}. */
    public abstract readonly stage: RenderStage;

    /** Material-side pass types consumed. Optional; defaults to none
     *  for pure compute / copy passes. */
    public readonly materialPasses: readonly PassType[] = [];

    /** Runtime kill switch. `graph.disablePass(name)` flips this;
     *  disabled passes are skipped during execute but still
     *  participate in the compiled topology so the validator can
     *  diagnose missing-producer errors. */
    public enabled: boolean = true;

    /** Names this pass reads. Populated by `RenderGraph.add()` from
     *  `b.read(...)` calls inside `setup()`; frozen afterwards. */
    public readonly reads!: readonly string[];

    /** Names this pass writes (creator + mutator combined). Populated
     *  by `RenderGraph.add()` from `b.write(...)` calls inside
     *  `setup()`; frozen afterwards. */
    public readonly writes!: readonly string[];

    /** Subset of `writes` for which this pass was the creator (called
     *  `b.write(name, factory)`, not `b.write(name)`). The validator's
     *  single-creator rule operates on this set. */
    public readonly creates!: readonly string[];

    /** Allocate GPU resources, declare graph-level dependencies via
     *  `b.read` / `b.write`. Called once when `graph.add()` wires
     *  this pass into the graph. */
    public setup(_b: RenderGraphBuilder): void {
        // No-op by default.
    }

    /** Execute the pass for one frame. Implementations build command
     *  encoders via `ctx.view.engine3D.context3D.gpuContext`, read
     *  inputs via `ctx.get('<name>')`, and submit GPU work. */
    public abstract execute(ctx: RenderGraphPassContext): void;

    /** Optional teardown hook called from `graph.destroy()` — release
     *  orphan Object3Ds / view quads / device resources that the pass
     *  owns directly. */
    public destroy(): void {
        // No-op by default.
    }
}
