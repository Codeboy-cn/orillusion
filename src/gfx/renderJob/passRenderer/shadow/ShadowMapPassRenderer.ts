import { DirectLight } from "../../../../components/lights/DirectLight";
import { RenderNode } from "../../../../components/renderer/RenderNode";
import { Camera3D } from "../../../../core/Camera3D";
import { View3D } from "../../../../core/View3D";
import { Vector3 } from "../../../../math/Vector3";
import { Depth2DTextureArray } from "../../../../textures/Depth2DTextureArray";
import { Time } from "../../../../util/Time";
import { Context3D } from "../../../graphics/webGpu/Context3D";
import { GPUTextureFormat } from "../../../graphics/webGpu/WebGPUConst";
import { WebGPUDescriptorCreator } from "../../../graphics/webGpu/descriptor/WebGPUDescriptorCreator";
import { EntityCollect } from "../../collect/EntityCollect";
import { renderGroupBundleKey } from "../../collect/RenderGroup";
import { ShadowLightsCollect } from "../../collect/ShadowLightsCollect";
import { RTFrame } from "../../frame/RTFrame";
import { OcclusionSystem } from "../../occlusion/OcclusionSystem";
import { RendererPassState } from "../state/RendererPassState";
import { PassType } from "../state/PassType";
import { RendererBase } from "../RendererBase";
import { ClusterLightingBuffer } from "../cluster/ClusterLightingBuffer";
import { Reference } from "../../../../util/Reference";
import { Texture } from "../../../graphics/webGpu/core/texture/Texture";
import { VirtualTexture } from "../../../../textures/VirtualTexture";
import { GlobalBindGroup } from "../../../graphics/webGpu/core/bindGroups/GlobalBindGroup";

/**
 * @internal
 * @group Post
 */
export class ShadowMapPassRenderer extends RendererBase {
    public shadowPassCount: number;
    public depth2DArrayTexture: Depth2DTextureArray;
    public rendererPassStates: RendererPassState[];
    // Static-cache infrastructure — allocated lazily when
    // setting.shadow.enableStaticCache is true and first frame hits the
    // static-cache code path. Each layer has a cached static depth texture
    // plus two extra pass states (clear into static cache, and load-into-
    // live for dynamic append).
    private _staticCacheReady = false;
    private staticDepthTextures: VirtualTexture[] = [];
    private rendererPassStatesStatic: RendererPassState[] = [];
    private rendererPassStatesDynamic: RendererPassState[] = [];
    private staticDirtyLayers: boolean[] = [];
    private _forceUpdate = false;

    constructor(ctx: Context3D) {
        super();
        const shadow = ctx.engine!.setting.shadow;
        this.setShadowMap(
            ctx,
            shadow.maxShadowMapWidth,
            shadow.maxShadowMapHeight
        );
        this.passType = PassType.SHADOW;
    }

    setShadowMap(ctx: Context3D, sizeWidth: number, sizeHeight: number) {
        const maxShadowMapNum = ctx.engine!.setting.shadow.maxShadowMapNum;
        this.rendererPassStates = [];
        this.depth2DArrayTexture = new Depth2DTextureArray(sizeWidth, sizeHeight, GPUTextureFormat.depth32float, maxShadowMapNum, ctx);
        Reference.getInstance().attached(this.depth2DArrayTexture, this);

        for (let i = 0; i < maxShadowMapNum; i++) {
            let rtFrame = new RTFrame([], []);
            const tex = new VirtualTexture(sizeWidth, sizeHeight, GPUTextureFormat.depth32float, false, undefined, 1, 0, 1, ctx);
            tex.name = `shadowDepthTexture_${i}`;
            rtFrame.depthTexture = tex;
            rtFrame.label = "shadowRender";
            rtFrame.customSize = true;
            rtFrame.depthCleanValue = 1;
            let rendererPassState = WebGPUDescriptorCreator.createRendererPassState(ctx, rtFrame);
            this.rendererPassStates[i] = rendererPassState;
        }
    }

