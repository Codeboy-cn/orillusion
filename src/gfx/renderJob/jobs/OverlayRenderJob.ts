import { View3D } from '../../../core/View3D';
import { RTFrame } from '../frame/RTFrame';
import { RendererJob } from './RendererJob';
import { RenderTexture } from '../../../textures/RenderTexture';
import { GPUTextureFormat } from '../../graphics/webGpu/WebGPUConst';
import { OverlayColorPassRenderer } from '../passRenderer/color/OverlayColorPassRenderer';
import { Camera3D } from '../../../core/Camera3D';
import { GlobalBindGroup } from '../../graphics/webGpu/core/bindGroups/GlobalBindGroup';
import { ProfilerUtil } from '../../../util/ProfilerUtil';

/**
 * Overlay Render Job
 * Rendering tasks for overlay layers do not clear the color buffer but clear the depth buffer.
 * It is suitable for objects that need to always be displayed on the topmost layer of the scene.
 * @group engine3D
 */
export class OverlayRenderJob extends RendererJob {
    private _overlayRTFrame: RTFrame;

    constructor(view: View3D) {
        super(view);
    }

    public start(): void {
        super.start();

        // Create a dedicated RTFrame for overlay rendering that outputs directly to canvas
        // This avoids issues with pixel picking mode where GBufferFrame has multiple render targets
        let rtFrame = this.getOverlayRTFrame();
        {
            let overlayColorPassRenderer = new OverlayColorPassRenderer();

            if (this._view.engine3D.setting.render.zPrePass && this.depthPassRenderer) {
                rtFrame.zPreTexture = this.depthPassRenderer.rendererPassState.depthTexture;
            }

            overlayColorPassRenderer.setRenderStates(this._view.engine3D.context3D, rtFrame);
            this.rendererMap.addRenderer(overlayColorPassRenderer);
        }

        if (this._view.engine3D.setting.render.debug) {
            this.debug();
        }
    }

    /**
     * Get or create an RTFrame for overlay rendering that outputs directly to canvas
     * without using GBuffer's multiple render targets. Bound per-instance so each
     * Engine3D gets its own depth texture.
     */
    private getOverlayRTFrame(): RTFrame {
        if (!this._overlayRTFrame) {
            const ctx = this._view.engine3D.context3D;
            const size = ctx.presentationSize;
            let rtFrame = new RTFrame([], []);

            let depthTexture = new RenderTexture(size[0], size[1], GPUTextureFormat.depth32float, false, undefined, 1, 0, true, true, ctx);
            depthTexture.name = `overlayDepthTexture`;
            rtFrame.depthTexture = depthTexture;
            rtFrame.depthLoadOp = 'clear';
            rtFrame.isOutTarget = true;

            this._overlayRTFrame = rtFrame;
        }
        return this._overlayRTFrame;
    }

    /**
     * Override renderFrame to skip presentContent
     * Overlay renders directly to canvas without final blit pass
     */
    public renderFrame() {
        let view = this._view;

        Camera3D.mainCamera = view.camera;

        ProfilerUtil.startView(view);

        GlobalBindGroup.getLightEntries(view.scene).update(view);

        this.occlusionSystem.update(view.camera, view.scene);

        // Only render the color pass - skip shadow, depth, post processing, and presentContent
        let passList = this.rendererMap.getAllPassRenderer();
        for (let i = 0; i < passList.length; i++) {
            const renderer = passList[i];
            renderer.compute(view, this.occlusionSystem);
            renderer.render(view, this.occlusionSystem, this.clusterLightingRender?.clusterLightingBuffer, false);
        }
    }

    public debug() {
    }
}
