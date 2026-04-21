import { View3D } from "../../../../core/View3D";
import { ProfilerUtil } from "../../../../util/ProfilerUtil";
import { GlobalBindGroup } from "../../../graphics/webGpu/core/bindGroups/GlobalBindGroup";
import { EntityCollect } from "../../collect/EntityCollect";
import { OcclusionSystem } from "../../occlusion/OcclusionSystem";
import { ClusterLightingBuffer } from "../cluster/ClusterLightingBuffer";
import { ColorPassRenderer } from "./ColorPassRenderer";

/**
 * Overlay Color Pass Renderer
 * Used for rendering the overlay layer, without clearing the color buffer but clearing the depth buffer.
 * @internal
 * @group Post
 */
export class OverlayColorPassRenderer extends ColorPassRenderer {
    constructor() {
        super();
    }

    public render(view: View3D, occlusionSystem: OcclusionSystem, clusterLightingBuffer?: ClusterLightingBuffer, maskTr: boolean = false) {
        const gpu = view.engine3D.context3D.gpuContext;
        this.renderContext.gpu = gpu;
        this.renderContext.clean();

        let scene = view.scene;
        let camera = view.camera;

        // Upload this camera's matrices to the per-context global uniform.
        // ColorPassRenderer.render does this before drawing; this override
        // skipped it, so overlay sprites were being rendered with whatever
        // camera matrices the main view's render job last uploaded —
        // putting screen-space sprites at random points in 3D space.
        GlobalBindGroup.updateCameraGroup(camera);

        this.rendererPassState.camera3D = camera;
        let collectInfo = EntityCollect.instance.getRenderNodes(scene, camera);

        let op_bundleList = this.renderBundleOp(view, collectInfo, occlusionSystem, clusterLightingBuffer);
        let tr_bundleList = maskTr ? [] : this.renderBundleTr(view, collectInfo, occlusionSystem, clusterLightingBuffer);

        ProfilerUtil.start("overlayColorPass Renderer");
        {
            ProfilerUtil.start("OverlayColorPass Draw Opaque");

            this.renderContext.beginContinueRendererPassState('load', 'clear');
            this.renderContext.begineNewCommand();
            this.renderContext.beginNewEncoder();

            let command = this.renderContext.command;
            let renderPassEncoder = this.renderContext.encoder;

            gpu.bindCamera(renderPassEncoder, camera);

            if (op_bundleList.length > 0) {
                renderPassEncoder.executeBundles(op_bundleList);
            }

            // Usually, a skybox is not necessary.
            // if (!maskTr && EntityCollect.instance.sky) {
            //     gpu.bindCamera(renderPassEncoder, camera);
            //     if (!EntityCollect.instance.sky.preInit) {
            //         EntityCollect.instance.sky.nodeUpdate(view, this._rendererType, this.rendererPassState, clusterLightingBuffer);
            //     }
            //     EntityCollect.instance.sky.renderPass2(view, this._rendererType, this.rendererPassState, clusterLightingBuffer, renderPassEncoder);
            // }

            if (collectInfo.opaqueList) {
                gpu.bindCamera(renderPassEncoder, camera);
                this.drawNodes(view, this.renderContext, collectInfo.opaqueList, occlusionSystem, clusterLightingBuffer);
                this.renderContext.endRenderPass();
                ProfilerUtil.end("OverlayColorPass Draw Opaque");
            }
        }

        {
            ProfilerUtil.start("OverlayColorPass Draw Transparent");

            this.renderContext.beginTransparentRenderPass();

            let command = this.renderContext.command;
            let renderPassEncoder = this.renderContext.encoder;

            if (tr_bundleList.length > 0) {
                renderPassEncoder.executeBundles(tr_bundleList);
            }

            if (!maskTr && collectInfo.transparentList) {
                gpu.bindCamera(renderPassEncoder, camera);
                this.drawNodes(view, this.renderContext, collectInfo.transparentList, occlusionSystem, clusterLightingBuffer);
            }

            let graphicsList = EntityCollect.instance.getGraphicList();
            for (let i = 0; i < graphicsList.length; i++) {
                const graphic3DRenderNode = graphicsList[i];
                let matrixIndex = graphic3DRenderNode.transform.worldMatrix.index;
                graphic3DRenderNode.nodeUpdate(view, this._rendererType, this.splitRendererPassState, clusterLightingBuffer);
                graphic3DRenderNode.renderPass2(view, this._rendererType, this.splitRendererPassState, clusterLightingBuffer, renderPassEncoder);
            }

            this.renderContext.endRenderPass();

            ProfilerUtil.end("OverlayColorPass Draw Transparent");
        }

        ProfilerUtil.end("overlayColorPass Renderer");
    }
}
