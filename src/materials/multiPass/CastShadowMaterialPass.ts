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

        // GPU slope-scaled depth bias on the shadow rasterizer (RFC-003 Layer A).
        // Handles slope-induced acne for free at rasterization time so the shader
        // sampling path only needs a small constant offset.
        this.shaderState.depthBias = 1;
        this.shaderState.depthBiasSlopeScale = 1.75;
        this.shaderState.depthBiasClamp = 0.001;

        this.setDefine(`USE_ALPHACUT`, true);
        // this.alphaCutoff = 0.5 ;
    }
}
