/**
 * @internal
 */
export let VertexOutput: string = /*wgsl*/ `
    struct VertexOutput {
    @location(auto) @interpolate(flat) index: f32,
    @location(auto) varying_UV0: vec2<f32>,
    @location(auto) varying_UV1: vec2<f32>,
    @location(auto) varying_ViewPos: vec4<f32>,
    @location(auto) varying_Clip: vec4<f32>,
    @location(auto) varying_WPos: vec4<f32>,
    @location(auto) varying_WNormal: vec3<f32>,
    @location(auto) varying_Color: vec4<f32>,

    #if USE_SHADOWMAPING
        @location(auto) varying_ShadowPos: vec4<f32>,
    #endif

    #if USE_TANGENT
        @location(auto) varying_Tangent: vec4<f32>,
    #endif


    @builtin(position) member: vec4<f32>
    };
`
