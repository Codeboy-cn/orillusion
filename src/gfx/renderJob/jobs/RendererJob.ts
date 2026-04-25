import { Scene3D } from '../../../core/Scene3D';
import { View3D } from '../../../core/View3D';
import { PickFire } from '../../../io/PickFire';
import { ColorPassRenderer } from '../passRenderer/color/ColorPassRenderer';
import { GBufferFrame } from '../frame/GBufferFrame';
import { OcclusionSystem } from '../occlusion/OcclusionSystem';
import { ClusterLightingRender } from '../passRenderer/cluster/ClusterLightingRender';
import { PointLightShadowRenderer } from '../passRenderer/shadow/PointLightShadowRenderer';
import { ShadowMapPassRenderer } from '../passRenderer/shadow/ShadowMapPassRenderer';
import { PreDepthPassRenderer } from '../passRenderer/preDepth/PreDepthPassRenderer';
import { RendererMap } from './RenderMap';
import { PostRenderer } from '../passRenderer/post/PostRenderer';
import { PostBase } from '../post/PostBase';
import { RendererBase } from '../passRenderer/RendererBase';
import { Ctor } from '../../../util/Global';
import { DDGIProbeRenderer } from '../passRenderer/ddgi/DDGIProbeRenderer';
import { ReflectionRenderer } from '../passRenderer/cubeRenderer/ReflectionRenderer';
import { PassType } from '../passRenderer/state/PassType';
import { FXAAPost } from '../post/FXAAPost';
import { TonemapPost } from '../post/TonemapPost';

/**
 * render jobs 
 * @internal
 * @group Post
 */
export class RendererJob {

    /**
     * @internal
     */
    public rendererMap: RendererMap;

    /**
     * @deprecated Phase D: Frame Graph owns all pass scheduling.
     *             Use `view.renderGraph.getFeature('ShadowFeature')!.impl`
     *             for the CSM cascade renderer; direct field access
     *             is retained as a compatibility shim for one minor
     *             version.
     * @internal
     */
    public shadowMapPassRenderer: ShadowMapPassRenderer;

    /**
     * @deprecated Phase D: use
     *             `view.renderGraph.getFeature('PointShadowFeature')!.impl`.
     * @internal
     */
    public pointLightShadowRenderer: PointLightShadowRenderer;

    /**
     * @deprecated Phase D: use
     *             `view.renderGraph.getFeature('GIFeature')!.impl` when
     *             `setting.gi.enable` is true.
     * @internal
     */
    public ddgiProbeRenderer: DDGIProbeRenderer;

    /**
     * @deprecated Phase D: use
     *             `view.renderGraph.getFeature('PostFeature')!.impl`
     *             — that feature wraps the whole post chain.
     * @internal
     */
    public postRenderer: PostRenderer;

    /**
     * @deprecated Phase D: use
     *             `view.renderGraph.getFeature('ClusterLightingFeature')!.impl`.
     * @internal
     */
    public clusterLightingRender: ClusterLightingRender;

    /**
     * @deprecated Phase D: use
     *             `view.renderGraph.getFeature('ReflectionFeature')!.impl`.
     * @internal
     */
    public reflectionRenderer: ReflectionRenderer;

    /**
     * @internal
     */
    public occlusionSystem: OcclusionSystem;

    /**
     * @deprecated Phase D: use
     *             `view.renderGraph.getFeature('PreDepthFeature')!.impl`
     *             when `setting.render.zPrePass` is true.
     * @internal
     */
    public depthPassRenderer: PreDepthPassRenderer;

    /**
       * @internal
       */
    public get colorPassRenderer(): ColorPassRenderer {
        let renderer = this.rendererMap.getRenderer(PassType.COLOR);
        return renderer as ColorPassRenderer;
    }

    /**
     * @internal
     */
    public pauseRender: boolean = false;
    public pickFire: PickFire;
    public renderState: boolean = false;
    protected _view: View3D;

