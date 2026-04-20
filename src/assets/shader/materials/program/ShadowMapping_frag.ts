import { CSM } from "../../../../core/csm/CSM";

/**
 * @internal
 */
export let ShadowMapping_frag: string = /*wgsl*/ `
    @group(1) @binding(auto) var shadowMapSampler: sampler_comparison;
    @group(1) @binding(auto) var shadowMap: texture_depth_2d_array;
    @group(1) @binding(auto) var pointShadowMapSampler: sampler_comparison;
    @group(1) @binding(auto) var pointShadowMap: texture_depth_cube_array;

    var<private> directShadowVisibility: array<f32, 8>;
    var<private> pointShadows: array<f32, 8>;
    var<private> shadowWeight: f32 = 1.0 ;

    fn useShadow(){
        directShadowVisibility = array<f32, 8>( 1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0) ;
        pointShadows = array<f32, 8>(1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0) ;
        directShadowMaping();
        pointShadowMapCompare();
    }

    fn calcBasicBias(shadowWorldSize:f32, shadowDepthTexSize:f32, near:f32, far:f32) -> f32{
      var bias = shadowWorldSize / shadowDepthTexSize;
      bias = bias / (far - near);
      return bias * 2.0;
    }

    const dirCount:i32 = 8 ;
    const pointCount:i32 = 8 ;
    const csmCount:i32 = ${CSM.Cascades} ;
    var<private> csmLevel:i32 = -1;
    fn directShadowMaping()  {
        for (var i: i32 = 0; i < dirCount; i = i + 1) {
          if( i >= globalUniform.nDirShadowStart && i < globalUniform.nDirShadowEnd ) {
            var visibility = 1.0;
            let ldx = globalUniform.shadowLights[u32(i) / 4u][u32(i) % 4u];
            let light = lightBuffer[u32(ldx)];
            var shadowIndex = i32(light.castShadow);
            var shadowMatrix:mat4x4<f32>;

            #if USE_CSM
              if (light.csmShadowMapIndex >= 0){
                  visibility = 0.0;
                  var validCount = 0;
                  var totalWeight = 0.0;
                  for(var csm: i32 = 0; csm < csmCount; csm++) {
                    shadowMatrix = globalUniform.shadowMatrix[shadowIndex + csm];
                    let csmShadowResult = directShadowMapingIndex(light, shadowMatrix, shadowIndex + csm, light.shadowBias[csm], light.normalBias[csm]);
                    if(csmShadowResult.y < 0.5) {
                      validCount++;

                      var uv = 2.0 * csmShadowResult.zw - vec2<f32>(1.0);
                      uv = saturate(vec2<f32>(1.0) - abs(uv));
                      uv /= clamp(globalUniform.csmMargin, 0.01, 0.5);
                      var weight:f32 = min(uv.x, 1.0);
                      weight = min(weight, uv.y);

                      if(validCount == 1 && csm == csmCount - 1){
                        visibility = 1.0 - weight + csmShadowResult.x * weight;
                        totalWeight = 1.0;
                      } else {
                        weight *= 1.0 - totalWeight;
                        visibility += csmShadowResult.x * weight;
                        totalWeight += weight;
                      }
                      if(validCount >= 2 || totalWeight >= 0.99) {
                        csmLevel = csm;
                        break;
                      }
                    }
                  }
                  totalWeight += 0.0001;
                  if(validCount == 0) {
                    visibility = 1.0;
                  } else {
                    visibility = visibility / totalWeight;
                  }
              } else {
                shadowMatrix = globalUniform.shadowMatrix[shadowIndex];
                visibility = directShadowMapingIndex(light, shadowMatrix, shadowIndex, light.shadowBias[0], light.normalBias[0]).x;
              }
            #else
              shadowMatrix = globalUniform.shadowMatrix[shadowIndex];
              visibility = directShadowMapingIndex(light, shadowMatrix, shadowIndex, light.shadowBias[0], light.normalBias[0]).x;
            #endif
            directShadowVisibility[shadowIndex] = visibility;
          }
        }

    }

    fn directShadowMapingIndex(light: LightData, shadowMatrix: mat4x4<f32>, depthTexIndex: i32, shadowBias: f32, normalBias: f32) -> vec4<f32>
    {
      var visibility = 1.0;
      var isOutSideArea:f32 = 1.0;
      var varying_shadowUV:vec2<f32> = vec2<f32>(0.0);
      #if USE_SHADOWMAPING
        // RFC-003 Layer B (normalBias): push receiver along surface normal in
        // world space before the shadow-space transform.
        // RFC-003 Layer C (shadowBias): slope-scaled per-fragment. The incoming
        // shadowBias is the quantization baseline; the per-fragment amplifier
        // 1/max(NoL, 0.1) covers grazing-angle acne (one-texel depth variation
        // grows like tan(grazing)). Floor 0.1 caps the multiplier at 10x so
        // peter-panning stays bounded.
        let N = normalize(fragData.N);
        let L = normalize(-light.direction);
        let NoL = max(dot(N, L), 0.1);
        let effectiveShadowBias = shadowBias / NoL;
        let receiverPos = ORI_VertexVarying.vWorldPos.xyz + N * normalBias;
        var shadowPosTmp = shadowMatrix * vec4<f32>(receiverPos, 1.0);
        var shadowPos = shadowPosTmp.xyz / shadowPosTmp.w;
        varying_shadowUV = shadowPos.xy * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5, 0.5);
        if (varying_shadowUV.x <= 1.0
          && varying_shadowUV.x >= 0.0
          && varying_shadowUV.y <= 1.0
          && varying_shadowUV.y >= 0.0
          && shadowPosTmp.z <= 1.0
          && shadowPosTmp.z >= 0.0)
        {
          visibility = 0.0;
          isOutSideArea = 0.0;
          var uvOnePixel = 1.0 / vec2<f32>(globalUniform.shadowMapSize) ;
          var totalWeight = 0.0;
          let bound = 1 ;
          for (var y = -bound; y <= bound; y++) {
            for (var x = -bound; x <= bound; x++) {
                var offset = vec2<f32>(f32(x), f32(y)) ;
                var offsetUV = offset * uvOnePixel ;
                var weight = min(length(offset),1.0) ;
                var depth = textureSampleCompareLevel(shadowMap, shadowMapSampler, varying_shadowUV + offsetUV , depthTexIndex, shadowPos.z - effectiveShadowBias);
                if (depth < 0.5) {
                  totalWeight += 1.0;
                }else{
                  visibility += weight ;
                  totalWeight += weight;
                }
            }
          }
          visibility /= totalWeight;
      }
      #endif
      return vec4<f32>(visibility, isOutSideArea, varying_shadowUV);
    }

    fn pointShadowMapCompare(){
      let worldPos = ORI_VertexVarying.vWorldPos.xyz;
      let offset = 0.1;

      for (var i: i32 = 0; i < pointCount ; i = i + 1) {
        if( i >= globalUniform.nPointShadowStart && i < globalUniform.nPointShadowEnd ){
          let ldx = globalUniform.shadowLights[u32(i) / 4u][u32(i) % 4u];
          let light = lightBuffer[u32(ldx)] ;

          #if USE_SHADOWMAPING
              let lightPos = light.position.xyz;
              var shadow = 0.0;
              // RFC-003: shadowBias is a world-space distance subtracted from the
              // measured fragment-to-light distance; normalBias offsets the receiver
              // along its normal first to mitigate acne on grazing surfaces.
              let N = normalize(ORI_ShadingInput.Normal);
              // Cube-face texelSize grows linearly with fragment-to-light distance:
              // texelSize(len) = (2 × len) / pointShadowMapSize. Host writes the
              // worst-case value (at len=range); scale down by len/range per fragment
              // so close receivers get proportionally less bias. Without this, close
              // receivers near a wall base get peter-panning (the wall interior is
              // grazed by the light ray, producing a tiny depth gap that the full
              // worst-case bias overshoots). Uses unshifted worldPos so normalBias
              // doesn't feed back into the scale.
              let unshiftedLen = length(worldPos - lightPos.xyz);
              let lengthScale = min(unshiftedLen / max(light.range, 1.0), 1.0);
              let receiverPos = worldPos + N * (light.normalBias[0] * lengthScale);
              let frgToLight = receiverPos - lightPos.xyz;
              var dir: vec3<f32> = normalize(frgToLight);
              var len = length(frgToLight);
              // Slope-scaled bias: dir points fragment→away from light, so the
              // direction toward the light is -dir. Floor NoL at 0.1 to cap the
              // 1/NoL multiplier at 10x (matches the directional path).
              let NoL = max(dot(N, -dir), 0.1);
              let bias = (light.shadowBias[0] * lengthScale) / NoL;

          #if USE_PCF_SHADOW
              let samples = 4.0;
              let sampleOffset = offset / (samples * 0.5);
              for (var x: f32 = -offset; x < offset; x += sampleOffset) {
                for (var y: f32 = -offset; y < offset; y += sampleOffset) {
                  for (var z: f32 = -offset; z < offset; z += sampleOffset) {
                    let offsetDir = normalize(dir.xyz + vec3<f32>(x, y, z));
                    let compareZ = (len - bias) / globalUniform.far;
                    var depth = textureSampleCompareLevel(pointShadowMap, pointShadowMapSampler, offsetDir, light.castShadow, compareZ);
                    if (depth < 0.5) {
                      shadow += 1.0 * dot(offsetDir, dir.xyz);
                    }
                  }
                }
              }
              shadow = min(max(shadow / (samples * samples * samples), 0.0), 1.0);
            #endif

          #if USE_SOFT_SHADOW
              let vDis = length(globalUniform.CameraPos.xyz - worldPos.xyz);
              let sampleRadies = globalUniform.shadowSoft;
              let samples = 20;
              for (var j: i32 = 0; j < samples; j += 1) {
                let offsetDir = normalize(dir.xyz + sampleOffsetDir[j] * sampleRadies);
                let compareZ = (len - bias) / globalUniform.far;
                var depth = textureSampleCompareLevel(pointShadowMap, pointShadowMapSampler, offsetDir, light.castShadow, compareZ);
                if (depth < 0.5) {
                  shadow += 1.0 * dot(offsetDir, dir.xyz);
                }
              }
              shadow = min(max(shadow / f32(samples), 0.0), 1.0);
          #endif

          #if USE_HARD_SHADOW
                let compareZ = (len - bias) / globalUniform.far;
                var depth = textureSampleCompareLevel(pointShadowMap, pointShadowMapSampler, dir.xyz, light.castShadow, compareZ);
                if (depth < 0.5) {
                  shadow = 1.0;
                }
          #endif
              for (var j = 0; j < pointCount ; j+=1 ) {
                  if(i32(light.castShadow) == j){
                    pointShadows[j] = 1.0 - shadow ;
                  }
              }
          #endif
        }
        }
    }

    #if USE_SOFT_SHADOW
      var<private>sampleOffsetDir : array<vec3<f32>, 20> = array<vec3<f32>, 20>(
        vec3<f32>(1.0, 1.0, 1.0), vec3<f32>(1.0, -1.0, 1.0), vec3<f32>(-1.0, -1.0, 1.0), vec3<f32>(-1.0, 1.0, 1.0),
        vec3<f32>(1.0, 1.0, -1.0), vec3<f32>(1.0, -1.0, -1.0), vec3<f32>(-1.0, -1.0, -1.0), vec3<f32>(-1.0, 1.0, -1.0),
        vec3<f32>(1.0, 1.0, 0.0), vec3<f32>(1.0, -1.0, 0.0), vec3<f32>(-1.0, -1.0, 0.0), vec3<f32>(-1.0, 1.0, 0.0),
        vec3<f32>(1.0, 0.0, 1.0), vec3<f32>(-1.0, 0.0, 1.0), vec3<f32>(1.0, 0.0, -1.0), vec3<f32>(-1.0, 0.0, -1.0),
        vec3<f32>(0.0, 1.0, 1.0), vec3<f32>(0.0, -1.0, 1.0), vec3<f32>(0.0, -1.0, -1.0), vec3<f32>(0.0, 1.0, -1.0),
      );
    #endif
`