    /**
     * Build the companion static-cache depth textures + two parallel
     * RendererPassStates per layer on first demand. One pass clears and
     * fills the static cache; the other loads the live depth (pre-filled
     * via texture-to-texture copy from the cache) and appends dynamic
     * geometry on top.
     */
    private _ensureStaticCache(ctx: Context3D, sizeWidth: number, sizeHeight: number): void {
        if (this._staticCacheReady) return;
        const maxShadowMapNum = ctx.engine!.setting.shadow.maxShadowMapNum;
        this.staticDirtyLayers = new Array(maxShadowMapNum).fill(true);
        for (let i = 0; i < maxShadowMapNum; i++) {
            const staticTex = new VirtualTexture(sizeWidth, sizeHeight, GPUTextureFormat.depth32float, false, undefined, 1, 0, 1, ctx);
            staticTex.name = `shadowStaticCache_${i}`;
            this.staticDepthTextures[i] = staticTex;

            // Pass state that writes into the static cache (depth cleared).
            const rtStatic = new RTFrame([], []);
            rtStatic.depthTexture = staticTex;
            rtStatic.label = "shadowStaticRebuild";
            rtStatic.customSize = true;
            rtStatic.depthCleanValue = 1;
            rtStatic.depthLoadOp = 'clear';
            this.rendererPassStatesStatic[i] = WebGPUDescriptorCreator.createRendererPassState(ctx, rtStatic);

            // Pass state that loads the live depth (pre-filled from static
            // cache) and writes dynamic casters on top. load=load preserves
            // the copied depth so occlusion between static and dynamic is
            // resolved by z-test.
            const rtDynamic = new RTFrame([], []);
            rtDynamic.depthTexture = this.rendererPassStates[i].depthTexture;
            rtDynamic.label = "shadowDynamicAppend";
            rtDynamic.customSize = true;
            rtDynamic.depthCleanValue = 1;
            rtDynamic.depthLoadOp = 'load';
            this.rendererPassStatesDynamic[i] = WebGPUDescriptorCreator.createRendererPassState(ctx, rtDynamic);
        }
        this._staticCacheReady = true;
    }

    /**
     * External API: mark the cached static depth dirty. Called by the
     * engine / user when static-tagged renderers are added, removed, or
     * move. The shadow renderer will rebuild the cache on its next run.
     */
    public markStaticShadowDirty(shadowIndex: number = -1): void {
        if (!this._staticCacheReady) { return; }
        if (shadowIndex < 0) {
            for (let i = 0; i < this.staticDirtyLayers.length; i++) this.staticDirtyLayers[i] = true;
        } else if (shadowIndex < this.staticDirtyLayers.length) {
            this.staticDirtyLayers[shadowIndex] = true;
        }
    }

    // Diagnostic: one-shot readback of the first shadow VirtualTexture
    // after frame 60 to confirm whether the shadow depth pass actually writes
    // anything, or whether the depth attachment stays at its clear value. Only
    // runs once per session; remove once the Mac/Windows gap is understood.
    private _debugProbeDone = false;
    private async _debugProbeShadowMap(view: View3D) {
        if (this._debugProbeDone || Time.frame < 60) return;
        const ps = this.rendererPassStates?.[0];
        const tex: any = ps?.depthTexture;
        if (!tex) return;
        this._debugProbeDone = true;
        try {
            const ctx = view.engine3D.context3D;
            const device: GPUDevice = ctx.device;
            const gpu = ctx.gpuContext;
            const w = tex.width, h = tex.height;
            const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
            const buf = device.createBuffer({
                size: bytesPerRow * h,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
            const cmd = gpu.beginCommandEncoder();
            cmd.copyTextureToBuffer(
                { texture: tex.getGPUTexture(), aspect: 'depth-only' },
                { buffer: buf, bytesPerRow, rowsPerImage: h },
                { width: w, height: h, depthOrArrayLayers: 1 },
            );
            gpu.endCommandEncoder(cmd);
            await buf.mapAsync(GPUMapMode.READ);
            const copy = new Float32Array(buf.getMappedRange().slice(0));
            buf.unmap();
            buf.destroy();
            let mn = Infinity, mx = -Infinity, sum = 0, nonOneCount = 0;
            const stride = bytesPerRow / 4;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const d = copy[y * stride + x];
                    if (d < mn) mn = d;
                    if (d > mx) mx = d;
                    sum += d;
                    if (d < 0.9999) nonOneCount++;
                }
            }
            const total = w * h;
            const mean = sum / total;
            console.log(
                `[ShadowMapDebug] directional shadow VirtualTexture readback: ` +
                `size=${w}x${h}  min=${mn.toFixed(5)}  max=${mx.toFixed(5)}  ` +
                `mean=${mean.toFixed(5)}  non-1.0-texels=${nonOneCount}/${total} (${(100 * nonOneCount / total).toFixed(2)}%)`
            );
        } catch (e: any) {
            console.log('[ShadowMapDebug] readback failed:', e?.message ?? e);
            this._debugProbeDone = false;
        }
    }

