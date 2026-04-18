import { ViewQuad } from '../../../core/ViewQuad';
import { VirtualTexture } from '../../../textures/VirtualTexture';
import { Texture } from '../../graphics/webGpu/core/texture/Texture';
import { UniformNode } from '../../graphics/webGpu/core/uniforms/UniformNode';
import { RTDescriptor } from '../../graphics/webGpu/descriptor/RTDescriptor';
import { RTFrame } from '../frame/RTFrame';
import { RTResourceMap } from '../frame/RTResourceMap';
import { ComputeShader } from '../../../gfx/graphics/webGpu/shader/ComputeShader';
import { RTResourceConfig } from '../config/RTResourceConfig';
import { PostRenderer } from '../passRenderer/post/PostRenderer';
import { View3D } from '../../../core/View3D';
import { Reference } from '../../../util/Reference';
import { CResizeEvent } from '../../../event/CResizeEvent';
import { bindCtx, Context3D } from '../../graphics/webGpu/Context3D';
import { RendererPassState } from '../passRenderer/state/RendererPassState';
/**
 * @internal
 * Base class for post-processing effects
 * @group Post Effects
 */
export class PostBase {
    public enable: boolean = true;
    public postRenderer: PostRenderer;
    public rendererPassState: RendererPassState;
    public _boundCtx: Context3D | null = null;
    private _resourceCreated: boolean = false;
    protected rtViewQuad: Map<string, ViewQuad>;
    protected virtualTexture: Map<string, VirtualTexture>;

    constructor() {
        this.rtViewQuad = new Map<string, ViewQuad>();
        this.virtualTexture = new Map<string, VirtualTexture>();
    }

    protected bindView(view: View3D) {
        let ctx = view.engine3D.context3D;
        bindCtx(this, ctx);
        ctx.addEventListener(CResizeEvent.RESIZE, this.onResize, this);
        if (!this._resourceCreated) {
            this._resourceCreated = true;
            this.createResource(view);
        }
    }

    protected createResource(view: View3D) { }

    protected createRTTexture(name: string, rtWidth: number, rtHeight: number, format: GPUTextureFormat, useMipmap: boolean = false, sampleCount: number = 0) {
        let rt = RTResourceMap.createRTTexture(this._boundCtx!, name, rtWidth, rtHeight, format, useMipmap, sampleCount);
        rt.name = name;
        this.virtualTexture.set(name, rt);
        Reference.getInstance().attached(rt, this);
        return rt;
    }

    protected createViewQuad(name: string, shaderName: string, outRtTexture: VirtualTexture, msaa: number = 0) {
        let rtFrame = new RTFrame([outRtTexture], [new RTDescriptor()]);
        let viewQuad = new ViewQuad(this._boundCtx!, 'Quad_vert_wgsl', shaderName, rtFrame, msaa);
        this.rtViewQuad.set(name, viewQuad);
        return viewQuad;
    }

    protected getLastRenderTexture(): Texture {
        let colorTexture: Texture;
        let renderTargets = this._boundCtx!.gpuContext.lastRenderPassState.renderTargets;
        if (renderTargets.length > 0) {
            colorTexture = renderTargets[0];
        } else {
            colorTexture = RTResourceMap.getTexture(this._boundCtx!, RTResourceConfig.colorBufferTex_NAME);
        }
        return colorTexture;
    }

    public compute(view: View3D) { }

    public onAttach(view: View3D) { }

    public onDetach(view: View3D) { }

    public onResize() {}

    public render(view: View3D, command: GPUCommandEncoder) {}

    public destroy(force?: boolean) {
        this.postRenderer = null;
        for (let i = 0; i < this.rtViewQuad.size; i++) {
            const quad = this.rtViewQuad.values[i] as ViewQuad;
            quad.destroy(force);
        }
        this.rtViewQuad.clear();
        this.rtViewQuad = null;

        for (let i = 0; i < this.virtualTexture.size; i++) {
            const tex = this.virtualTexture.values[i] as VirtualTexture;
            Reference.getInstance().detached(tex, this);
            tex.destroy(force);
        }
    }
}
