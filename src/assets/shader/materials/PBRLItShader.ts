/**
 * @internal
 */
export let PBRLItShader: string = /*wgsl*/ `
    #include "Common_vert"
    #include "Common_frag"
    #include "BxDF_frag"

    @group(1) @binding(auto)
    var baseMapSampler: sampler;
    @group(1) @binding(auto)
    var baseMap: texture_2d<f32>;

    @group(1) @binding(auto)
    var normalMapSampler: sampler;
    @group(1) @binding(auto)
    var normalMap: texture_2d<f32>;

    // #if USE_ARMC
        // @group(1) @binding(auto)
        // var maskMapSampler: sampler;
        // @group(1) @binding(auto)
        // var maskMap: texture_2d<f32>;
    // #endif

    // #if USE_MR
        @group(1) @binding(auto)
        var maskMapSampler: sampler;
        @group(1) @binding(auto)
        var maskMap: texture_2d<f32>;
    // #endif

    #if USE_AOTEX
        @group(1) @binding(auto)
        var aoMapSampler: sampler;
        @group(1) @binding(auto)
        var aoMap: texture_2d<f32>;
    #endif

    @group(1) @binding(auto)
    var emissiveMapSampler: sampler;
    @group(1) @binding(auto)
    var emissiveMap: texture_2d<f32>;

    #if USE_TRANSMISSION
        @group(1) @binding(auto)
        var sceneColorPyramidSampler: sampler;
        @group(1) @binding(auto)
        var sceneColorPyramid: texture_2d<f32>;
        #if USE_TRANSMISSIONMAP
            @group(1) @binding(auto)
            var transmissionMapSampler: sampler;
            @group(1) @binding(auto)
            var transmissionMap: texture_2d<f32>;
        #endif
    #endif

    var<private> debugOut : vec4f = vec4f(0.0) ;

    fn vert(inputData:VertexAttributes) -> VertexOutput {
        ORI_Vert(inputData) ;
        return ORI_VertexOut ;
    }

    fn frag(){
   
        let baseMapOffsetSize = materialUniform.baseMapOffsetSize;
        var uv = transformUV(ORI_VertexVarying.fragUV0,baseMapOffsetSize) ; 

        #if USE_SRGB_ALBEDO
            ORI_ShadingInput.BaseColor = textureSample(baseMap, baseMapSampler, uv )  ;
            // ORI_ShadingInput.BaseColor = sRGBToLinear(ORI_ShadingInput.BaseColor.rgb)  ;
            ORI_ShadingInput.BaseColor = vec4<f32>( ORI_ShadingInput.BaseColor * materialUniform.baseColor.rgb, ORI_ShadingInput.BaseColor.w * materialUniform.baseColor.a)  ;
        #else
            ORI_ShadingInput.BaseColor = textureSample(baseMap, baseMapSampler, uv )  ;
            ORI_ShadingInput.BaseColor = vec4f(gammaToLiner(ORI_ShadingInput.BaseColor.rgb),ORI_ShadingInput.BaseColor.a)  ;
            ORI_ShadingInput.BaseColor *= vec4f(materialUniform.baseColor.rgba)  ;
        #endif

        let roughnessMapOffsetSize = materialUniform.roughnessMapOffsetSize;
        var uv4 = transformUV(ORI_VertexVarying.fragUV0,roughnessMapOffsetSize); 
        var maskTex = textureSample(maskMap, maskMapSampler, uv4 );
       
        #if USE_ALPHA_A
            ORI_ShadingInput.BaseColor.a =  ORI_ShadingInput.BaseColor.a * (maskTex.a) ;
        #endif

        #if USE_ALPHACUT
            if( (ORI_ShadingInput.BaseColor.a - materialUniform.alphaCutoff) <= 0.0 ){
                // discard kills the fragment; no need to write @location outputs.
                discard;
            }
        #endif

        useShadow();

        var roughnessChannel:f32 = 1.0 ;
        #if USE_ROUGHNESS_A
            roughnessChannel = maskTex.a ;
        #else if USE_ROUGHNESS_R
            roughnessChannel = maskTex.r ;
        #else if USE_ROUGHNESS_G
            roughnessChannel = maskTex.g ;
        #else if USE_ROUGHNESS_B
            roughnessChannel = maskTex.b ;
        #else if USE_ALBEDO_A
            roughnessChannel = ORI_ShadingInput.BaseColor.a ;
        #endif  

        #if USE_SMOOTH
            var roughness = ( 1.0 - roughnessChannel ) * materialUniform.roughness;
            ORI_ShadingInput.Roughness = clamp(roughness , 0.0001 , 1.0);
        #else
            ORI_ShadingInput.Roughness = clamp(roughnessChannel * materialUniform.roughness ,0.0001,1.0);
        #endif 

        var metallicChannel:f32 = 1.0 ;
        #if USE_METALLIC_A
            metallicChannel = maskTex.a ;
        #else if USE_METALLIC_R
            metallicChannel = maskTex.r ;
        #else if USE_METALLIC_G
            metallicChannel = maskTex.g ;
        #else if USE_METALLIC_B
            metallicChannel = maskTex.b ;
        #endif    

        ORI_ShadingInput.Metallic = metallicChannel * materialUniform.metallic ;
   
        var aoChannel:f32 = 1.0 ;
        #if USE_AOTEX
            let aoMapOffsetSize = materialUniform.aoMapOffsetSize;
            var aoMapOffsetSizeUV = transformUV(ORI_VertexVarying.fragUV0,aoMapOffsetSize); 
            var aoMap = textureSample(aoMap, aoMapSampler, ORI_VertexVarying.fragUV0 );
            aoChannel = aoMap.g ;
        #else
            #if USE_AO_A
                aoChannel = maskTex.a ;
            #else if USE_AO_R
                aoChannel = maskTex.r ;
            #else if USE_AO_G
                aoChannel = maskTex.g ;
            #else if USE_AO_B
                aoChannel = maskTex.b ;
            #endif  
        #endif

        ORI_ShadingInput.AmbientOcclusion = aoChannel ;
        ORI_ShadingInput.Specular = 1.0 ;

        let emissiveMapOffsetSize = materialUniform.emissiveMapOffsetSize;
        var emissiveUV = transformUV(ORI_VertexVarying.fragUV0,emissiveMapOffsetSize) ;
        #if USE_EMISSIVEMAP
            var emissiveMapColor = textureSample(emissiveMap, emissiveMapSampler , emissiveUV ) ;
            let emissiveColor = materialUniform.emissiveColor.rgb * emissiveMapColor.rgb * materialUniform.emissiveIntensity ;
            ORI_ShadingInput.EmissiveColor = vec4<f32>(emissiveColor.rgb,1.0);
        #else
            let emissiveColor = materialUniform.emissiveColor.rgb * materialUniform.emissiveIntensity ;
            ORI_ShadingInput.EmissiveColor = vec4<f32>(emissiveColor,1.0);
        #endif

        let normalMapOffsetSize = materialUniform.normalMapOffsetSize;
        var nomralUV = transformUV(ORI_VertexVarying.fragUV0,normalMapOffsetSize) ;
        var Normal = textureSample(normalMap,normalMapSampler,nomralUV).rgb ;
        let normal = unPackRGNormal(Normal,1.0,1.0) ;  
        ORI_ShadingInput.Normal = normal ;
     
        BxDFShading();

        #if USE_TRANSMISSION
            // KHR_materials_transmission — sample the opaque-world
            // backdrop captured by SceneColorPyramidFeature.
            //
            // Refraction follows Three.js's getVolumeTransmissionRay:
            // build a 3D refracted ray of length thickness starting
            // from the fragment's world position, then project its
            // exit point back to clip space and sample the pyramid at
            // that UV. This gives per-fragment offsets that depend on
            // surface curvature, view angle, and distance to camera —
            // the volumetric refraction look (gradient amber, multiple
            // colour bands across the body) that the previous flat
            // 2D normal.xy * (ior-1) approximation couldn't produce.
            let screenUV = ORI_VertexVarying.fragCoord.xy /
                vec2f(globalUniform.windowWidth, globalUniform.windowHeight);
            let viewDir = normalize(globalUniform.CameraPos.xyz - ORI_VertexVarying.vWorldPos.xyz);
            let normalWS = normalize(ORI_ShadingInput.Normal);
            // -viewDir points from camera into the surface; refract()
            // returns the transmitted direction continuing through the
            // medium. eta = 1/ior because we go from air (n≈1) into
            // glass (n=ior). For ior ≥ 1 the discriminant stays
            // non-negative so refract never returns the zero TIR
            // sentinel here.
            let refractDir = refract(-viewDir, normalWS, 1.0 / max(materialUniform.ior, 1.0));
            // Ray length in world units. modelScale is 1 in this
            // sample (no transform.scale on the dragon); for scaled
            // meshes this should multiply by length(modelMatrix[i].xyz)
            // along each axis — left as a TODO when we expose the
            // per-instance world matrix to the fragment shader.
            let transmissionRay = refractDir * materialUniform.thicknessFactor;
            let exitWorld = ORI_VertexVarying.vWorldPos.xyz + transmissionRay;
            // Project exit point back to NDC, then to UV space. Y is
            // flipped because WGSL's fragCoord origin is top-left
            // (y-down) while the post-projective NDC has y-up.
            let exitClip = globalUniform.projMat * globalUniform.viewMat * vec4f(exitWorld, 1.0);
            let exitNDC = exitClip.xy / max(exitClip.w, 1e-4);
            let refractedUV = vec2f(exitNDC.x * 0.5 + 0.5, exitNDC.y * -0.5 + 0.5);
            // Clamp to texture interior — the exit point can land
            // outside the framebuffer for thick glass + grazing
            // angles, and clamp behaviour beats whatever the sampler's
            // address mode would do (typically smear edge pixels).
            let sampleUV = clamp(refractedUV, vec2f(0.002), vec2f(0.998));
            // Roughness-aware mip selection. Three.js's
            // getTransmissionSample uses applyIorToRoughness +
            // textureBicubic, we approximate with a simple linear
            // mapping into the pyramid's mip chain — mip 0 for
            // polished glass, deepest mip for fully rough.
            let pyramidLodMax = f32(textureNumLevels(sceneColorPyramid)) - 1.0;
            let lod = clamp(ORI_ShadingInput.Roughness, 0.0, 1.0) * pyramidLodMax;
            let transmittedRGBA = textureSampleLevel(sceneColorPyramid, sceneColorPyramidSampler, sampleUV, lod);
            let transmitted = transmittedRGBA.rgb;
            // Volumetric attenuation. Three.js's
            // applyVolumeAttenuation uses log-space:
            //   coeff       = -log(attenuationColor) / attenuationDistance
            //   transmittance = exp(-coeff * thickness)
            //                 = pow(attenuationColor, thickness / distance)
            // which is exactly what KHR_materials_volume specifies and
            // produces a softer falloff than the (1 - color) Beer-
            // Lambert variant we used to ship — the color stays in the
            // expected hue rather than collapsing toward red as soon as
            // the path length grows.
            var transmittance = vec3f(1.0);
            if (materialUniform.attenuationDistance < 1.0e18 && materialUniform.thicknessFactor > 0.0) {
                let safeColor = max(materialUniform.attenuationColor.rgb, vec3f(1e-4));
                let ratio = materialUniform.thicknessFactor / materialUniform.attenuationDistance;
                transmittance = pow(safeColor, vec3f(ratio));
            }
            var tf = clamp(materialUniform.transmissionFactor, 0.0, 1.0);
            #if USE_TRANSMISSIONMAP
                // glTF spec: transmissionTexture R channel scales the
                // factor per-fragment, so a single material can have
                // opaque + glassy regions (e.g. a window frame).
                tf = tf * textureSample(transmissionMap, transmissionMapSampler, uv).r;
            #endif
            let tint = materialUniform.attenuationColor.rgb;
            let transmittedTinted = transmitted * transmittance * tint;
            // Default behavior matches three.js's regular transmission
            // path on an opaque canvas: mix lit color with the
            // attenuated backdrop and keep alpha at 1 so opaque-queue
            // depth and blending semantics hold.
            //
            // When transmissionAlphaMode is non-zero, the fragment also
            // attenuates its output alpha by transmission so an
            // alpha-true swapchain composites whatever lives behind the
            // canvas (HTML page background, video, ...) through the
            // glass — the trick three.js's
            // webgl_materials_physical_transmission_alpha sample relies
            // on. Sampling the pyramid alpha for this would feed back
            // into itself (the pyramid is captured AfterOpaque, after
            // this fragment writes), so we derive alpha from 1 - tf
            // directly. The mode is opt-in to preserve existing
            // demos that share an opaque canvas with other geometry.
            let alphaMode = clamp(materialUniform.transmissionAlphaMode, 0.0, 1.0);
            // RGB: in alpha-cutout mode (Three's transmission_alpha demo)
            // we approximate MeshPhysicalMaterial's specular-preserving
            // behaviour — the diffuse lobe is replaced by the attenuated
            // backdrop sample, but a fixed fraction of the lit signal
            // (specular + env reflection) survives unattenuated. In
            // opaque mode the original full mix stays; existing samples
            // rely on it for clean refraction through colored backdrops.
            let lit = ORI_FragmentOutput.color.rgb;
            // Pull the *real* IBL specular term BxDF_frag exported via
            // fragData.Specular. In cutout mode we use it as the
            // preserved-highlight signal on top of refraction, instead
            // of the previous "50% of lit" approximation. That kept
            // sliding 高光强度 / 高光颜色 from showing up clearly
            // because the slider was modulating a tiny fraction of a
            // lit signal that was already mostly direct-light diffuse.
            // Now the slider directly drives the visible highlight
            // strength / hue.
            let cleanSpec = fragData.Specular;
            let litMinusSpec = max(lit - cleanSpec, vec3f(0.0));
            let diffuseLike = mix(lit, litMinusSpec, alphaMode);
            let preservedSpec = mix(vec3f(0.0), cleanSpec, alphaMode);
            // KHR_materials_transmission spec: "A material with metallic
            // = 1 cannot transmit light." Three.js gets this for free
            // because its PBR multiplies diffuse by kD = (1-F)*(1-
            // metallic), so a pure metal has zero diffuse term and
            // transmission, which only replaces diffuse, has no
            // visible effect — the surface becomes a pure mirror.
            // Our diffuseLike here also includes direct-light spec
            // contribution, so we need to gate transmission explicitly
            // by (1 - metallic) to get the same chrome-at-metallic=1
            // look three.js's reference produces.
            let metalMask = 1.0 - clamp(fragData.Metallic, 0.0, 1.0);
            let effectiveTf = tf * metalMask;
            let dragonOpaqueRGB = mix(diffuseLike, transmittedTinted, effectiveTf) + preservedSpec;
            // Alpha-blend simulation for cutout mode. Three's
            // MeshPhysicalMaterial sets material.transparent=true and
            // the GPU blend state runs the over-operator; we draw with
            // BlendMode.NONE in the opaque queue (depth-tested
            // override), so we emulate the same math in the shader.
            // backdropDirect samples the pyramid at THIS fragment's
            // screen position (no refraction offset) — the pyramid
            // contains the rest of the world (cloth / floor / walls)
            // at this stage of the frame thanks to the
            // TransmissionOpaqueFeature pipeline split.
            //
            //   srcA      = opacity * pyramid.a            // = three.js's diffuseColor.a
            //   resultRGB = srcA * dragon + (1 - srcA) * pyramid.a * pyramid.rgb
            //   resultA   = srcA + pyramid.a * (1 - srcA)
            //
            // Cloth region (pyramid.a=1): result collapses to
            // (opacity*dragon + (1-opacity)*cloth, 1) — alpha-blend with
            // cloth, HTML fully blocked.
            // Cells region (pyramid.a=0): srcA=0, result=(0,0) — dragon
            // contributes nothing and the canvas's premultiplied
            // compositor reveals the HTML cell at full strength.
            let backdropDirect = textureSample(sceneColorPyramid, sceneColorPyramidSampler, screenUV);
            let opacity = ORI_FragmentOutput.color.a;
            // Same metalness gating for the alpha-cutout path: pure
            // metals don't let the iframe HTML show through, they
            // mirror-reflect the IBL. Scale the alpha-blend term by
            // metalMask so srcA collapses to 1 at metallic=1 (no HTML
            // leak even in cutout mode).
            let srcA = opacity * mix(1.0, backdropDirect.a, metalMask);
            let cutoutAlpha = srcA + backdropDirect.a * (1.0 - srcA);
            let cutoutRGB = srcA * dragonOpaqueRGB + (1.0 - srcA) * backdropDirect.a * backdropDirect.rgb;
            let outAlpha = mix(1.0, cutoutAlpha, alphaMode);
            let outRGB = mix(dragonOpaqueRGB, cutoutRGB, alphaMode);
            ORI_FragmentOutput.color = vec4f(outRGB, outAlpha);
        #endif
    }
`

