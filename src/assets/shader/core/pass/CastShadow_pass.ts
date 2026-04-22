import { SkeletonAnimation_shader } from "../../anim/SkeletonAnimation_shader";
import { MorphTarget_shader } from "../../../../components/anim/morphAnim/MorphTarget_shader";

/**
 * @internal
 */
export let shadowCastMap_vert: string = /*wgsl*/ `
#include "WorldMatrixUniform"
#include "GlobalUniform"

struct VertexOutput {
    @location(auto) fragUV: vec2<f32>,
    @builtin(position) member: vec4<f32>
};

#if USE_MORPHTARGETS
    ${MorphTarget_shader.getMorphTargetShaderBinding(2, 1)}
#endif

#if USE_SKELETON
    ${SkeletonAnimation_shader.groupBindingAndFunctions(2, 1)} 
#endif

var<private> worldMatrix: mat4x4<f32>;

struct VertexAttributes{
    @builtin(instance_index) index : u32,
    @location(auto) position: vec3<f32>,
    @location(auto) normal: vec3<f32>,
    @location(auto) uv: vec2<f32>,
    @location(auto) TEXCOORD_1: vec2<f32>,

    #if USE_METAHUMAN
        #if USE_TANGENT
            @location(auto) TANGENT: vec4<f32>,
            @location(auto) joints0: vec4<f32>,
            @location(auto) weights0: vec4<f32>,
            #if USE_JOINT_VEC8
                @location(auto) joints1: vec4<f32>,
                @location(auto) weights1: vec4<f32>,
                @location(auto) vIndex: f32,
            #else
                @location(auto) vIndex: f32,
            #endif
        #else
            @location(auto) joints0: vec4<f32>,
            @location(auto) weights0: vec4<f32>,
            #if USE_JOINT_VEC8
                @location(auto) joints1: vec4<f32>,
                @location(auto) weights1: vec4<f32>,
                @location(auto) vIndex: f32,
            #else
                @location(auto) vIndex: f32,
            #endif
        #endif
    #else
        #if USE_TANGENT
            @location(auto) TANGENT: vec4<f32>,
        #endif

        #if USE_SKELETON
            #if USE_TANGENT
                @location(auto) joints0: vec4<f32>,
                @location(auto) weights0: vec4<f32>,
                #if USE_JOINT_VEC8
                    @location(auto) joints1: vec4<f32>,
                    @location(auto) weights1: vec4<f32>,
                #endif
            #else
                @location(auto) joints0: vec4<f32>,
                @location(auto) weights0: vec4<f32>,
                #if USE_JOINT_VEC8
                    @location(auto) joints1: vec4<f32>,
                    @location(auto) weights1: vec4<f32>,
                #endif
            #endif
        #endif

        #if USE_MORPHTARGETS
            #if USE_TANGENT
                @location(auto) vIndex: f32,
            #else
                @location(auto) vIndex: f32,
            #endif
        #endif

    #endif
}

@vertex
fn main(vertex:VertexAttributes) -> VertexOutput {
    worldMatrix = models.matrix[vertex.index];
    let shadowMatrix: mat4x4<f32> = globalUniform.projMat * globalUniform.viewMat;
    var vertexPosition = vertex.position.xyz;
    var vertexNormal = vertex.normal.xyz;

    if (globalUniform.useRTE != 0) {
        UpdateWorldMatrixToRTE_PrivatePtr(u32(vertex.index), &worldMatrix);
    }

    #if USE_MORPHTARGETS
     ${MorphTarget_shader.getMorphTargetCalcVertex()}    
    #endif

    #if USE_SKELETON
        #if USE_JOINT_VEC8
          worldMatrix *= getSkeletonWorldMatrix_8(vertex.joints0, vertex.weights0, vertex.joints1, vertex.weights1);
        #else
          worldMatrix *= getSkeletonWorldMatrix_4(vertex.joints0, vertex.weights0);
        #endif
    #endif

    var worldPos = worldMatrix * vec4<f32>(vertexPosition, 1.0) ;
    var vPos = shadowMatrix * worldPos;

    return VertexOutput(vertex.uv, vPos );  
}
`

/**
 * @internal
 */