    /**
     * Create a renderer task class
     * @param scene Scene3D {@link Scene3D}
     */
    constructor(view: View3D) {
        this._view = view;
        const ctx = view.engine3D.context3D;

        this.rendererMap = new RendererMap();

        this.occlusionSystem = new OcclusionSystem(view);

        this.clusterLightingRender = this.addRenderer(ClusterLightingRender, view);

        this.reflectionRenderer = this.addRenderer(ReflectionRenderer, view);

        if (view.engine3D.setting.render.zPrePass) {
            this.depthPassRenderer = this.addRenderer(PreDepthPassRenderer, ctx);
        }

        this.shadowMapPassRenderer = new ShadowMapPassRenderer(ctx);

        this.pointLightShadowRenderer = new PointLightShadowRenderer(ctx);

        this.addPost(new FXAAPost());
        // Final ACES Filmic tonemap. Always attached; PostRenderer
        // routes `isFinalPass=true` posts to the end of the chain
        // regardless of attach order, so user posts that come later
        // (Bloom, GodRay, Outline) still feed their HDR output into
        // the curve. Disable per-instance via
        // `setting.render.tonemap.enable = false`.
        if (view.engine3D.setting.render.tonemap?.enable !== false) {
            this.addPost(new TonemapPost());
        }
    }

    public addRenderer<T extends RendererBase>(c: Ctor<T>, param?: any): T {
        let renderer: RendererBase;
        if (param) {
            renderer = new c(param);
        } else {
            renderer = new c();
        }
        this.rendererMap.addRenderer(renderer);
        return renderer as T;
    }

    /**
     * @internal
     */
    public get view(): View3D {
        return this._view;
    }

    public set view(view: View3D) {
        this._view = view;
    }

    /**
     * start render task
     */
    public start() {
        this.renderState = true;
    }

    // public get guiCanvas(): UICanvas {
    //     return this._canvas;
    // }

    /**
     * stop render task
     */
    public stop() { }

    /**
     * pause render task
     */
    public pause() {
        this.pauseRender = true;
    }

    /**
     * back render task
     */
    public resume() {
        this.pauseRender = false;
    }

    /**
     * Add a post processing special effects task
     * @param post
     */
    public addPost(post: PostBase): PostBase | PostBase[] {
        if (!this.postRenderer) {
            const ctx = this._view.engine3D.context3D;
            let gbufferFrame = GBufferFrame.getGBufferFrame('ColorPassGBuffer', ctx);
            this.postRenderer = this.addRenderer(PostRenderer);
            this.postRenderer.initRenderer(ctx);
            this.postRenderer.setRenderStates(ctx, gbufferFrame);
        }

        if (post instanceof PostBase) {
            this.postRenderer.attachPost(this.view, post);
        }
        return post;
    }

    /**
     * Remove specified post-processing effects
     * @param post
     */
    public removePost(post: PostBase | PostBase[]) {
        if (post instanceof PostBase) {
            this.postRenderer.detachPost(this.view, post);
        } else {
            for (let i = 0; i < post.length; i++) {
                this.postRenderer.detachPost(this.view, post[i]);
            }
        }
    }

    /**
     * Render one frame of the scene. Phase D removed the
     * hardcoded 50-line sequence that used to live here — the
     * Frame Graph now owns all render ordering, and
     * {@link FrameGraphRendererJob.renderFrame} drives the graph.
     *
     * This base method is kept as a deprecated no-op so that
     * external code extending `RendererJob` directly (rare) still
     * compiles; the `useFrameGraph = false` escape hatch is gone.
     */
    public renderFrame() {
        console.warn('[RendererJob] renderFrame() is a no-op after Phase D. ' +
            'Use FrameGraphRendererJob (the default under useFrameGraph=true) or extend it directly.');
    }

    public debug() {

    }

    // Called from Engine3D.dispose(). Tears down the renderer-owned orphan
    // Object3Ds (cube cameras, view quads, helper lights) that are never
    // attached to the scene graph, so scene.destroy() never reaches them.
    // Without this the Matrix4 slot table leaks ~60 entries per reinit.
    public destroy(force?: boolean) {
        (this.reflectionRenderer as any)?.destroy?.(force);
        (this.ddgiProbeRenderer as any)?.destroy?.(force);
        (this.postRenderer as any)?.destroy?.(force);
    }
}
