/**
 * @internal
 */
export let UnLit_frag: string = /*wgsl*/ `
    #include "Common_frag"
    #include "GlobalUniform"

    fn UnLit(){
        let alpha = ORI_ShadingInput.BaseColor.a ;
        // NOTE: color output is NON-premultiplied to match BlendMode.NORMAL's
        // straight-alpha factors (src-alpha, one-minus-src-alpha). Using the
        // pre-multiplied rgb*alpha here double-darkens (rgb * alpha^2),
        // invisibly collapsing e.g. white at alpha=0.4 on a black ColorPass
        // target to the same 0.16 gray as the canvas background (the
        // Sample_MeshLines plane symptom). The gBuffer packing still uses
        // the pre-multiplied value so deferred-path albedo encoding is
        // unchanged.
        var viewColorPremul = vec4<f32>(ORI_ShadingInput.BaseColor.rgb * alpha , alpha) ;
        var vNormal = ORI_VertexVarying.vWorldNormal.rgb ;
        let gBuffer = packNHMDGBuffer(
            ORI_VertexVarying.fragCoord.z,
            vec3f(0.0),
            viewColorPremul.rgb,
            vec3f(1.0,0.0,0.0),
            vNormal,
            alpha
          ) ;

          #if USE_CASTREFLECTION
            ORI_FragmentOutput.gBuffer = gBuffer ;
          #else
            ORI_FragmentOutput.gBuffer = gBuffer ;
            ORI_FragmentOutput.color = vec4<f32>(ORI_ShadingInput.BaseColor.rgb, alpha) ;
          #endif
    }

    fn debugFragmentOut(){

    }
`