    render(view: View3D, occlusionSystem: OcclusionSystem) {
        let shadowSetting = view.engine3D.setting.shadow;
        if (!shadowSetting.enable)
            return;
        // fire-and-forget diagnostic probe
        void this._debugProbeShadowMap(view);
        let camera = view.camera;
        let scene = view.scene;
        this.shadowPassCount = 0;
        if (!shadowSetting.needUpdate)
            return;
        if (!(Time.frame % shadowSetting.updateFrameRate == 0))
            return;

        //*********************/
        //***shadow light******/
        //*********************/

        let shadowLightList = ShadowLightsCollect.getDirectShadowLightWhichScene(scene);
        let shadowSizeWidth = shadowSetting.shadowSize;
        let shadowSizeHeight = shadowSetting.shadowSize;
        for (let light of shadowLightList) {
            const dirLight = light as DirectLight;
            let shadowIndex = dirLight.shadowIndex;
            this.rendererPassState = this.rendererPassStates[shadowIndex];
            shadowSizeWidth = this.rendererPassState.depthTexture.width;
            shadowSizeHeight = this.rendererPassState.depthTexture.height;

            let viewRenderList = EntityCollect.instance.getRenderShaderCollect(view);
            if (viewRenderList) {
                for (const renderList of viewRenderList) {
                    let nodeMap = renderList[1];
                    for (const iterator of nodeMap) {
                        let node = iterator[1];
                        if (!node.isDestroyed && node.preInit(this._rendererType)) {
                            node.nodeUpdate(view, this._rendererType, this.rendererPassState, null);
                            break;
                        }
                    }
                }
            }

            const useStaticCache = shadowSetting.enableStaticCache === true;
            const autoOrDirty = (dirLight.castShadow && dirLight.needUpdateShadow || this._forceUpdate) || (dirLight.castShadow && shadowSetting.autoUpdate);

            if (useStaticCache && dirLight.castShadow) {
                // Static-cache path: runs every frame (for the dynamic
                // layer) even when autoUpdate is off. Light / _forceUpdate
                // events invalidate the static cache for a single rebuild.
                this._ensureStaticCache(view.engine3D.context3D, shadowSizeWidth, shadowSizeHeight);
                if (dirLight.needUpdateShadow || this._forceUpdate) {
                    if (dirLight.enableCSM) {
                        for (let csmIndex = 0; csmIndex < dirLight.cascadeNum; csmIndex++) {
                            this.staticDirtyLayers[shadowIndex + csmIndex] = true;
                        }
                    } else {
                        this.staticDirtyLayers[shadowIndex] = true;
                    }
                    dirLight.needUpdateShadow = false;
                }

                if (dirLight.enableCSM) {
                    dirLight.updateShadowCameraCSM(view.camera);
                    dirLight.lightData.csmShadowMapIndex = shadowIndex;
                    for (let csmIndex = 0; csmIndex < dirLight.cascadeNum; csmIndex++) {
                        const layer = shadowIndex + csmIndex;
                        let shadowCamera: Camera3D = dirLight.csmShadowCamera[csmIndex];
                        (shadowCamera as any)._boundCtx ||= view.engine3D.context3D;
                        this._renderLayerSplit(view, shadowCamera, occlusionSystem, layer, shadowSizeWidth, shadowSizeHeight);
                    }
                } else {
                    let extents = camera.getShadowWorldExtents();
                    this.poseShadowCamera(dirLight, camera, dirLight.direction, dirLight.shadowCamera, extents, camera.lookTarget);
                    this._renderLayerSplit(view, dirLight.shadowCamera, occlusionSystem, shadowIndex, shadowSizeWidth, shadowSizeHeight);
                }
            } else if (autoOrDirty) {
                // Original single-pass path — behaviour unchanged.
                dirLight.needUpdateShadow = false;
                if (dirLight.enableCSM) {
                    dirLight.updateShadowCameraCSM(view.camera);
                    dirLight.lightData.csmShadowMapIndex = shadowIndex;
                    for (let csmIndex = 0; csmIndex < dirLight.cascadeNum; csmIndex++) {
                        this.rendererPassState = this.rendererPassStates[shadowIndex + csmIndex];
                        let shadowCamera: Camera3D = dirLight.csmShadowCamera[csmIndex];
                        (shadowCamera as any)._boundCtx ||= view.engine3D.context3D;
                        this.renderShadow(view, shadowCamera, occlusionSystem, this.rendererPassState);
                        this.copyDepthTexture(view, this.rendererPassState.depthTexture, this.depth2DArrayTexture, shadowIndex + csmIndex, shadowSizeWidth, shadowSizeHeight);
                    }
                } else {
                    let extents = camera.getShadowWorldExtents();
                    this.rendererPassState = this.rendererPassStates[shadowIndex];
                    this.poseShadowCamera(dirLight, camera, dirLight.direction, dirLight.shadowCamera, extents, camera.lookTarget);
                    this.renderShadow(view, dirLight.shadowCamera, occlusionSystem, this.rendererPassState);
                    this.copyDepthTexture(view, this.rendererPassState.depthTexture, this.depth2DArrayTexture, shadowIndex, shadowSizeWidth, shadowSizeHeight);
                }
            }
        }

        this._forceUpdate = false;
    }

