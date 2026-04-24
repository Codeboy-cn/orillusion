import { View3D } from '../../../core/View3D';
import { PassType } from '../passRenderer/state/PassType';
import { OcclusionSystem } from '../occlusion/OcclusionSystem';
import { ResourceHandle } from './ResourceHandle';
import { RenderStage } from './RenderStage';

/**
 * Runtime inputs handed to a {@link RenderFeature.execute} call. Wrapped
 * in a single object so adding optional facets (device lost token,
 * per-view statistics, profiling scope) later does not change the
 * execute signature for every feature.
 *
 * @group Graph
 */
export interface FeatureContext {
    /** The view currently being rendered. Features access the camera,
     *  scene, Engine3D, Context3D through this handle. */
    readonly view: View3D;

    /** Occlusion results for the active view. Shared across features
     *  that draw geometry — the main color pass, the shadow pass, and
     *  the depth prepass all consume the same snapshot. */
    readonly occlusion: OcclusionSystem;

    /** Monotonically increasing frame counter for the owning engine.
     *  Features that keep per-frame history (TAA, motion blur) key off
     *  this to decide whether to reproject or reset. */
    readonly frameIndex: number;

    /**
     * Resolve a named resource to its concrete GPU object. Implemented
     * by {@link RenderGraph} — it delegates to the resource pool and
     * keeps a per-feature audit trail of reads so the validator can
     * report "feature read a handle it didn't declare".
     */
    get<T>(name: string): T;
}

/**
 * Declarative setup handle passed to {@link RenderFeature.setup}. A
 * feature uses this to register handles for resources it creates
 * (typically its writes) — the graph collects these so the pool can
 * pre-allocate and the validator can check reads-writes closure.
 *
 * setup() is called once per `graph.compile()`, execute() is called
 * once per frame. Device resources should be declared here, not
 * allocated here.
 *
 * @group Graph
 */
export interface RenderGraphBuilder {
    /** Register a resource handle the feature intends to write. */
    declare(handle: ResourceHandle): void;

    /** Register a resource handle the feature intends to read. */
    require(name: string): void;
}

/**
 * A single rendering capability in the Frame Graph. One `RenderFeature`
 * subclass replaces one of the old *Renderer classes (ShadowMapPassRenderer,
 * ColorPassRenderer, etc.) — the feature declares what it reads and
 * writes, the graph orders the execution.
 *
 * Contract:
 * - `reads` / `writes` are **complete** lists. Runtime reads of an
 *   undeclared name raise `UnresolvedResourceError` in dev builds.
 * - `stage` is the coarse bucket; within a stage, reads/writes drive
 *   order. Cross-stage reads must flow forward (later stage reads
 *   earlier stage's writes); the validator catches violations.
 * - `materialPasses` lists which material-side PassTypes the feature
 *   consumes. Phase E will drive lazy `PassGenerate` off this.
 *
 * @group Graph
 */
export abstract class RenderFeature {
    /** Unique feature identifier. Used as the graph-node key and in
     *  error messages — prefer PascalCase ending in `Feature`
     *  (e.g. `ShadowFeature`, `ColorFeature`). */
    public abstract readonly name: string;

    /** Coarse bucket; see {@link RenderStage}. */
    public abstract readonly stage: RenderStage;

    /** Names of resources this feature consumes. Must be a complete
     *  list — undeclared reads fail validation. */
    public readonly reads: readonly string[] = [];

    /** Names of resources this feature produces. */
    public readonly writes: readonly string[] = [];

    /** Material-side pass types consumed. Optional; defaults to none
     *  for pure compute / copy features. */
    public readonly materialPasses: readonly PassType[] = [];

    /** Runtime-toggleable kill switch. `graph.disableFeature(name)`
     *  flips this; disabled features are skipped during execute but
     *  still participate in the compiled topology (the validator can
     *  still diagnose missing-producer errors against them). */
    public enabled: boolean = true;

    /**
     * Declare resources. Called during `graph.compile()`, not every
     * frame. The default implementation does nothing — override when
     * the feature produces handles the pool needs to allocate.
     */
    public setup(_builder: RenderGraphBuilder): void {
        // No-op by default.
    }

    /**
     * Execute the feature for one frame. Implementations build command
     * encoders via `ctx.view.engine3D.context3D.gpuContext`, read
     * inputs via `ctx.get('<name>')`, and submit GPU work.
     */
    public abstract execute(ctx: FeatureContext): void;

    /** Optional teardown hook called from `graph.destroy()`. Mirror of
     *  RendererJob.destroy() — release orphan Object3Ds / view quads
     *  that the feature owns. */
    public destroy(): void {
        // No-op by default.
    }
}
