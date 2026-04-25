import { ColorPassRenderer } from '../../passRenderer/color/ColorPassRenderer';
import { ClusterLightingRender } from '../../passRenderer/cluster/ClusterLightingRender';
import { OcclusionSystem } from '../../occlusion/OcclusionSystem';
import { FeatureContext, RenderFeature } from '../RenderFeature';
import { RenderStage } from '../RenderStage';
import { COLOR_BUFFER } from './ColorFeature';
import { SCENE_COLOR_PYRAMID } from './SceneColorPyramidFeature';

/**
 * Frame Graph feature that draws opaque materials with transmission
 * (`transmissionFactor > 0`) AFTER the SceneColorPyramid has captured
 * the rest of the opaque world.
 *
 * Why split: transmission materials sample the pyramid for refraction
 * (and, in alpha-cutout mode, alpha). If they were drawn alongside
 * other opaque materials in the main {@link ColorFeature} pass, their
 * own writes would land in the pyramid before they get a chance to
 * sample it — at the dragon's screen position the pyramid would store
 * the dragon, not whatever cloth / wall sits behind it. Deferring the
 * transmission draws to after the pyramid copy gives the refraction
 * shader a clean view of "what's behind the glass".
 *
 * Stage is {@link RenderStage.AfterOpaque}; the reads on
 * `_SceneColorPyramid` make the topo-sort place this feature strictly
 * after {@link SceneColorPyramidFeature}. The continuation pass uses
 * `loadOp='load'`, preserving the cloth / floor / etc. that the main
 * opaque pass wrote.
 *
 * @group Graph
 */
export class TransmissionOpaqueFeature extends RenderFeature {
    public readonly name = 'TransmissionOpaqueFeature';
    public readonly stage = RenderStage.AfterOpaque;
    public readonly reads = [COLOR_BUFFER, SCENE_COLOR_PYRAMID];
    public readonly writes: readonly string[] = [];

    private readonly _impl: ColorPassRenderer;
    private readonly _occlusion: OcclusionSystem;
    private readonly _clusterLighting: ClusterLightingRender;

    constructor(
        impl: ColorPassRenderer,
        occlusion: OcclusionSystem,
        clusterLighting: ClusterLightingRender,
    ) {
        super();
        this._impl = impl;
        this._occlusion = occlusion;
        this._clusterLighting = clusterLighting;
    }

    public execute(ctx: FeatureContext): void {
        this._impl.renderTransmissionContinuation(
            ctx.view,
            this._occlusion,
            this._clusterLighting.clusterLightingBuffer,
        );
    }
}