export let castPointShadowMap_vert: string = /*wgsl*/ `
#include "WorldMatrixUniform"
#include "GlobalUniform"

struct VertexOutput {
    @location(auto) fragUV: vec2<f32>,
    @location(auto) worldPos: vec3<f32>,
    @builtin(position) member: vec4<f32>
};

#if USE_MORPHTARGETS
    ${MorphTarget_shader.getMorphTargetShaderBinding(2, 1)}
##endif
 
#if USE_SKELETON
    ${SkeletonAnimation_shader.groupBindingAndFunctions(2, 1)} 
#endif

var<private> worldMatrix: mat4x4<f32>;

struct VertexAttributes{
  @builtin(instance_index) index : u32,
  @location(auto) position: vec3<f32>,
  @location(auto) normal: vec3<f32>,
  @location(auto) uv: vec2<f32>,
  @location(auto) TEXCOORD_1: vec2<f32>,

  
  #if USE_METAHUMAN
    #if USE_TANGENT
        @location(auto) TANGENT: vec4<f32>,
        @location(auto) joints0: vec4<f32>,
        @location(auto) weights0: vec4<f32>,
        @location(auto) joints1: vec4<f32>,
        @location(auto) weights1: vec4<f32>,
        @location(auto) vIndex: f32,
    #else
        @location(auto) joints0: vec4<f32>,
        @location(auto) weights0: vec4<f32>,
        @location(auto) joints1: vec4<f32>,
        @location(auto) weights1: vec4<f32>,
        @location(auto) vIndex: f32,
    #endif
    #else
    #if USE_TANGENT
        @location(auto) TANGENT: vec4<f32>,
    #endif

    #if USE_SKELETON
        #if USE_TANGENT
            @location(auto) joints0: vec4<f32>,
            @location(auto) weights0: vec4<f32>,
            #if USE_JOINT_VEC8
                @location(auto) joints1: vec4<f32>,
                @location(auto) weights1: vec4<f32>,
            #endif
        #else
            @location(auto) joints0: vec4<f32>,
            @location(auto) weights0: vec4<f32>,
            #if USE_JOINT_VEC8
                @location(auto) joints1: vec4<f32>,
                @location(auto) weights1: vec4<f32>,
            #endif
        #endif
    #endif

    #if USE_MORPHTARGETS
        #if USE_TANGENT
            @location(auto) vIndex: f32,
        #else
            @location(auto) vIndex: f32,
        #endif
    #endif

    #endif
}

@vertex
fn main(vertex:VertexAttributes) -> VertexOutput {
    worldMatrix = models.matrix[vertex.index];
    let shadowMatrix: mat4x4<f32> = globalUniform.projMat * globalUniform.viewMat;
    var vertexPosition = vertex.position.xyz;

    if (globalUniform.useRTE != 0) {
        UpdateWorldMatrixToRTE_PrivatePtr(u32(vertex.index), &worldMatrix);
    }

    #if USE_METAHUMAN
        ${MorphTarget_shader.getMorphTargetCalcVertex()}
        #if USE_JOINT_VEC8
            worldMatrix *= getSkeletonWorldMatrix_8(vertex.joints0, vertex.weights0, vertex.joints1, vertex.weights1);
        #else
            worldMatrix *= getSkeletonWorldMatrix_4(vertex.joints0, vertex.weights0);
        #endif
    #endif

    #if USE_MORPHTARGETS
        ${MorphTarget_shader.getMorphTargetCalcVertex()}
    #endif

    #if USE_SKELETON
        #if USE_JOINT_VEC8
          worldMatrix *= getSkeletonWorldMatrix_8(vertex.joints0, vertex.weights0, vertex.joints1, vertex.weights1);
        #else
          worldMatrix *= getSkeletonWorldMatrix_4(vertex.joints0, vertex.weights0);
        #endif
    #endif

    var worldPos = worldMatrix * vec4<f32>(vertexPosition, 1.0) ;
    var vPos = shadowMatrix * worldPos;
    return VertexOutput(vertex.uv, worldPos.xyz , vPos ); 
}
`

/**
 * @internal
 */
export let shadowCastMap_frag: string = /*wgsl*/ `
    #include "GlobalUniform"

    #if USE_ALPHACUT
      @group(1) @binding(0)
      var baseMapSampler: sampler;
      @group(1) @binding(1)
      var baseMap: texture_2d<f32>;
    #endif

    struct FragmentOutput {
      @location(auto) o_Target: vec4<f32>,
      @builtin(frag_depth) out_depth: f32
    };

    @fragment
    fn main(@location(auto) fragUV: vec2<f32> , @location(auto) worldPos:vec3<f32> ) -> FragmentOutput {
        let lightWorldPos = globalUniform.CameraPos;
        var distance = length(worldPos.xyz - lightWorldPos) ;
        distance = distance / globalUniform.far;
        var fragOut:FragmentOutput; 

      #if USE_ALPHACUT
        let Albedo = textureSample(baseMap,baseMapSampler,fragUV);
        if(Albedo.w > 0.5){
          fragOut = FragmentOutput(vec4<f32>(0.0),distance);
        }
      #else
        fragOut = FragmentOutput(vec4<f32>(0.0),distance);
      #endif
      
        return fragOut ;
    }
`

/**
 * @internal
 */
export let directionShadowCastMap_frag: string = /*wgsl*/ `
    #if USE_ALPHACUT
      @group(1) @binding(0)
      var baseMapSampler: sampler;
      @group(1) @binding(1)
      var baseMap: texture_2d<f32>;
    #endif

    // Directional shadow is a DEPTH-ONLY pass: ShadowMapPassRenderer builds
    // RTFrame([], []) with no color attachments. This fragment shader must
    // therefore declare NO outputs (no @location and no @builtin(frag_depth))
    // and only take varyings that the vertex shader actually produces — the
    // VertexOutput struct only exports fragUV at location 0 plus position.
    // Even an "unused" extra input like @location(1) would create a binding
    // that Dawn's D3D12 backend can silently drop rasterized fragments for,
    // which is the symptom we saw (Mac works, Windows no shadows).
    @fragment
    fn main(@location(auto) fragUV: vec2<f32>) {
    }
`