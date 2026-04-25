import { RenderNode } from "../../../../components/renderer/RenderNode";
import { View3D } from "../../../../core/View3D";
import { ProfilerUtil } from "../../../../util/ProfilerUtil";
import { GlobalBindGroup } from "../../../graphics/webGpu/core/bindGroups/GlobalBindGroup";
import { EntityCollect } from "../../collect/EntityCollect";
import { OcclusionSystem } from "../../occlusion/OcclusionSystem";
import { RenderContext } from "../RenderContext";
import { RendererBase } from "../RendererBase";
import { ClusterLightingBuffer } from "../cluster/ClusterLightingBuffer";
import { PassType } from "../state/PassType";

/**
 *  @internal
 * Base Color Renderer
 * @author sirxu
 * @group Post
 */
export class ColorPassRenderer extends RendererBase {
    constructor() {
        super();
        this.passType = PassType.COLOR;
    }

    /** When set, the transparent half of this pass filters draw nodes
     *  by their material's `oitMode`. `'sorted'` skips materials marked
     *  for WBOIT (TransparentOITFeature renders those instead);
     *  `'weighted'` would do the inverse but isn't currently used —
     *  OIT has its own renderer with a different RTFrame. */
    public oitFilter: 'sorted' | 'weighted' | null = null;

    public render(view: View3D, occlusionSystem: OcclusionSystem, clusterLightingBuffer?: ClusterLightingBuffer, maskTr: boolean = false, maskOp: boolean = false) {
        const gpu = view.engine3D.context3D.gpuContext;
        this.renderContext.gpu = gpu;
        if (!maskOp) {
            // When this call owns the "opaque half" of the pass (the
            // normal case and the maskTr path) the render-context must
            // start fresh; the transparent-only call, by contrast, is
            // always invoked after the opaque feature already finished
            // a pass so the cached list is still relevant.
            this.renderContext.clean();
        }


        let scene = view.scene;
        let camera = view.camera;

        GlobalBindGroup.updateCameraGroup(camera);

        this.rendererPassState.camera3D = camera;

        let collectInfo = EntityCollect.instance.getRenderNodes(scene, camera);

        let op_bundleList = maskOp ? [] : this.renderBundleOp(view, collectInfo, occlusionSystem, clusterLightingBuffer);
        // When the transparent half is partitioned by oitMode, skip the
        // cached bundles (they bake the full transparent set) and let
        // drawNodes do the per-node filter inline. Bundle re-keying for
        // OIT/sorted partitions is a future optimization.
        let tr_bundleList = (maskTr || this.oitFilter !== null) ? [] : this.renderBundleTr(view, collectInfo, occlusionSystem, clusterLightingBuffer);

        if (!maskOp) {
            this.renderContext.beginOpaqueRenderPass();
            let renderPassEncoder = this.renderContext.encoder;

            //     // renderPassEncoder.setViewport(camera.viewPort.x, camera.viewPort.y, camera.viewPort.width, camera.viewPort.height, 0.0, 1.0);
            //     // renderPassEncoder.setScissorRect(camera.viewPort.x, camera.viewPort.y, camera.viewPort.width, camera.viewPort.height);

            //     // renderPassEncoder.setViewport(view.viewPort.x, view.viewPort.y, view.viewPort.width, view.viewPort.height, 0.0, 1.0);
            //     // renderPassEncoder.setScissorRect(view.viewPort.x, view.viewPort.y, view.viewPort.width, view.viewPort.height);

            if (op_bundleList.length > 0) {
                //  GPUContext.bindCamera(renderPassEncoder,camera);
                let entityBatchCollect = EntityCollect.instance.getOpRenderGroup(scene);
                // entityBatchCollect.renderGroup.forEach((group) => {
                //     for (let i = 0; i < group.renderNodes.length; i++) {
                //         const node = group.renderNodes[i];
                //         node.transform.updateWorldMatrix();
                //     }
                // });

                renderPassEncoder.executeBundles(op_bundleList);
            }

            const sky = EntityCollect.instance.getSky(view.scene);
            if (!maskTr && sky) {
                gpu.bindCamera(renderPassEncoder, camera);
                if (!sky.preInit(this._rendererType)) {
                    sky.nodeUpdate(view, this._rendererType, this.rendererPassState, clusterLightingBuffer);
                }
                sky.renderPass2(view, this._rendererType, this.rendererPassState, clusterLightingBuffer, renderPassEncoder);
            }

            if (collectInfo.opaqueList) {
                gpu.bindCamera(renderPassEncoder, camera);
                this.drawNodes(view, this.renderContext, collectInfo.opaqueList, occlusionSystem, clusterLightingBuffer);
            }

            // Split mode: this call is owned by ColorFeature (opaque
            // half). End the pass so the resource between opaque and
            // transparent — i.e. SceneColorPyramid copy — can happen
            // outside any render-pass encoder. The matching TransparentFeature
            // call (maskOp=true) will open a continue-pass with loadOp='load'.
            if (maskTr) {
                this.renderContext.endRenderPass();
                return;
            }
        }

        {
            // Transparent-only entrypoint: reopen the pass with loadOp='load'
            // so opaque content (and any intermediate work — pyramid copy,
            // OIT accum resolve) survives.
            if (maskOp) {
                this.renderContext.beginTransparentRenderPass();
            }

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
                graphic3DRenderNode.nodeUpdate(view, this._rendererType, this.splitRendererPassState, clusterLightingBuffer);
                graphic3DRenderNode.renderPass2(view, this._rendererType, this.splitRendererPassState, clusterLightingBuffer, renderPassEncoder);
            }


            this.renderContext.endRenderPass();


            ProfilerUtil.end("ColorPass Draw Transparent");
        }

