import { View3D } from '../../../../core/View3D';
import { RenderTexture } from '../../../../textures/RenderTexture';
import { GlobalBindGroup } from '../../../graphics/webGpu/core/bindGroups/GlobalBindGroup';
import { ClusterLightingBuffer } from '../../passRenderer/cluster/ClusterLightingBuffer';
import { RenderContext } from '../../passRenderer/RenderContext';
import { PassType } from '../../passRenderer/state/PassType';
import { RendererPassState } from '../../passRenderer/state/RendererPassState';
import { RenderGraphBuilder, RenderGraphPass, RenderGraphPassContext } from '../RenderGraphPass';
import { buildOpBundles, dependOnIfRegistered } from './_helpers';
import { ClusterLightingPass, CLUSTER_LIGHTING_BUFFER } from './ClusterLightingPass';
import { MAIN_SHADOW_MAP } from './ShadowPass';
import { POINT_SHADOW_CUBE_ARRAY } from './PointShadowPass';
import { REFLECTION_CUBE_MAP } from './ReflectionPass';
import { DDGI_DEPTH_MAP, DDGI_IRRADIANCE_MAP } from './GIPass';
import { drawNodes, TRANSPARENT_DRAW_CTX, TransparentDrawContext } from './_transparentDraw';

// Re-export the shared draw-context contract through ColorPass so users
// hitting the package barrel (`@orillusion/core`) can resolve
// TRANSPARENT_DRAW_CTX / TransparentDrawContext without reaching into
// the `_transparentDraw` module (which sits beneath a leading-underscore
// filename convention that the public export aggregator skips).
export {
    TRANSPARENT_DRAW_CTX,
    type TransparentDrawContext,
    drawNodes,
    drawSortedTransparent,
    drawTransmissionContinuation,
    type DrawNodesOptions,
    type OitFilter,
    type TransmissionFilter,
} from './_transparentDraw';

/**
 * Published handle names for the main color pass outputs.
 *
 * - `_ColorBuffer`: the final shaded color target (rgba16float,
 *   scene-sized). Post passes read this as their first input.
 * - `_NormalBuffer`: the compressed G-buffer attachment that packs
 *   normal + position + material data (rgba32float). Post passes
 *   that need geometry info (SSR, SSGI, outline) decode it themselves.
 *
 * @group Graph
 */
export const COLOR_BUFFER = '_ColorBuffer';
export const NORMAL_BUFFER = '_NormalBuffer';

/**
 * Main forward color pass. Single responsibility: draw the opaque half
 * of the scene (transmission materials excluded so the
 * {@link SceneColorPyramidPass} snapshot that follows sees the world
 * *behind* the glass, not the glass itself).
 *
 * Sky is rendered separately by {@link SkyPass} — chain it after this
 * pass in the renderer job. Transparent / transmission halves
 * ({@link TransmissionOpaquePass}, {@link SortedTransparentPass})
 * reopen the color attachment with `loadOp='load'` via the shared
 * {@link TRANSPARENT_DRAW_CTX}.
 *
 * The shared g-buffer + render-context plumbing this pass draws into
 * is owned by {@link GBufferResourcePass}. Multiple ColorPass
 * instances can coexist in one graph (e.g. terrain → clear-depth →
 * world) since none of them are the resource creator.
 *
 * @group Graph
 */
export class ColorPass extends RenderGraphPass {
    public readonly name: string = 'ColorPass';

    public rendererPassState!: RendererPassState;

    protected readonly _passType: PassType = PassType.COLOR;
    protected readonly _giEnabled: boolean;
    protected _renderContext!: RenderContext;
    protected _splitRendererPassState!: RendererPassState;

    constructor(public readonly config: { giEnabled: boolean } = { giEnabled: false }) {
        super();
        this._giEnabled = config.giEnabled;
    }

    public setup(b: RenderGraphBuilder): void {
        b.read(TRANSPARENT_DRAW_CTX);
        // Note: ColorPass deliberately does NOT declare `b.write(COLOR_BUFFER)`.
        // It does mutate the color attachment at runtime (via the encoder
        // opened through the shared RenderContext), but advertising that
        // as a graph mutator-write would chain every ColorPass instance
        // by insertedOrder onto every downstream COLOR_BUFFER mutator
        // (transmission, sorted-transparent, etc.). In a chained-opaque
        // setup (e.g. Globe → ClearDepth → World), that chain forces the
        // second ColorPass to run after the transparent half — directly
        // contradicting any explicit `transparent.dependsOn(world)` edge
        // and producing a CyclicDependencyError at compile time.
        // Ordering relative to SkyPass / transparent passes is held by
        // ForwardRendererJob's add() sequence (insertedOrder Kahn
        // tie-break), which is reliable when the renderer job is the
        // single source of truth for pass registration.
        this.declareShadingReads(b);
        this.declareSideEffects(b);
    }

