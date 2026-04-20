import { SkeletonAnimation_shader } from "../../anim/SkeletonAnimation_shader";
import { MorphTarget_shader } from "../../../../components/anim/morphAnim/MorphTarget_shader";

/**
 * @internal
 */
export let VertexFunction_vert: string = /*wgsl*/ `
    var<private> PI: f32 = 3.14159265359;
    #if USE_METAHUMAN
        ${MorphTarget_shader.getMorphTargetShaderBinding(3, 0)}
        ${SkeletonAnimation_shader.groupBindingAndFunctions(3, 2)}
    #else
        #if USE_MORPHTARGETS
            ${MorphTarget_shader.getMorphTargetShaderBinding(3, 0)}
        #endif

        #if USE_SKELETON
            ${SkeletonAnimation_shader.groupBindingAndFunctions(3, 0)}
        #endif
    #endif

    var<private> ORI_VertexOut: VertexOutput ;

    fn ORI_Vert(vertex:VertexAttributes){
    var vertexPosition = vertex.position;
    var vertexNormal = vertex.normal;

    #if USE_METAHUMAN
        ${MorphTarget_shader.getMorphTargetCalcVertex()}
        #if USE_JOINT_VEC8
            let skeletonNormal = getSkeletonWorldMatrix_8(vertex.joints0, vertex.weights0, vertex.joints1, vertex.weights1);
            ORI_MATRIX_M *= skeletonNormal ;
        #else
            let skeletonNormal = getSkeletonWorldMatrix_4(vertex.joints0, vertex.weights0);
            ORI_MATRIX_M *= skeletonNormal ;
        #endif
    #else
        #if USE_MORPHTARGETS
            ${MorphTarget_shader.getMorphTargetCalcVertex()}
        #endif

        #if USE_SKELETON
            #if USE_JOINT_VEC8
                let skeletonNormal = getSkeletonWorldMatrix_8(vertex.joints0, vertex.weights0, vertex.joints1, vertex.weights1);
                ORI_MATRIX_M *= skeletonNormal ;
            #else
                let skeletonNormal = getSkeletonWorldMatrix_4(vertex.joints0, vertex.weights0);
                ORI_MATRIX_M *= skeletonNormal ;
            #endif
        #endif
    #endif

    ORI_NORMALMATRIX = transpose(inverse( mat3x3<f32>(ORI_MATRIX_M[0].xyz,ORI_MATRIX_M[1].xyz,ORI_MATRIX_M[2].xyz) ));

    #if USE_TANGENT
        ORI_VertexOut.varying_Tangent = vec4f(normalize(ORI_NORMALMATRIX * vertex.TANGENT.xyz),vertex.TANGENT.w)  ;
    #endif

    var worldPos = (ORI_MATRIX_M * vec4<f32>(vertexPosition.xyz, 1.0));
    var viewPosition = ORI_MATRIX_V * worldPos;
    var clipPosition = ORI_MATRIX_P * viewPosition ;

    #if USE_LOGDEPTH
        clipPosition.z = log2Depth(clipPosition.w, globalUniform.near, globalUniform.far);
    #endif

    ORI_CameraWorldDir = normalize(ORI_CAMERAMATRIX[3].xyz - worldPos.xyz) ;

    ORI_VertexOut.index = f32(vertex.index) ;

    ORI_VertexOut.varying_UV0 = vertex.uv.xy ;

    ORI_VertexOut.varying_UV1 = vertex.TEXCOORD_1.xy;

    ORI_VertexOut.varying_ViewPos = viewPosition ;
    ORI_VertexOut.varying_Clip = clipPosition ;
    ORI_VertexOut.varying_WPos = worldPos ;
    ORI_VertexOut.varying_WPos.w = f32(vertex.index);
    ORI_VertexOut.varying_WNormal = normalize(ORI_NORMALMATRIX * vertexNormal.xyz) ;

    ORI_VertexOut.member = clipPosition ;
    }
`
