/**
 * @internal
 * Point-light cube-map shadow sampling.
 * Three compile branches: USE_PCF_SHADOW / USE_SOFT_SHADOW / USE_HARD_SHADOW.
 * Depends on ShadowCommon, GlobalUniform, LightData, ORI_ShadingInput.
 */
export let PointShadow_frag: string = /*wgsl*/ `
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
              //
              // IMPORTANT (cross-platform): normalize() of a zero-length vector is
              // undefined in WGSL. Metal returns (0,0,0), Dawn D3D12 returns NaN,
              // and once NaN is in NoL the whole compareZ goes NaN and the
              // depth-compare sampler treats NaN ref as "pass" on Windows →
              // no shadows. Use select + manual inverseSqrt to stay data-defined
              // even for degenerate normals or unset light.position.
              let Nraw = ORI_ShadingInput.Normal;
              let N_len2 = dot(Nraw, Nraw);
              let N = select(vec3<f32>(0.0, 1.0, 0.0), Nraw * inverseSqrt(max(N_len2, 1e-30)), N_len2 > 1e-8);
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
              let frg_len2 = dot(frgToLight, frgToLight);
              var dir: vec3<f32> = select(vec3<f32>(1.0, 0.0, 0.0), frgToLight * inverseSqrt(max(frg_len2, 1e-30)), frg_len2 > 1e-8);
              var len = sqrt(max(frg_len2, 0.0));
              // Slope-scaled bias: dir points fragment→away from light, so the
              // direction toward the light is -dir. Floor NoL at 0.1 to cap the
              // 1/NoL multiplier at 10x (matches the directional path).
              let NoL = max(dot(N, -dir), 0.1);
              let bias = (light.shadowBias[0] * lengthScale) / NoL;
              // Per-light shadowFar normalizer — matches what the shadow-cast
              // shader used when writing depth (cube camera's far). Falls back
              // to main camera far when shadowFar is 0 (legacy / unpopulated).
              let shadowFarDecode = select(globalUniform.far, light.shadowFar, light.shadowFar > 0.0);
              let compareZ = (len - bias) / shadowFarDecode;

          #if USE_PCF_SHADOW
              let samples = 4.0;
              let sampleOffset = offset / (samples * 0.5);
              for (var x: f32 = -offset; x < offset; x += sampleOffset) {
                for (var y: f32 = -offset; y < offset; y += sampleOffset) {
                  for (var z: f32 = -offset; z < offset; z += sampleOffset) {
                    let offsetDir = normalize(dir.xyz + vec3<f32>(x, y, z));
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
                var depth = textureSampleCompareLevel(pointShadowMap, pointShadowMapSampler, offsetDir, light.castShadow, compareZ);
                if (depth < 0.5) {
                  shadow += 1.0 * dot(offsetDir, dir.xyz);
                }
              }
              shadow = min(max(shadow / f32(samples), 0.0), 1.0);
          #endif

          #if USE_HARD_SHADOW
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
