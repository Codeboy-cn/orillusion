/**
 * @internal
 * 3x3 PCF sampling for directional (2D array) shadow maps.
 * Returns visibility in [0, 1]. Reads shadowMap / shadowMapSampler from
 * ShadowCommon — include ShadowCommon first.
 */
export let PCF_frag: string = /*wgsl*/ `
    fn samplePCF3x3_Direct(uv: vec2<f32>, depthTexIndex: i32, refDepth: f32, uvOnePixel: vec2<f32>) -> f32 {
        var visibility = 0.0;
        var totalWeight = 0.0;
        let bound = 1 ;
        for (var y = -bound; y <= bound; y++) {
          for (var x = -bound; x <= bound; x++) {
              var offset = vec2<f32>(f32(x), f32(y)) ;
              var offsetUV = offset * uvOnePixel ;
              var weight = min(length(offset),1.0) ;
              var depth = textureSampleCompareLevel(shadowMap, shadowMapSampler, uv + offsetUV, depthTexIndex, refDepth);
              if (depth < 0.5) {
                totalWeight += 1.0;
              }else{
                visibility += weight ;
                totalWeight += weight;
              }
          }
        }
        return visibility / totalWeight;
    }
`
