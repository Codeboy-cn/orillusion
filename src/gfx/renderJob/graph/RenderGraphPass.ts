import { Context3D } from '../../graphics/webGpu/Context3D';
import { View3D } from '../../../core/View3D';
import { CEventDispatcher } from '../../../event/CEventDispatcher';
import { RenderNode } from '../../../components/renderer/RenderNode';
import { EntityCollect } from '../collect/EntityCollect';
import { RenderLayer } from '../config/RenderLayer';
import { OcclusionSystem } from '../occlusion/OcclusionSystem';
import { PassType } from '../passRenderer/state/PassType';
import { RenderGraph } from './RenderGraph';
import { Camera3D } from '../../../core/Camera3D';
import type { RTFrame } from '../frame/RTFrame';
import type { RenderGraphRenderTarget, RenderGraphRenderTargetDesc } from './RenderGraphRenderTarget';
import type { RenderGraphRenderPass, RenderPassOpenOptions } from './RenderGraphRenderPass';
import type { RenderGraphComputePass, ComputePipelineDesc } from './RenderGraphComputePass';

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
 *   factory; their order is determined by insertion order. Downstream
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
     *  ordering is by insertion. */
    write(name: string): void;

    /** Declare an explicit ordering dependency on another pass by
     *  name, independent of any read/write resource edge. Use this
     *  when the upstream pass produces side effects the downstream
     *  pass consumes through a non-graph channel (e.g. GPU indirect
     *  buffers consumed via GlobalBindGroup, or off-screen RTs
     *  consumed by sibling materials). The named pass must already
     *  be registered in the graph before this call. */
    dependsOn(passName: string): void;

    /**
     * Allocate a fresh typed {@link RenderGraphRenderTarget} (colors +
     * optional depth) and register it under `name`. Single-creator
     * rule applies — only one pass per `name` may call this. Internally
     * runs through `b.write(name, factory)` so the standard mutator
     * chain still orders downstream `b.useRenderTarget` writers.
     */
    createRenderTarget(name: string, desc: RenderGraphRenderTargetDesc): RenderGraphRenderTarget;

    /**
     * Adopt an externally-allocated {@link RTFrame} (e.g.
     * {@link GBufferFrame}) and publish it as a typed RT under `name`.
     * The wrapper does not own the underlying textures. Single-creator
     * rule applies.
     */
    adoptRenderTarget(
        name: string,
        rtFrame: RTFrame,
        opts?: { label?: string },
    ): RenderGraphRenderTarget;

    /**
     * Declare "this pass also writes to the RT named `name`" and
     * return a {@link RenderGraphRenderPass} handle the pass uses in
     * `execute()` to open the actual render pass encoder. Internally
     * a mutator-form `b.write(name)` — multiple passes may chain on
     * the same RT.
     *
     * The handle's loadOp / storeOp default to the per-frame
     * auto-derive rule (first writer => 'clear', subsequent =>
     * 'load'); `opts` lets a pass override either side explicitly
     * (e.g. a mid-frame ClearDepthPass forcing depth='clear').
     */
    useRenderTarget(name: string, options?: RenderPassOpenOptions): RenderGraphRenderPass;

    /**
     * Like {@link useRenderTarget} but does NOT register a mutator-write
     * edge on the RT. Returns a {@link RenderGraphRenderPass} handle the
     * pass can open in `execute()`.
     *
     * Use when ordering is controlled by insertion order (or explicit
     * `dependsOn`) rather than graph-derived mutator edges — the
     * canonical case is {@link ColorPass} and its subclasses in a
     * chained-opaque setup (e.g. Globe → ClearDepth → World). Declaring
     * a mutator-write there would chain every ColorPass instance into
     * the transmission/transparent mutator chain by insertedOrder,
     * which combined with an explicit `dependsOn` from the transparent
     * passes onto the second opaque pass produces a
     * {@link CyclicDependencyError} at compile.
     *
     * The framework's per-frame auto-derive rule still applies (the
     * underlying first-writer flag is set by every `begin()` call,
     * mutator or borrowed).
     */
    borrowRenderTarget(name: string, options?: RenderPassOpenOptions): RenderGraphRenderPass;

    /**
     * Build a private compute-pass handle (pipeline + lifecycle owned
     * by the caller). Does NOT register anything in the pool —
     * storage texture / buffer dependencies still flow through
     * `b.read` / `b.write`.
     */
    createComputePass(name: string, desc: ComputePipelineDesc): RenderGraphComputePass;
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

    /** Resolve a {@link RenderGraphRenderTarget} by name. Throws if
     *  the handle exists but is not a render target (validator should
     *  have caught it at compile, this is the defensive runtime
     *  check). */
    getRenderTarget(name: string): RenderGraphRenderTarget;

    /** Open the underlying `GPURenderPassEncoder` for a handle
     *  returned from `b.useRenderTarget(...)`. The encoder lifetime
     *  extends to the matching {@link endRenderPass}. */
    beginRenderPass(handle: RenderGraphRenderPass): GPURenderPassEncoder;

    /** Close the render pass encoder + submit the per-pass command
     *  buffer. Idempotent on already-ended handles. */
    endRenderPass(handle: RenderGraphRenderPass): void;

    /** Open the underlying `GPUComputePassEncoder` for a compute
     *  handle. Pipeline is lazily built on the first call. */
    beginComputePass(handle: RenderGraphComputePass): GPUComputePassEncoder;

    /** Close the compute pass encoder + submit the per-pass command
     *  buffer. */
    endComputePass(handle: RenderGraphComputePass): void;
}

