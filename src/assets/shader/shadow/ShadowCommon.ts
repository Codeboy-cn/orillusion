import { CSM } from "../../../core/csm/CSM";

/**
 * @internal
 * Shared shadow bindings, private state, and constants.
 * Every other shadow submodule assumes these symbols are in scope, so include
 * this first (the Preprocessor dedups repeat includes).
 */
export let ShadowCommon: string = /*wgsl*/ `
    @group(1) @binding(auto) var shadowMapSampler: sampler_comparison;
    @group(1) @binding(auto) var shadowMap: texture_depth_2d_array;
    @group(1) @binding(auto) var pointShadowMapSampler: sampler_comparison;
    @group(1) @binding(auto) var pointShadowMap: texture_depth_cube_array;

    var<private> directShadowVisibility: array<f32, 8>;
    var<private> pointShadows: array<f32, 8>;
    var<private> shadowWeight: f32 = 1.0 ;

    const dirCount:i32 = 8 ;
    const pointCount:i32 = 8 ;
    const csmCount:i32 = ${CSM.Cascades} ;
    var<private> csmLevel:i32 = -1;

    fn calcBasicBias(shadowWorldSize:f32, shadowDepthTexSize:f32, near:f32, far:f32) -> f32{
      var bias = shadowWorldSize / shadowDepthTexSize;
      bias = bias / (far - near);
      return bias * 2.0;
    }
`
