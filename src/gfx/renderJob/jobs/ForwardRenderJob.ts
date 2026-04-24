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
            let rtFrame = GBufferFrame.getGBufferFrame(GBufferFrame.colorPass_GBuffer, ctx);

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
