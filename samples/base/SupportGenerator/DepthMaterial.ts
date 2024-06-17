import { BoundingBox, Color, Engine3D, IBound, Material, RenderShaderPass, Shader, ShaderLib, Texture, UnLitShader, Vector4 } from "@orillusion/core";

export enum DepthMaterialOutputType {
    Depth,
    DepthHighPrecision,
    OnlyBottomEdge,
}

export class DepthMaterial extends Material {

    constructor() {
        super();

        ShaderLib.register('DepthFS', DepthMaterial.DepthFS);

        let colorShader = new RenderShaderPass('UnLit', 'DepthFS');
        colorShader.setShaderEntry(`VertMain`, `FragMain`)

        let shader = new Shader();
        shader.addRenderPass(colorShader);
        this.shader = shader;

        let shaderState = colorShader.shaderState;
        shaderState.acceptShadow = false;
        shaderState.castShadow = false;
        shaderState.receiveEnv = false;
        shaderState.acceptGI = false;
        shaderState.useLight = false;
        this.setDefine('USE_BRDF', true);
        this.setDefine('USE_AO_R', true);
        this.setDefine('USE_ROUGHNESS_G', true);
        this.setDefine('USE_METALLIC_B', true);
        this.setDefine('USE_ALPHA_A', true);
        this.setDefine('USE_CUSTOMUNIFORM', true);
        
        this.setUniformVector4(`boundMin`, new Vector4(0, 0, 0, 0));
        this.setUniformVector4(`boundMax`, new Vector4(0, 0, 1, 1));
        this.setUniformFloat(`outputType`, 0);
        this.setUniformFloat(`onlyBottomEdge`, 0);
        this.setUniformFloat(`beginHeight`, -0.00001);
        this.setUniformFloat(`endHeight`, 1.0);

        // default value
        this.baseMap = Engine3D.res.whiteTexture;
    }

    public set beginHeight(value: number) {
        if (value == 0)
            value = -0.00001;
        this.setUniformFloat(`beginHeight`, value);
    }

    public get beginHeight(): number {
        return this.getUniformFloat(`beginHeight`);
    }

    public set endHeight(value: number) {
        this.setUniformFloat(`endHeight`, value);
    }

    public get endHeight(): number {
        return this.getUniformFloat(`endHeight`);
    }

    public set outputType(type: DepthMaterialOutputType) {
        this.setUniformFloat(`outputType`, Number(type));
    }

    public get outputType(): DepthMaterialOutputType {
        return this.getUniformFloat(`onlyBottomEdge`);
    }

    public set boundBox(v: IBound) {
        this.setUniformVector4(`boundMin`, new Vector4(v.min.x, v.min.y, v.min.z, 0));
        this.setUniformVector4(`boundMax`, new Vector4(v.max.x, v.max.y, v.max.z, 0));
    }

    public set baseMap(texture: Texture) {
        this.shader.setTexture(`baseMap`, texture);
    }

    public get baseMap() {
        return this.shader.getTexture(`baseMap`);
    }

    public set envMap(texture: Texture) {
    }

    public set shadowMap(texture: Texture) {
    }

    public static DepthFS = /* WGSL */ `
        #include "Common_vert"
        #include "Common_frag"
        #include "UnLit_frag"
        #include "UnLitMaterialUniform_frag"

        #if USE_CUSTOMUNIFORM
            struct MaterialUniform {
                boundMin:vec4<f32>,
                boundMax:vec4<f32>,
                outputType: f32,
                onlyBottomEdge: f32,
                beginHeight: f32,
                endHeight: f32,
            };
        #endif

        @group(1) @binding(0)
        var baseMapSampler: sampler;
        @group(1) @binding(1)
        var baseMap: texture_2d<f32>;

        fn vert(inputData:VertexAttributes) -> VertexOutput {
            ORI_Vert(inputData) ;
            return ORI_VertexOut ;
        }

        fn frag(){
            // if (ORI_VertexVarying.vWorldPos.y > 0) {
            //     discard;
            // }

            // var transformUV1 = materialUniform.transformUV1;
            // var transformUV2 = materialUniform.transformUV2;

            // var uv = transformUV1.zw * ORI_VertexVarying.fragUV0 + transformUV1.xy; 
            // let color = textureSample(baseMap, baseMapSampler, uv) ;
            // if(color.w < 0.5){
            //     discard ;
            // }

            // var depth = ORI_VertexVarying.fragCoord.z / ORI_VertexVarying.fragCoord.w;
            // depth = depth * 0.5 + 0.5;

            let minY = materialUniform.boundMin.y;
            let maxY = materialUniform.boundMax.y;
            var depth = 1.0 - (ORI_VertexVarying.vWorldPos.y - minY) / (maxY - minY);

            switch (u32(materialUniform.outputType)) {
                case ${DepthMaterialOutputType.DepthHighPrecision}: {
                    let depthValue: u32 = u32(depth * f32(0xFFFFFF));
                    // var r = (depthValue >> 24) & 0xFF;
                    var g = (depthValue >> 16) & 0xFF;
                    var b = (depthValue >> 8) & 0xFF;
                    var a = depthValue & 0xFF;
                    ORI_ShadingInput.BaseColor = vec4<f32>(vec3<f32>(f32(g)/255.0, f32(b)/255.0, f32(a)/255.0), 1.0);
                }
                case ${DepthMaterialOutputType.OnlyBottomEdge}: {
                    let h = ORI_VertexVarying.vWorldPos.y - minY;
                    if (h < materialUniform.beginHeight || h > materialUniform.endHeight) {
                        discard;
                    }
                    ORI_ShadingInput.BaseColor = vec4<f32>(vec3<f32>(depth), 1.0);
                }
                default {
                    ORI_ShadingInput.BaseColor = vec4<f32>(vec3<f32>(depth), 1.0);
                }
            }

            if (!isFrontFace) {
                ORI_ShadingInput.BaseColor = vec4<f32>(vec3<f32>(1.0, 0, 0), 1.0);
            } else {
                ORI_ShadingInput.BaseColor = vec4<f32>(vec3<f32>(0.1, 0.8, 1.0), 0.0);
            }

            UnLit();
        }
    `;
}