    /**
     * Static-cache render flow for a single shadow-map layer.
     *   1. Rebuild the static layer if dirty (clear + draw static casters).
     *   2. Copy static cache into the live layer.
     *   3. Append dynamic casters on top of the live layer (load-op load).
     *   4. Copy live layer into the receiver-facing 2D array texture.
     */
    private _renderLayerSplit(view: View3D, shadowCamera: Camera3D, occlusionSystem: OcclusionSystem, layer: number, sizeWidth: number, sizeHeight: number) {
        // 1. Rebuild static cache if needed.
        if (this.staticDirtyLayers[layer]) {
            this.rendererPassState = this.rendererPassStatesStatic[layer];
            this.renderShadow(view, shadowCamera, occlusionSystem, this.rendererPassState, 'static');
            this.staticDirtyLayers[layer] = false;
        }

        // 2. Copy static cache -> live depth.
        this.copyDepthTexture(view, this.staticDepthTextures[layer], (this.rendererPassStates[layer] as any).depthTexture, 0, sizeWidth, sizeHeight);

        // 3. Append dynamic casters.
        this.rendererPassState = this.rendererPassStatesDynamic[layer];
        this.renderShadow(view, shadowCamera, occlusionSystem, this.rendererPassState, 'dynamic');

        // 4. Publish to receiver-facing array.
        this.copyDepthTexture(view, (this.rendererPassStates[layer] as any).depthTexture, this.depth2DArrayTexture, layer, sizeWidth, sizeHeight);
    }

    private copyDepthTexture(view: View3D, src: Texture, dst: Texture, dstIndex: number, shadowSizeWidth: number, shadowSizeHeight: number) {
        const gpu = view.engine3D.context3D.gpuContext;
        let qCommand = gpu.beginCommandEncoder();
        qCommand.copyTextureToTexture(
            {
                texture: src.getGPUTexture(),
                mipLevel: 0,
                origin: { x: 0, y: 0, z: 0 },
            },
            {
                texture: dst.getGPUTexture(),
                mipLevel: 0,
                origin: { x: 0, y: 0, z: dstIndex },
            },
            {
                width: shadowSizeWidth,
                height: shadowSizeHeight,
                depthOrArrayLayers: 1,
            },
        );
        gpu.endCommandEncoder(qCommand);
    }

