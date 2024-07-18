export let FluidRenderShader = /* wgsl */ `
    #include "Common_vert"
    #include "Common_frag"
    #include "UnLit_frag"
    #include "UnLitMaterialUniform_frag"
    #include "MathShader"

    struct Particle_global {
        instance_index : f32,
        particles_Radius : f32,
        time : f32,
        timeDelta : f32,
    };

    @group(1) @binding(0)
    var baseMapSampler: sampler;

    @group(1) @binding(1)
    var baseMap: texture_2d<f32>;

    @group(3) @binding(0)
    var<storage, read> particlePosition : array<vec4<f32>>;

    @group(3) @binding(1) 
    var<storage, read> particleColor : array<vec4<f32>>;

    @group(3) @binding(2)
    var<storage, read> particleGlobalData: Particle_global;

    fn vert(vertex:VertexAttributes) -> VertexOutput {
        var particlePos = particlePosition[vertex.index];
        var worldMatrix = models.matrix[u32(particleGlobalData.instance_index)];
        var normalMatrix = transpose(inverse( mat3x3<f32>(worldMatrix[0].xyz,worldMatrix[1].xyz,worldMatrix[2].xyz) ));

        var wPosition = vertex.position.xyz;

        var worldNormal = normalize(normalMatrix * vertex.normal.xyz);

        wPosition.x += particlePos.x;
        wPosition.y += particlePos.y;
        wPosition.z += particlePos.z;

        ORI_VertexOut.varying_UV0 = vertex.uv;
    
        var worldPos = (worldMatrix * vec4<f32>(wPosition.xyz, 1.0));
        var viewPosition = ((globalUniform.viewMat) * worldPos);

        ORI_VertexOut.varying_WPos = worldPos;
        ORI_VertexOut.varying_WPos.w = f32(particleGlobalData.instance_index);

        var clipPosition = globalUniform.projMat * viewPosition ;

        //ORI_VertexOut.varying_ViewPos = clipPosition.xyz;

        ORI_VertexOut.member = clipPosition;
            
        //ORI_VertexOut.fragCoord = normalize(vertex.position.xy) + vec2<f32>(0.5, 0.5);
        ORI_VertexOut.varying_Color = particleColor[vertex.index];
        ORI_VertexOut.varying_WNormal = worldNormal ; 
        ORI_VertexOut.index = f32(particleGlobalData.instance_index) ;
        return ORI_VertexOut;
    }

    fn frag() {
        let color = ORI_VertexVarying.vColor;
        let worldPos = ORI_VertexVarying.vWorldPos;
        let worldNormal = ORI_VertexVarying.vWorldNormal;
        
        let V = normalize(globalUniform.cameraWorldMatrix[3].xyz - worldPos.xyz) ;
        let N = worldNormal.xyz;

        let att = max( dot(V,N) , 0.0) * 0.35 + 0.65 ;
        var newColor = color.xyz * att ;

        ORI_ShadingInput.BaseColor = vec4<f32>(newColor.xyz ,color.w );
        
        UnLit();
    }`