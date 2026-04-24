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

        // Back-face shadow rendering (matches Babylon / UE / Unity HDRP
        // defaults). Culling FRONT faces means the shadow map stores depth
        // of the back-face of each caster. When a receiver samples, its
        // actual depth is strictly closer than any stored depth unless a
        // different caster sits between → no self-shadowing, no texel
        // quantization moire on caster-lit surfaces. Mesh thickness itself
        // becomes the effective bias, so we can keep the shader-side bias
        // small and still be acne-free. Point/Spot already did this in
        // CastPointShadowMaterialPass; directional was the outlier.
        //
        // Caveat: single-sided geometry (grass billboards, cloth planes,
        // terrain patches with only one face) casts NO shadow under this
        // mode. The per-material escape is to author those as double-sided
        // so back faces exist to rasterize here. Follow-up: add a
        // `doubleSidedShadow` toggle that flips this cullMode per-caster.
        this.shaderState.cullMode = GPUCullMode.front;

        // Rasterizer depth-bias stays disabled. For depth32float the
        // WebGPU spec says depthBias * r uses an implementation-defined r
        // (smallest representable depth delta at 1.0). Metal treats r as
        // ~1.19e-7 (f32 ULP at 1.0), Dawn D3D12 historically used integer
        // depthBias literally for float formats — the same value saturates
        // depth to 1.0 on Windows but is harmless on Mac. Shader-side
        // `shadowBias / NoL` is backend-portable, so rasterizer bias is
        // redundant.
        this.shaderState.depthBias = 0;
        this.shaderState.depthBiasSlopeScale = 0;
        this.shaderState.depthBiasClamp = 0;

        this.setDefine(`USE_ALPHACUT`, true);
        // this.alphaCutoff = 0.5 ;
    }
}