    private _shadowPos: Vector3 = new Vector3();
    private _shadowCameraTarget: Vector3 = new Vector3();

    private poseShadowCamera(dirLight: DirectLight, viewCamera: Camera3D, direction: Vector3, shadowCamera: Camera3D, extents: number, lookAt: Vector3) {
        this._shadowPos.copyFrom(dirLight.transform.worldPosition);
        this._shadowCameraTarget.copy(direction).normalize(viewCamera.far);
        Vector3.add(this._shadowCameraTarget, this._shadowPos, this._shadowCameraTarget);
        shadowCamera.transform.lookAt(this._shadowPos, this._shadowCameraTarget);
        shadowCamera.orthoOffCenter(shadowCamera.left, shadowCamera.right, shadowCamera.bottom, shadowCamera.top, shadowCamera.near, shadowCamera.far);
    }

    public compute() {

    }

    private renderShadow(view: View3D, shadowCamera: Camera3D, occlusionSystem: OcclusionSystem, state: RendererPassState, kind: 'all' | 'static' | 'dynamic' = 'all') {
        // Shadow cameras aren't in the scene graph, so transform.view3D is null.
        // Adopt the rendering view's ctx on first use so GlobalBindGroup.updateCameraGroup
        // can find the device.
        (shadowCamera as any)._boundCtx ||= view.engine3D.context3D;
        const gpu = view.engine3D.context3D.gpuContext;
        let collectInfo = EntityCollect.instance.getRenderNodes(view.scene, shadowCamera);
        let command = gpu.beginCommandEncoder();
        let encoder = gpu.beginRenderPass(command, state);

        shadowCamera.transform.updateWorldMatrix();
        // shadowCamera.transform.updateWorldMatrix();
        if (OcclusionSystem.enable) {
            occlusionSystem.update(shadowCamera, view.scene);
            occlusionSystem.collect(collectInfo, shadowCamera);
        }
        GlobalBindGroup.updateCameraGroup(shadowCamera);
        gpu.bindCamera(encoder, shadowCamera);
        // Bundles bake in the renderer list at build time; they're only
        // valid when the filter is 'all'. In static/dynamic split mode we
        // draw each node individually via drawShadowRenderNodes so the
        // per-node filter takes effect.
        if (kind === 'all') {
            let op_bundleList = this.renderShadowBundleOp(view, shadowCamera, state);
            let tr_bundleList = this.renderShadowBundleTr(view, shadowCamera, state);

            if (op_bundleList.length > 0) {
                encoder.executeBundles(op_bundleList);
            }
            this.drawShadowRenderNodes(view, shadowCamera, encoder, collectInfo.opaqueList);
            if (tr_bundleList.length > 0) {
                encoder.executeBundles(tr_bundleList);
            }
            this.drawShadowRenderNodes(view, shadowCamera, encoder, collectInfo.transparentList);
        } else {
            // PointLightShadowRenderer hides drawShadowRenderNodes with an
            // incompatible signature, so the direct call here trips the TS
            // override check. Calls at runtime stay on this class.
            (this as any).drawShadowRenderNodes(view, shadowCamera, encoder, collectInfo.opaqueList, null, kind);
            (this as any).drawShadowRenderNodes(view, shadowCamera, encoder, collectInfo.transparentList, null, kind);
        }

        gpu.endPass(encoder);
        gpu.endCommandEncoder(command);
    }

    protected renderShadowBundleOp(view: View3D, shadowCamera: Camera3D, state: RendererPassState) {
        const gpu = view.engine3D.context3D.gpuContext;
        let entityBatchCollect = EntityCollect.instance.getOpRenderGroup(view.scene);
        if (entityBatchCollect) {
            const stateVersion = state.stateVersion;
            let bundlerList = [];
            entityBatchCollect.renderGroup.forEach((v) => {
                const cacheKey = renderGroupBundleKey(v, this._rendererType, stateVersion);
                if (v.bundleMap.has(cacheKey)) {
                    bundlerList.push(v.bundleMap.get(cacheKey));
                } else {
                    let renderBundleEncoder = gpu.recordBundleEncoder(state.renderBundleEncoderDescriptor);
                    this.recordShadowRenderBundleNode(view, shadowCamera, renderBundleEncoder, v.renderNodes);
                    let newBundle = renderBundleEncoder.finish();
                    v.bundleMap.set(cacheKey, newBundle);
                    bundlerList.push(newBundle);
                }
            });
            return bundlerList;
        }
        return [];
    }

