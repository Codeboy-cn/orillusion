/**
 * @internal
 * Directional-light shadow sampling (with optional CSM blending).
 * Depends on ShadowCommon, PCF_frag, CSM_frag plus GlobalUniform / LightData
 * from the host shader.
 */
export let DirectShadow_frag: string = /*wgsl*/ `
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

                      var weight:f32 = calcCSMBlendWeight(csmShadowResult.zw);

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
        // IMPORTANT (cross-platform): normalize() of a zero-length vector is
        // undefined in WGSL. Dawn's Metal backend typically returns (0,0,0)
        // while Dawn's D3D12 backend can return NaN — which propagates through
        // dot(), max() picks the non-NaN 0.1 floor, and effectiveShadowBias =
        // shadowBias / 0.1 = 10× amplification. On receivers close to the
        // shadow camera that makes compareZ = shadowPos.z - 10×bias negative,
        // which a 'less' compare sampler turns into "always lit" → the entire
        // scene renders with no shadows on Windows. Guard against a zero
        // light.direction / fragment normal by falling back to identity
        // vectors before dividing.
        let Nraw = fragData.N;
        let dirRaw = -light.direction;
        let N_len2 = dot(Nraw, Nraw);
        let dir_len2 = dot(dirRaw, dirRaw);
        let N = select(vec3<f32>(0.0, 1.0, 0.0), Nraw * inverseSqrt(max(N_len2, 1e-30)), N_len2 > 1e-8);
        let L = select(vec3<f32>(0.0, 0.0, -1.0), dirRaw * inverseSqrt(max(dir_len2, 1e-30)), dir_len2 > 1e-8);
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
          isOutSideArea = 0.0;
          var uvOnePixel = 1.0 / vec2<f32>(globalUniform.shadowMapSize) ;
          visibility = samplePCF3x3_Direct(varying_shadowUV, depthTexIndex, shadowPos.z - effectiveShadowBias, uvOnePixel);
      }
      #endif
      return vec4<f32>(visibility, isOutSideArea, varying_shadowUV);
    }
`
