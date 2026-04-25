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
            // backdrop captured by SceneColorPyramidFeature. UV is
            // derived from the fragment's screen position via the
            // per-instance window size uniform; refraction distortion
            // is approximated by offsetting the UV along the view-
            // space normal's xy, scaled by (ior - 1) * thickness.
            let screenUV = ORI_VertexVarying.fragCoord.xy /
                vec2f(globalUniform.windowWidth, globalUniform.windowHeight);
            // Approximate refraction: view-space normal tells us how
            // the ray bends sideways. Keep this cheap; the P3 roadmap
            // has a proper refract() + pyramid mip lookup.
            let refractStrength = max(materialUniform.ior - 1.0, 0.0) * 0.20;
            let refractOffset = ORI_ShadingInput.Normal.xy * refractStrength;
            let sampleUV = clamp(screenUV + refractOffset, vec2f(0.002), vec2f(0.998));
            let transmittedRGBA = textureSample(sceneColorPyramid, sceneColorPyramidSampler, sampleUV);
            let transmitted = transmittedRGBA.rgb;
            // Beer-Lambert attenuation through thickness.
            var transmittance = vec3f(1.0);
            if (materialUniform.attenuationDistance < 1.0e18 && materialUniform.thicknessFactor > 0.0) {
                let attn = exp(-(vec3f(1.0) - materialUniform.attenuationColor.rgb) * materialUniform.thicknessFactor / materialUniform.attenuationDistance);
                transmittance = attn;
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
            let diffuseFraction = mix(1.0, 0.75, alphaMode);
            let diffuseLike = lit * diffuseFraction;
            // specularColor.a is repurposed as a specularIntensity
            // scalar (Three's KHR_materials_specular). Default 1.0
            // leaves the preserved specular-like term at full strength.
            let specularBoost = clamp(materialUniform.specularColor.a, 0.0, 1.0);
            let specularLike = (lit - diffuseLike) * specularBoost;
            let dragonOpaqueRGB = mix(diffuseLike, transmittedTinted, tf) + specularLike;
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
            let srcA = opacity * backdropDirect.a;
            let cutoutAlpha = srcA + backdropDirect.a * (1.0 - srcA);
            let cutoutRGB = srcA * dragonOpaqueRGB + (1.0 - srcA) * backdropDirect.a * backdropDirect.rgb;
            let outAlpha = mix(1.0, cutoutAlpha, alphaMode);
            let outRGB = mix(dragonOpaqueRGB, cutoutRGB, alphaMode);
            ORI_FragmentOutput.color = vec4f(outRGB, outAlpha);
        #endif
    }
`

