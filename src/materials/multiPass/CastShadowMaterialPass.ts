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
        // Include the fragment stage explicitly (both entry points = "main").
        // Previously fsEntryPoint was unset, producing a vertex-only pipeline.
        // On Dawn's D3D12 backend that path appears to silently skip the depth
        // write (no validation error, adapter is fine, features present), so
        // the shadow map stayed at its cleared far value and every receiver
        // tested "fully lit" → no shadows on Windows. Metal handled the same
        // pipeline correctly, which is why Mac worked. An explicit no-output
        // fragment stage works on both backends.
        this.setShaderEntry("main", "main");
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
        // Rasterizer depth-bias disabled intentionally. For depth32float the
        // WebGPU spec says depthBias * r uses an "implementation-defined r"
        // (smallest representable depth delta at 1.0). Metal treats r as
        // ~1.19e-7 (f32 ULP at 1.0), Dawn D3D12 has historically treated
        // integer depthBias values literally for float formats — so a value
        // of 1 saturates the depth to 1.0 on Windows but is harmless on Mac.
        // The sampler side (DirectShadow_frag) already applies a slope-scaled
        // bias of `shadowBias / max(NoL, 0.1)` at sample time, which is
        // backend-portable, so rasterizer bias is redundant anyway.
        this.shaderState.depthBias = 0;
        this.shaderState.depthBiasSlopeScale = 0;
        this.shaderState.depthBiasClamp = 0;

        this.setDefine(`USE_ALPHACUT`, true);
        // this.alphaCutoff = 0.5 ;
    }
}
