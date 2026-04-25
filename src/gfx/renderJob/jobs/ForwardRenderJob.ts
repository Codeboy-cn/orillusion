import { View3D } from '../../../core/View3D';
import { GlobalBindGroup } from '../../graphics/webGpu/core/bindGroups/GlobalBindGroup';
import { ColorPassRenderer } from '../passRenderer/color/ColorPassRenderer';
import { GBufferFrame } from '../frame/GBufferFrame';
import { RendererJob } from './RendererJob';
import { DDGIProbeRenderer } from '../passRenderer/ddgi/DDGIProbeRenderer';
/**
 * Forward+
 * Every time a forward rendering is performed, 
 * the entity of the object is rendered, and 
 * the color and depth buffer values are calculated. 
 * The depth buffer will determine whether a tile is visible. 
 * If visible, the values in the color buffer will be updated.
 * @group engine3D
 */
export class ForwardRenderJob extends RendererJob {
    constructor(view: View3D) {
        super(view);
    }

    public start(): void {
        super.start();
        const ctx = this.view.engine3D.context3D;
        const setting = this.view.engine3D.setting;
        {
            let colorPassRenderer = new ColorPassRenderer();
            // A7: validate MSAA value. WebGPU only mandates support for
            // sampleCount=1 and =4. 2x and 8x are device-dependent and
            // most desktop adapters expose them, but iOS Safari only
            // surfaces 4. Anything outside {0, 2, 4, 8} is rejected at
            // pipeline creation; clamp here so the user gets a clear
            // warning instead of an opaque pipeline error.
            const rawMsaa = (setting.render as any).msaa | 0;
            let msaa = rawMsaa;
            if (msaa !== 0 && msaa !== 2 && msaa !== 4 && msaa !== 8) {
                console.warn(`[transparency] engine.setting.render.msaa = ${rawMsaa} is not a supported sample count. Valid values: 0 | 2 | 4 | 8. Falling back to 0 (MSAA disabled).`);
                msaa = 0;
            }
            // A6: when the main color pass uses MSAA AND ships the
            // compress g-buffer, the post-effect chain (SSR/SSAO/GTAO/...)
            // sees garbage because rgba32float can't be MSAA-resolved
            // by WebGPU. We don't auto-disable post effects (users may
            // not have any wired up) but emit a one-time warning so
            // developers know what they signed up for.
            if (msaa > 0 && (setting.render as any).useCompressGBuffer) {
                console.warn(`[transparency] msaa=${msaa} with useCompressGBuffer=true. The rgba32float g-buffer cannot be MSAA-resolved; post-effects that read it (SSR, SSAO, GTAO, GodRay, GlobalFog, DepthOfField, TAA) will see undefined contents. Either disable MSAA or disable useCompressGBuffer.`);
            }
            let rtFrame = GBufferFrame.getGBufferFrame(GBufferFrame.colorPass_GBuffer, ctx, 0, 0, true, undefined, msaa);

            if (setting.render.zPrePass) {
                rtFrame.zPreTexture = this.depthPassRenderer.rendererPassState.depthTexture;
            }

            colorPassRenderer.setRenderStates(ctx, rtFrame);

            if (setting.gi.enable) {
                let lightEntries = GlobalBindGroup.getLightEntries(this.view.scene);
                this.ddgiProbeRenderer = new DDGIProbeRenderer(ctx, lightEntries.irradianceVolume);
                // Phase D: setInputTexture stays here because it
                // allocates sub-passes (DDGILightingPass etc) that
                // must only be constructed once. setIrradiance was
                // the other legacy hard-wire — it is now called
                // every frame from ColorFeature.execute, so the
                // ColorPass → DDGI wire flows through the graph
                // pool instead of a one-shot assignment.
                this.ddgiProbeRenderer.setInputTexture([
                    this.shadowMapPassRenderer.depth2DArrayTexture,
                    this.pointLightShadowRenderer.cubeArrayTexture
                ]);
                this.rendererMap.addRenderer(this.ddgiProbeRenderer);
            }

            this.rendererMap.addRenderer(colorPassRenderer);
        }

        if (setting.render.debug) {
            this.debug();
        }
    }

    /**
     * @internal
     */
    public debug() {
    }

}
