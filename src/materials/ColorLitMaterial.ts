import { Material, RenderShaderPass, PassType, Shader } from '..';
import { Engine3D } from '../Engine3D';
import { ShaderLib } from '../assets/shader/ShaderLib';
import { ColorLitShader } from '../assets/shader/materials/ColorLitShader';
import { Context3D } from '../gfx/graphics/webGpu/Context3D';
import { Color } from '../math/Color';

/**
 * ColorLitMaterial
 * @group Material
 */
export class ColorLitMaterial extends Material {
    static count = 0;
    /**
     * @constructor
     */
    constructor(ctx?: Context3D) {
        super();

        ShaderLib.register("ColorLitShader", ColorLitShader);

        // Register the COLOR pass BEFORE assigning: the Material.shader
        // setter dereferences getDefaultShaders()[0] immediately.
        let shader = new Shader()
        let renderShader = new RenderShaderPass(`ColorLitShader`, `ColorLitShader`);
        renderShader.passType = PassType.COLOR;
        shader.addRenderPass(renderShader);
        this.shader = shader;

        renderShader.setDefine("USE_BRDF", true);
        renderShader.setShaderEntry(`VertMain`, `FragMain`)
        renderShader.setUniformColor(`baseColor`, new Color());
        renderShader.setUniformColor(`emissiveColor`, new Color());
        renderShader.setUniformFloat(`envIntensity`, 1);
        renderShader.setUniformFloat(`normalScale`, 1);
        renderShader.setUniformFloat(`roughness`, 0.0);
        renderShader.setUniformFloat(`metallic`, 0.0);
        renderShader.setUniformFloat(`ao`, 1.0);
        renderShader.setUniformFloat(`alphaCutoff`, 0.0);

        let shaderState = renderShader.shaderState;
        shaderState.acceptShadow = true;
        shaderState.receiveEnv = true;
        shaderState.acceptGI = true;
        shaderState.useLight = true;

        const res = Engine3D.resFor(ctx);
        renderShader.setTexture("normalMap", res.normalTexture);
        renderShader.setTexture("emissiveMap", res.blackTexture);
    }

    clone(): this {
        // Returning null poisoned RenderNode.selfCloneMaterials with null
        // materials; deep-copy the shader like the other material clones.
        let ret = new ColorLitMaterial();
        ret.shader = this.shader.clone();
        ret.name = this.name;
        return ret as this;
    }

    debug() {
    }
}
