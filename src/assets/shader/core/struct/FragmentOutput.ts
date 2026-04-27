/**
 * @internal
 */
export let FragmentOutput: string = /*wgsl*/ `
    #if USE_OIT_DEPTH_PEEL_DEPTH
        // Dual depth peeling — depth-extraction sub-pass. Single
        // attachment (RG32F MRT) so the pipeline expects exactly one
        // fragment output. See {@link DDPDepthPass} for blend wiring.
        struct FragmentOutput {
            @location(auto) color: vec4<f32>,
            #if USE_OUTDEPTH
                @builtin(frag_depth) out_depth: f32
            #endif
        };
    #else
        #if USE_OIT_DEPTH_PEEL_FRONT
            // Dual depth peeling — front-color accumulation sub-pass.
            // Single attachment (RGBA16F MRT).
            struct FragmentOutput {
                @location(auto) color: vec4<f32>,
                #if USE_OUTDEPTH
                    @builtin(frag_depth) out_depth: f32
                #endif
            };
        #else
            #if USE_OIT_DEPTH_PEEL_BACK
                // Dual depth peeling — back-color accumulation sub-pass.
                // Single attachment (RGBA16F MRT).
                struct FragmentOutput {
                    @location(auto) color: vec4<f32>,
                    #if USE_OUTDEPTH
                        @builtin(frag_depth) out_depth: f32
                    #endif
                };
            #else
                #if USE_CASTREFLECTION
                    struct FragmentOutput {
                        @location(auto) gBuffer: vec4<f32>,
                        #if USE_OUTDEPTH
                            @builtin(frag_depth) out_depth: f32
                        #endif
                    };
                #else
                    struct FragmentOutput {
                        @location(auto) color: vec4<f32>,
                        @location(auto) gBuffer: vec4<f32>,
                        #if USE_OUTDEPTH
                            @builtin(frag_depth) out_depth: f32
                        #endif
                    };
                #endif
            #endif
        #endif
    #endif
`
