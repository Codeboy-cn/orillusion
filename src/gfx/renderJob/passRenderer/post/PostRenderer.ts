import { ShaderLib } from "../../../../assets/shader/ShaderLib";
import { FullQuad_vert_wgsl } from "../../../../assets/shader/quad/Quad_shader";
import { View3D } from "../../../../core/View3D";
import { ViewQuad } from "../../../../core/ViewQuad";
import { Context3D } from "../../../graphics/webGpu/Context3D";
import { Texture } from "../../../graphics/webGpu/core/texture/Texture";
import { RTFrame } from "../../frame/RTFrame";
import { PostBase } from "../../post/PostBase";
import { RendererBase } from "../RendererBase";
import { PassType } from "../state/PassType";


/**
 * @internal
 * @group Post
 */
export class PostRenderer extends RendererBase {
    public finalQuadView: ViewQuad;
    public postList: Map<string, PostBase>;
    constructor() {
        super();

        this._rendererType = PassType.POST;

        this.postList = new Map<string, PostBase>();
    }

    public initRenderer(ctx: Context3D) {
        ShaderLib.register("FullQuad_vert_wgsl", FullQuad_vert_wgsl);
        this.finalQuadView = new ViewQuad(ctx, `Quad_vert_wgsl`, `Quad_frag_wgsl`, new RTFrame([], []), 0, false);
    }

    public attachPost(view: View3D, post: PostBase) {
        post.postRenderer = this;
        let clsName = post.constructor.name;
        let has = this.postList.get(clsName);
        if (!has) {
            this.postList.set(clsName, post);
            post['bindView'](view);
            post.onAttach(view);
        }
    }

    public detachPost(view: View3D, post: PostBase): boolean {
        let clsName = post.constructor.name;
        let has = this.postList.get(clsName);
        if (has) {
            this.postList.delete(clsName);
            post.onDetach(view);
            post.postRenderer = null;
        }
        return has != null;
    }

    public render(view: View3D) {
        const gpu = view.engine3D.context3D.gpuContext;

        this.postList.forEach((v) => {
            if (v.enable) {
                v.compute(view);
            }
        });

        let command = gpu.beginCommandEncoder();
        // Non-final posts (Bloom, FXAA, GodRay, ...) drain in
        // attach order — each samples the previous pass via
        // `lastRenderPassState` so order matters.
        this.postList.forEach((v) => {
            if (v.enable && !v.isFinalPass) {
                v.render(view, command);
                if (v.rendererPassState) {
                    gpu.lastRenderPassState = v.rendererPassState;
                }
            }
        });
        // Final passes (TonemapPost) always run last regardless of
        // attach order, so the curve lands on the fully-composited
        // HDR signal.
        this.postList.forEach((v) => {
            if (v.enable && v.isFinalPass) {
                v.render(view, command);
                if (v.rendererPassState) {
                    gpu.lastRenderPassState = v.rendererPassState;
                }
            }
        });
        gpu.endCommandEncoder(command);
    }

    public presentContent(view: View3D, texture: Texture) {
        const gpu = view.engine3D.context3D.gpuContext;
        let command = gpu.beginCommandEncoder();
        this.finalQuadView.renderToViewQuad(view, this.finalQuadView, command, texture);
        gpu.endCommandEncoder(command);
    }

    // Called via RendererJob.destroy() on engine dispose. finalQuadView is
    // an orphan Object3D (never added to a scene), and each attached post
    // owns extra ViewQuads — scene.destroy() never reaches any of them.
    public destroy(force?: boolean) {
        this.finalQuadView?.destroy(force);
        this.finalQuadView = null;
        if (this.postList) {
            for (const post of this.postList.values()) {
                post.destroy?.(force);
            }
            this.postList.clear();
        }
    }

}