    protected renderShadowBundleTr(view: View3D, shadowCamera: Camera3D, state: RendererPassState) {
        const gpu = view.engine3D.context3D.gpuContext;
        let entityBatchCollect = EntityCollect.instance.getTrRenderGroup(view.scene);
        if (entityBatchCollect) {
            const stateVersion = state.stateVersion;
            let bundlerList = [];
            entityBatchCollect.renderGroup.forEach((v) => {
                const cacheKey = renderGroupBundleKey(v, this._rendererType, stateVersion);
                if (v.bundleMap.has(cacheKey)) {
                    bundlerList.push(v.bundleMap.get(cacheKey));
                } else {
                    let renderBundleEncoder = gpu.recordBundleEncoder(state.renderBundleEncoderDescriptor);
                    this.recordShadowRenderBundleNode(view, shadowCamera, renderBundleEncoder, v.renderNodes);
                    let newBundle = renderBundleEncoder.finish();
                    v.bundleMap.set(cacheKey, newBundle);
                    bundlerList.push(newBundle);
                }
            });
            return bundlerList;
        }
        return [];
    }


    protected recordShadowRenderBundleNode(view: View3D, shadowCamera: Camera3D, encoder: GPURenderBundleEncoder, nodes: RenderNode[], clusterLightingBuffer?: ClusterLightingBuffer) {
        const gpu = view.engine3D.context3D.gpuContext;
        GlobalBindGroup.updateCameraGroup(shadowCamera);
        gpu.bindCamera(encoder, shadowCamera);
        if (nodes) {
            gpu.bindGeometryBuffer(encoder, nodes[0].geometry);
            for (let i = 0; i < nodes.length; ++i) {
                let renderNode = nodes[i];
                if (!renderNode.transform.enable)
                    continue;
                renderNode.recordRenderPass2(view, this._rendererType, this.rendererPassState, clusterLightingBuffer, encoder as unknown as GPURenderPassEncoder);
            }
        }
    }

    protected drawShadowRenderNodes(view: View3D, shadowCamera: Camera3D, encoder: GPURenderPassEncoder, nodes: RenderNode[], clusterLightingBuffer?: ClusterLightingBuffer, kind: 'all' | 'static' | 'dynamic' = 'all') {
        GlobalBindGroup.updateCameraGroup(shadowCamera);
        view.engine3D.context3D.gpuContext.bindCamera(encoder, shadowCamera);
        if (nodes) {
            const render = view.engine3D.setting.render;
            for (let i = render.drawOpMin; i < Math.min(nodes.length, render.drawOpMax); ++i) {
                let renderNode = nodes[i];
                // let matrixIndex = renderNode.transform.worldMatrix.index;
                // if (!occlusionSystem.renderCommitTesting(camera,renderNode) ) continue;
                if (!renderNode.transform.enable)
                    continue;
                if (!renderNode.enable)
                    continue;
                if (!renderNode.castShadow)
                    continue;
                if (renderNode.isDestroyed)
                    continue;
                // Per-node static/dynamic filter for the static-cache pipeline.
                // 'auto' defaults to dynamic (preserves "render every frame"
                // behaviour for renderers the user hasn't tagged).
                if (kind === 'static') {
                    if (renderNode.shadowCacheMode !== 'static') continue;
                } else if (kind === 'dynamic') {
                    if (renderNode.shadowCacheMode === 'static') continue;
                }
                if (!renderNode.preInit(this._rendererType)) {
                    renderNode.nodeUpdate(view, this._rendererType, this.rendererPassState, clusterLightingBuffer);
                }
                renderNode.renderPass2(view, this._rendererType, this.rendererPassState, clusterLightingBuffer, encoder);
            }
        }
    }
}
