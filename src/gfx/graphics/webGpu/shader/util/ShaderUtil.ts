import { perContextResource, webGPUContext, Context3D } from "../../Context3D";
import { RenderShaderPass } from "../RenderShaderPass";

export type VertexPart = {
    name: string;
    vertex_in_struct: string;
    vertex_out_struct: string;
    vertex_buffer: string;
    vertex_fun: string;
    vertex_out: string;
}

export type FragmentPart = {
    name: string;
    fs_textures: string;
    fs_frament: string;
    fs_normal: string;
    fs_shadow: string;
    fs_buffer: string;
    fs_frameBuffers: string;
}

type ShaderUtilState = {
    renderShaderModulePool: Map<string, GPUShaderModule>;
    renderShader: Map<string, RenderShaderPass>;
};

export class ShaderUtil {
    private static _cache = perContextResource<ShaderUtilState>();

    /**
     * Legacy static accessors proxy to the active Context3D's state.
     * Device-bound GPU shader modules are keyed per-device; the RenderShaderPass
     * cache is also per-device (since the passes internally hold device-bound
     * pipelines).
     */
    public static get renderShaderModulePool(): Map<string, GPUShaderModule> {
        return this._state().renderShaderModulePool;
    }
    public static get renderShader(): Map<string, RenderShaderPass> {
        return this._state().renderShader;
    }

    private static _state(ctx: Context3D = webGPUContext): ShaderUtilState {
        return this._cache(() => ({
            renderShaderModulePool: new Map<string, GPUShaderModule>(),
            renderShader: new Map<string, RenderShaderPass>(),
        }), ctx);
    }

    public static init() {
        this._state();
    }
}