/**
 * A single rendering capability in the graph. Subclasses declare
 * their identity via `name`, allocate GPU resources and declare
 * dependencies in `setup`, and submit GPU work in `execute`.
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

    /** Material-side pass types consumed. Optional; defaults to none
     *  for pure compute / copy passes. */
    public readonly materialPasses: readonly PassType[] = [];

    /** Runtime kill switch. `graph.disablePass(name)` flips this. A
     *  disabled pass is treated as if it weren't in the graph: it's
     *  filtered out before validation + topo sort, and skipped during
     *  execute. Disabling a producer whose output is read by another
     *  enabled pass makes the next `compile()` throw
     *  `UnresolvedResourceError`. */
    public enabled: boolean = true;

    /** Which scene layers this pass consumes, as a bitmask. Default
     *  {@link RenderLayer.All} reproduces the legacy "draw every
     *  collected node" behaviour. Custom passes (or custom
     *  {@link RendererJob}s wiring built-in passes) override this to
     *  restrict the pass to specific composition layers — combined
     *  with the active camera's `cullingMask` at execute time via
     *  bitwise AND, then matched against each node's `visibleLayer`:
     *
     *      (node.visibleLayer & pass.layerMask & camera.cullingMask) !== 0
     *
     *  Use {@link collectLayered} from inside `execute()` to fetch the
     *  filtered opaque/transparent lists; it threads `layerMask` and
     *  the camera mask through {@link EntityCollect.getLayerLists}. */
    public layerMask: number = RenderLayer.All;

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

    /** Explicit ordering dependencies on other pass names, set either
     *  from `setup()` via `b.dependsOn(name)` or by direct assignment
     *  before the next compile. Each entry adds a topo-sort edge
     *  `<name> → this`, independent of any resource edge. Use for
     *  side-effect dependencies the graph can't see (indirect buffers,
     *  off-screen RTs consumed via materials, etc.). */
    public dependencies?: ReadonlySet<string>;

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

    /**
     * Helper for subclasses: fetch opaque + transparent lists filtered
     * by this pass's {@link layerMask} and a camera's `cullingMask`.
     * Replaces the legacy
     * `EntityCollect.instance.getRenderNodes(view.scene, camera)`
     * call inside `execute()` — passes that don't override
     * `layerMask` get identical results because the default
     * `RenderLayer.All` mask is a no-op intersection.
     *
     * Shadow / reflection / GI-probe / scene-capture passes that
     * render through a non-main camera should pass that camera
     * explicitly so its own `cullingMask` (rather than the view's
     * main camera) participates in the bitwise AND.
     */
    protected collectLayered(
        view: View3D,
        camera?: Camera3D,
    ): { opaque: RenderNode[]; transparent: RenderNode[] } {
        const cam = camera ?? view.camera;
        const camMask = cam?.cullingMask ?? RenderLayer.All;
        return EntityCollect.instance.getLayerLists(view.scene, cam, this.layerMask, camMask);
    }
}