        // ProfilerUtil.end("colorPass Renderer");
    }

    public drawNodes(view: View3D, renderContext: RenderContext, nodes: RenderNode[], occlusionSystem: OcclusionSystem, clusterLightingBuffer: ClusterLightingBuffer) {
        let viewRenderList = EntityCollect.instance.getRenderShaderCollect(view);
        if (viewRenderList) {
            for (const renderList of viewRenderList) {
                let nodeMap = renderList[1];
                for (const iterator of nodeMap) {
                    let node = iterator[1];
                    if (!node.isDestroyed && node.preInit(this._rendererType)) {
                        node.nodeUpdate(view, this._rendererType, this.rendererPassState, clusterLightingBuffer);
                        break;
                    }
                }
            }

            const render = view.engine3D.setting.render;
            const filter = this.oitFilter;
            for (let i = render.drawOpMin; i < Math.min(nodes.length, render.drawOpMax); ++i) {
                let renderNode = nodes[i];
                // if (!occlusionSystem.renderCommitTesting(view.camera, renderNode))
                //     continue;
                if (!renderNode.transform.enable)
                    continue;
                if (!renderNode.enable)
                    continue;
                if (renderNode.isDestroyed)
                    continue;
                // OIT/sorted partition. When TransparentOITFeature is in
                // the graph, the SortedTransparentFeature sets
                // `oitFilter = 'sorted'` and we must skip materials that
                // opted into WBOIT — they will be rendered by the OIT
                // pass instead. Without this gate they would be drawn
                // twice (once sorted, once OIT) and double-blended.
                if (filter !== null) {
                    const mat = renderNode.materials?.[0];
                    if (filter === 'sorted' && mat?.oitMode === 'weighted') continue;
                    if (filter === 'weighted' && mat?.oitMode !== 'weighted') continue;
                }
                if (!renderNode.preInit(this._rendererType)) {
                    renderNode.nodeUpdate(view, this._rendererType, this.rendererPassState, clusterLightingBuffer);
                }
                renderNode.renderPass(view, this.passType, this.renderContext);
            }
        }
    }


    protected occlusionRenderNodeTest(i: number, id: number, occlusionSystem: OcclusionSystem): boolean {
        return occlusionSystem.zDepthRenderNodeTest(id) > 0;
    }
}
