import { ClusterLightingBuffer } from '../../passRenderer/cluster/ClusterLightingBuffer';
import { ClusterLightingRender } from '../../passRenderer/cluster/ClusterLightingRender';
import { OcclusionSystem } from '../../occlusion/OcclusionSystem';
import { FeatureContext, RenderFeature } from '../RenderFeature';
import { RenderStage } from '../RenderStage';

/**
 * Published handle name for the cluster lighting buffer. Consumers
 * (ColorFeature, post volumetric passes) should reads this name
 * instead of reaching into `renderJob.clusterLightingRender`.
 *
 * @group Graph
 */
export const CLUSTER_LIGHTING_BUFFER = '_ClusterLightingBuffer';

/**
 * C1 of the Phase C migration: wraps {@link ClusterLightingRender} as a
 * {@link RenderFeature}. No GPU logic moves — this is a thin adapter
 * so the compute dispatch runs under the graph and downstream
 * features can declare `reads: [CLUSTER_LIGHTING_BUFFER]` instead of
 * grabbing the buffer off the job.
 *
 * The produced resource is registered as an **external** handle: its
 * GPU lifetime is owned by `ClusterLightingRender.clusterLightingBuffer`,
 * which predates the Frame Graph and already has resize / buffer
 * rebuild logic. Registering it as external lets the graph treat the
 * handle as satisfiable (validator won't flag downstream `reads` as
 * unresolved) without the resource pool trying to re-allocate it.
 *
 * @group Graph
 */
export class ClusterLightingFeature extends RenderFeature {
    public readonly name = 'ClusterLightingFeature';
    public readonly stage = RenderStage.BeforeShadows;
    public readonly writes = [CLUSTER_LIGHTING_BUFFER];

    private readonly _impl: ClusterLightingRender;
    private readonly _occlusion: OcclusionSystem;

    constructor(impl: ClusterLightingRender, occlusion: OcclusionSystem) {
        super();
        this._impl = impl;
        this._occlusion = occlusion;
    }

    /** The underlying legacy renderer, exposed for FrameGraphRendererJob
     *  so the shared `clusterLightingBuffer` stays reachable from the
     *  ColorPassRenderer until C7 lands. */
    public get impl(): ClusterLightingRender {
        return this._impl;
    }

    /** Install the getter for `_ClusterLightingBuffer` on the pool.
     *  Called by {@link FrameGraphRendererJob} at construction time so
     *  the handle resolves before the first frame runs. The getter
     *  returns the current `clusterLightingBuffer`, which handles its
     *  own resize / rebuild lifecycle. */
    public registerResources(pool: { registerExternal<T>(name: string, getter: () => T): void }): void {
        pool.registerExternal<ClusterLightingBuffer>(
            CLUSTER_LIGHTING_BUFFER,
            () => this._impl.clusterLightingBuffer,
        );
    }

    public execute(ctx: FeatureContext): void {
        this._impl.render(ctx.view, this._occlusion);
    }
}
