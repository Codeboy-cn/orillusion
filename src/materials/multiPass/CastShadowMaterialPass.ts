import { GPUCullMode } from '../../gfx/graphics/webGpu/WebGPUConst';
import { RenderShaderPass } from '../../gfx/graphics/webGpu/shader/RenderShaderPass';
import { PassType } from '../../gfx/renderJob/passRenderer/state/PassType';
import { Vector3 } from '../../math/Vector3';

/**
 * @internal
 * CastShadowMaterialPass
 * @group Material
 */
export class CastShadowMaterialPass extends RenderShaderPass {
    constructor() {
        super(`shadowCastMap_vert`, `directionShadowCastMap_frag`);
        this.passType = PassType.SHADOW;
        this.setShaderEntry("main");
        this.setUniformFloat("cameraFar", 5000);
        this.setUniformVector3("lightWorldPos", Vector3.ZERO);

        this.shaderState.receiveEnv = false;
        this.shaderState.castShadow = false;
        this.shaderState.acceptShadow = false;

        // Shadow map stores BACK-FACE depth of closed meshes (front-face culled).
        // The mesh's own thickness becomes the gap between occluder and receiver,
        // so receivers on the lit front face pass the shadow test naturally —
        // acne, peter-panning, and corner light leaks are geometrically impossible
        // on watertight geometry. Thin / single-sided meshes lose their shadow
        // under this setup; they'd need a two-sided opt-out (not yet implemented).
        this.shaderState.cullMode = GPUCullMode.front;
        // Rasterizer slope bias: kept as a minor safety against extreme grazing,
        // but scaled way down — the mesh thickness is the primary bias now.
        this.shaderState.depthBias = 0;
        this.shaderState.depthBiasSlopeScale = 0.5;
        this.shaderState.depthBiasClamp = 0;

        this.setDefine(`USE_ALPHACUT`, true);
        // this.alphaCutoff = 0.5 ;
    }
}
