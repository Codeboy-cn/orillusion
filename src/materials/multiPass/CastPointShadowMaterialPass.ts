import { RenderShaderPass } from "../../gfx/graphics/webGpu/shader/RenderShaderPass";
import { PassType } from "../../gfx/renderJob/passRenderer/state/PassType";
import { Vector3 } from "../../math/Vector3";

/**
 * @internal
 * CastPointShadowMaterialPass
 * @group Material
 */
export class CastPointShadowMaterialPass extends RenderShaderPass {
    constructor() {
        super(`castPointShadowMap_vert`, `shadowCastMap_frag`);
        this.passType = PassType.POINT_SHADOW;
        this.setShaderEntry("main", "main");
        this.setUniformFloat("cameraFar", 5000);
        this.setUniformVector3("lightWorldPos", Vector3.ZERO);
        this.shaderState.receiveEnv = false;
        this.shaderState.castShadow = false;
        this.shaderState.acceptShadow = false;

        // GPU slope-scaled depth bias on the shadow rasterizer (RFC-003 Layer A).
        this.shaderState.depthBias = 1;
        this.shaderState.depthBiasSlopeScale = 1.75;
        this.shaderState.depthBiasClamp = 0.001;

        this.setDefine(`USE_ALPHACUT`, true);
    }
}
