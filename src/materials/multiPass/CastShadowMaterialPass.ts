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

        // Directional shadows stay on the traditional front-face path (cullMode
        // inherited from ShaderState default = back, i.e. renders front faces).
        // Switching to back-face / front-cull would break single-sided geometry
        // like terrains, planes, and grass blades — they have no back faces to
        // rasterize, so they'd cast no shadow at all. Instead, bias is tuned to
        // cover slope acne directly (shader applies 1/max(NoL, 0.1) too).
        this.shaderState.depthBias = 1;
        this.shaderState.depthBiasSlopeScale = 1.75;
        this.shaderState.depthBiasClamp = 0.001;

        this.setDefine(`USE_ALPHACUT`, true);
        // this.alphaCutoff = 0.5 ;
    }
}