    /** Declare the per-frame shading inputs this pass reads. Override
     *  to add/remove shading deps (e.g. skip shadow read in a depth-only
     *  variant). */
    protected declareShadingReads(b: RenderGraphBuilder): void {
        b.read(CLUSTER_LIGHTING_BUFFER);
        b.read(MAIN_SHADOW_MAP);
        b.read(POINT_SHADOW_CUBE_ARRAY);
        b.read(REFLECTION_CUBE_MAP);
        if (this._giEnabled) {
            b.read(DDGI_IRRADIANCE_MAP);
            b.read(DDGI_DEPTH_MAP);
        }
    }

    /** Declare any non-resource ordering constraints. SceneCapturePass
     *  renders off-screen RTs that this frame's lit materials sample
     *  directly via SceneCaptureCameraComponent (no graph-pool handle).
     *  GPUCullPass (when present) populates the indirect draw buffers
     *  consumed through GlobalBindGroup. Neither flows as a `b.read`, so
     *  we declare the ordering explicitly. */
    protected declareSideEffects(b: RenderGraphBuilder): void {
        dependOnIfRegistered(b, 'SceneCapturePass', 'GPUCullPass');
    }

    public execute(ctx: RenderGraphPassContext): void {
        // Resolve the shared render-pass state + encoder published by
        // GBufferResourcePass. Cached on `this` for the duration of
        // execute so beginColorRenderPass overrides can reach the same
        // fields the legacy API exposed.
        const drawCtx = ctx.get<TransparentDrawContext>(TRANSPARENT_DRAW_CTX);
        this.rendererPassState = drawCtx.rendererPassState;
        this._splitRendererPassState = drawCtx.splitRendererPassState;
        this._renderContext = drawCtx.renderContext;

        // Wire DDGI irradiance through the pool every frame so a
        // future GI swap takes effect on the next frame (edit GIPass
        // → irradiance updates, no restart).
        if (this._giEnabled) {
            const irradianceColor = ctx.get<RenderTexture>(DDGI_IRRADIANCE_MAP);
            const irradianceDepth = ctx.get<RenderTexture>(DDGI_DEPTH_MAP);
            if (irradianceColor && irradianceDepth) {
                this.rendererPassState.irradianceBuffer = [irradianceColor, irradianceDepth];
            }
        }

        const view = ctx.view;
        const camera = view.camera;
        const cluster = this._getCluster(view);

        const gpu = view.engine3D.context3D.gpuContext;
        this._renderContext.gpu = gpu;
        // Opaque-half call owns the render context — start fresh. The
        // continuation halves (transmission, transparent) reopen with
        // loadOp='load'.
        this._renderContext.clean();

        GlobalBindGroup.updateCameraGroup(camera);
        this.rendererPassState.camera3D = camera;

        const layered = this.collectLayered(view);

        const opBundles = buildOpBundles(view, camera, this._passType, this.rendererPassState, cluster);

        this.beginColorRenderPass();
        const encoder = this._renderContext.encoder;

        if (opBundles.length > 0) {
            encoder.executeBundles(opBundles);
        }

        // bindCamera is unconditional: any continuation pass that
        // reuses this encoder via the split render-pass state relies
        // on the per-camera bind group being bound at group 0,
        // independent of whether the opaque list was empty this frame.
        gpu.bindCamera(encoder, camera);
        if (layered.opaque.length > 0) {
            drawNodes(
                view,
                this._renderContext,
                this.rendererPassState,
                layered.opaque,
                cluster,
                { transmissionFilter: 'exclude', passType: this._passType },
            );
        }

        this._renderContext.endRenderPass();
    }

    /** Open the render pass that the opaque draw records into.
     *  Default opens with color='clear', depth='clear' via
     *  {@link RenderContext.beginOpaqueRenderPass}. Override to chain
     *  onto a previous pass (color='load', depth='load') — e.g. a second
     *  opaque pass that draws after a ClearDepthPass. */
    protected beginColorRenderPass(): void {
        this._renderContext.beginOpaqueRenderPass();
    }

    protected _getCluster(view: View3D): ClusterLightingBuffer | undefined {
        return view.renderGraph?.getPass<ClusterLightingPass>('ClusterLightingPass')?.clusterLightingBuffer;
    }
}
