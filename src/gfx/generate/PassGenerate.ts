import { RenderNode } from '../../components/renderer/RenderNode';
import { RendererMaskUtil, RendererMask } from '../renderJob/passRenderer/state/RendererMask';
import { PassType } from '../renderJob/passRenderer/state/PassType';
import { GLTFType } from '../../loader/parser/gltf/GLTFType';
import { Shader } from '../graphics/webGpu/shader/Shader';
import { SkyGBufferPass } from '../../materials/multiPass/SkyGBufferPass';
import { GBufferPass } from '../../materials/multiPass/GBufferPass';
import { CastShadowMaterialPass } from '../../materials/multiPass/CastShadowMaterialPass';
import { CastPointShadowMaterialPass } from '../../materials/multiPass/CastPointShadowMaterialPass';
import { DepthMaterialPass } from '../../materials/multiPass/DepthMaterialPass';
import { OITAccumPass } from '../../materials/multiPass/OITAccumPass';
import { RenderShaderPass } from '../..';
import { bindCtx, Context3D } from '../graphics/webGpu/Context3D';

/**
 * @internal
 * @group GFX
 */
export class PassGenerate {

    private static _ctxOf(renderNode: RenderNode): Context3D | null {
        return renderNode.transform?.view3D?.engine3D?.context3D ?? null;
    }

    public static createGIPass(renderNode: RenderNode, shader: Shader) {
        if (RendererMaskUtil.hasMask(renderNode.rendererMask, RendererMask.Sky)) {
            let pass0 = shader.passShader.get(PassType.GI);
            if (!pass0) {
                let colorPass = shader.getSubShaders(PassType.COLOR)[0];
                let pass = new SkyGBufferPass();
                pass.setTexture(`baseMap`, colorPass.getTexture('baseMap'));
                pass.cullMode = colorPass.cullMode;
                pass.frontFace = colorPass.frontFace;
                shader.addRenderPass(pass, 0);
                const ctx = this._ctxOf(renderNode);
                if (ctx) bindCtx(pass, ctx);
                pass.preCompile(renderNode.geometry);
            }

        } else {
            this.castGBufferPass(renderNode, shader);
        }
    }

    public static castGBufferPass(renderNode: RenderNode, shader: Shader) {
        let colorPassList = shader.getDefaultShaders();
        for (let jj = 0; jj < colorPassList.length; jj++) {
            const colorPass = colorPassList[jj];

            let giPassList = shader.getSubShaders(PassType.GI);
            if (!giPassList || giPassList.length == 0 || giPassList.length < jj) {
                let pass = new GBufferPass();
                pass.setTexture('baseMap', colorPass.getTexture("baseMap"));
                pass.setTexture('normalMap', colorPass.getTexture("normalMap"));
                pass.setTexture('emissiveMap', colorPass.getTexture("emissiveMap"));

                pass.setUniform('baseColor', colorPass.getUniform("baseColor"));
                pass.setUniform('envIntensity', colorPass.getUniform("envIntensity"));
                pass.setUniform('emissiveColor', colorPass.getUniform("emissiveColor"));
                pass.setUniform('emissiveIntensity', colorPass.getUniform("emissiveIntensity"));
                pass.setUniform('alphaCutoff', colorPass.getUniform("alphaCutoff"));

                pass.cullMode = colorPass.cullMode;
                pass.frontFace = colorPass.frontFace;
                const ctx = this._ctxOf(renderNode);
                if (ctx) bindCtx(pass, ctx);
                pass.preCompile(renderNode.geometry);
                shader.addRenderPass(pass);
            }
        }
    }

    public static createShadowPass(renderNode: RenderNode, shader: Shader) {
        let use_skeleton = RendererMaskUtil.hasMask(renderNode.rendererMask, RendererMask.SkinnedMesh);
        let useMorphTargets = renderNode.geometry.hasAttribute(GLTFType.MORPH_POSITION_PREFIX + '0');
        let useMorphNormals = renderNode.geometry.hasAttribute(GLTFType.MORPH_NORMAL_PREFIX + '0');

        let colorPassList = shader.getSubShaders(PassType.COLOR);
        for (let i = 0; i < colorPassList.length; i++) {
            const colorPass = colorPassList[i];
            // Mirror the color pass's USE_TANGENT rather than asking geometry.
            // The geometry's vertexBufferLayouts are generated once against the
            // color pass's shader reflection (GeometryBase.generate is gated by
            // _onChange); if the shadow pass disagrees and declares TANGENT at
            // slot 4 while the color pass didn't, the pipeline's VertexState is
            // missing slot 4 and WebGPU rejects the shadow pipeline with
            // "Vertex attribute slot 4 used in shadowcastmap_vert is not
            // present in the VertexState".
            //
            // Must set the define unconditionally (even when false). Otherwise
            // RenderShaderPass.preDefine's `if (!('USE_TANGENT' in defineValue))`
            // fallback re-derives it from geometry.hasAttribute(TANGENT) inside
            // preCompile and silently flips the shadow pass back to true for any
            // model whose mesh carries tangent data (e.g. wukong.gltf), even
            // after the user explicitly disabled it on the color pass.
            let useTangent = colorPass.defineValue[`USE_TANGENT`] === true;
            let shadowPassList = shader.getSubShaders(PassType.SHADOW);
            if (!shadowPassList || shadowPassList.length < (i + 1)) {
                let shadowPass = new CastShadowMaterialPass();
                shadowPass.doubleSide = colorPass.doubleSide;
                shadowPass.setTexture(`baseMap`, colorPass.getTexture(`baseMap`));
                shadowPass.setUniform(`alphaCutoff`, colorPass.getUniform(`alphaCutoff`));
                // shadowPass.setDefine("USE_ALPHACUT", colorPass.shaderState.alphaCutoff < 1.0);
                shadowPass.setDefine(`USE_TANGENT`, useTangent);
                if (use_skeleton) {
                    shadowPass.setDefine(`USE_SKELETON`, use_skeleton);
                }
                if (useMorphTargets) {
                    shadowPass.setDefine(`USE_MORPHTARGETS`, useMorphTargets);
                }
                if (useMorphNormals) {
                    shadowPass.setDefine(`USE_MORPHNORMALS`, useMorphNormals);
                }
                // shadowPass.shaderState.cullMode = colorPass.cullMode;
                // if (colorPass.cullMode == `none`) {
                //     shadowPass.shaderState.cullMode = `none`;
                // } else if (colorPass.cullMode == `back`) {
                //     shadowPass.shaderState.cullMode = `front`;
                // } else if (colorPass.cullMode == `front`) {
                //     shadowPass.shaderState.cullMode = `back`;
                // }
                const ctxA = this._ctxOf(renderNode);
                if (ctxA) bindCtx(shadowPass, ctxA);
                shadowPass.preCompile(renderNode.geometry);
                shader.addRenderPass(shadowPass);
            }

            let castPointShadowPassList = shader.getSubShaders(PassType.POINT_SHADOW);
            if (!castPointShadowPassList || castPointShadowPassList.length < (i + 1)) {
                let castPointShadowPass = new CastPointShadowMaterialPass();
                castPointShadowPass.setTexture(`baseMap`, colorPass.getTexture(`baseMap`));
                castPointShadowPass.setUniform(`alphaCutoff`, colorPass.getUniform(`alphaCutoff`));
                castPointShadowPass.setDefine("USE_ALPHACUT", 1);
                // castPointShadowPass.doubleSide = false ;
                for (let j = 0; j < 1; j++) {
                    // Same rationale as CastShadowMaterialPass above — mirror
                    // the color pass's USE_TANGENT unconditionally so preDefine
                    // can't re-derive it from geometry attributes.
                    castPointShadowPass.setDefine(`USE_TANGENT`, useTangent);
                    if (use_skeleton) {
                        castPointShadowPass.setDefine(`USE_SKELETON`, use_skeleton);
                    }
                    if (useMorphTargets) {
                        castPointShadowPass.setDefine(`USE_MORPHTARGETS`, useMorphTargets);
                    }
                    if (useMorphNormals) {
                        castPointShadowPass.setDefine(`USE_MORPHNORMALS`, useMorphNormals);
                    }
                    castPointShadowPass.shaderState.cullMode = `front`;
                    const ctxB = this._ctxOf(renderNode);
                    if (ctxB) bindCtx(castPointShadowPass, ctxB);
                    castPointShadowPass.preCompile(renderNode.geometry);
                }
                shader.addRenderPass(castPointShadowPass);
            }
        }
    }

    public static createDepthPass(renderNode: RenderNode, shader: Shader) {
        let colorListPass = shader.getSubShaders(PassType.COLOR);
        let useMorphTargets = renderNode.geometry.hasAttribute(GLTFType.MORPH_POSITION_PREFIX + '0');
        let useMorphNormals = renderNode.geometry.hasAttribute(GLTFType.MORPH_NORMAL_PREFIX + '0');
        let use_skeleton = RendererMaskUtil.hasMask(renderNode.rendererMask, RendererMask.SkinnedMesh);

        for (let i = 0; i < colorListPass.length; i++) {
            const colorPass = colorListPass[i];
            // Mirror color pass's USE_TANGENT (see createShadowPass for rationale).
            let useTangent = colorPass.defineValue[`USE_TANGENT`] === true;
            let depthPassList = shader.getSubShaders(PassType.DEPTH);
            if (!depthPassList && colorPass.shaderState.useZ) {
                if (!depthPassList || depthPassList.length < i) {
                    let depthPass = new DepthMaterialPass();
                    depthPass.setTexture(`baseMap`, colorPass.getTexture(`baseMap`));
                    // Same rationale as createShadowPass — mirror unconditionally.
                    depthPass.setDefine(`USE_TANGENT`, useTangent);
                    if (use_skeleton) {
                        depthPass.setDefine(`USE_SKELETON`, use_skeleton);
                    }
                    if (useMorphTargets) {
                        depthPass.setDefine(`USE_MORPHTARGETS`, useMorphTargets);
                    }
                    if (useMorphNormals) {
                        depthPass.setDefine(`USE_MORPHNORMALS`, useMorphNormals);
                    }
                    depthPass.cullMode = colorPass.cullMode;
                    depthPass.frontFace = colorPass.frontFace;
                    const ctx = this._ctxOf(renderNode);
                    if (ctx) bindCtx(depthPass, ctx);
                    depthPass.preCompile(renderNode.geometry);
                    shader.addRenderPass(depthPass);
                }
            }
        }
    }

    /**
     * Build the WBOIT accumulation pass for materials whose
     * `oitMode === 'weighted'`. Mirrors the createReflectionPass
     * pattern but reuses the **full PBRLitShader** lighting pipeline
     * — every define / uniform / texture from the color pass is
     * cloned, then `USE_OIT_ACCUM` is set so the trailing block in
     * Common_frag's FragMain overrides the fragment outputs with the
     * WBOIT-weighted (accum, reveal) pair instead of the lit color.
     *
     * The full clone is necessary because PBR lighting depends on
     * baseMap, normalMap, maskMap, environment probe, shadow maps,
     * IBL, clearcoat textures, transmission state, etc. Selectively
     * copying a subset (as the previous standalone OITAccumShader
     * version did) produced unlit-looking transparents.
     *
     * No-op if an OIT pass already exists for this material.
     */
    public static createOITPass(renderNode: RenderNode, shader: Shader) {
        const colorPassList = shader.getDefaultShaders();
        if (!colorPassList) return;
        for (let jj = 0; jj < colorPassList.length; jj++) {
            const colorPass = colorPassList[jj];
            const existing = shader.getSubShaders(PassType.OIT_ACCUM);
            if (existing && existing.length > jj) continue;

            // Use the COLOR pass's own vs/fs so the OIT accumulation
            // pipeline runs the SAME fragment program. Without this,
            // OITAccumPass's PBRLitShader default would try to bind
            // PBR-only uniforms (clearcoat*, transmission*, *MapOffsetSize)
            // for materials whose color pass is e.g. UnLit, blowing up
            // in initDataUniform with "size" undefined.
            const pass = new OITAccumPass(colorPass.vsName, colorPass.fsName);

            // Clone shaderState — we want the same culling / front-face
            // / topology / lighting flags / receive-env etc as the
            // color pass. depthWriteEnabled stays as OITAccumPass set
            // it (false) and transparent stays true.
            for (const key in colorPass.shaderState) {
                if (key === 'depthWriteEnabled' || key === 'transparent' || key === 'blendMode') continue;
                (pass.shaderState as any)[key] = (colorPass.shaderState as any)[key];
            }

            // Clone uniforms / textures / defines wholesale. Defines
            // drive shader code paths (USE_TRANSMISSION, USE_CLEARCOAT,
            // USE_TANGENT, USE_ALPHACUT, USE_AOTEX, ...); uniforms +
            // textures feed the same lighting math the color pass
            // would have run.
            for (const uniformName in colorPass.uniforms) {
                pass.setUniform(uniformName, colorPass.getUniform(uniformName));
            }
            for (const textureName in colorPass.textures) {
                const tex = colorPass.getTexture(textureName);
                if (tex) pass.setTexture(textureName, tex);
            }
            // Clone storage / uniform buffers (lightBuffer,
            // reflectionBuffer, clusterBuffer, ...). RenderNode.nodeUpdate
            // sets these on the COLOR pass during first-init, gated by
            // "if (!pass.<TexOrField>)" so they only run once per pass.
            // Cloning textures alone (above) flips that gate to true on
            // the OIT pass, so the storage-buffer setters that share
            // the gate would be skipped — leaving the OIT pass with
            // reflectionMap-the-texture but no reflectionBuffer-the-
            // storage-buffer, blowing up reBuild's getGroupLayout when
            // it looks for the buffer by name.
            const cb = (colorPass as any)._bufferDic as Map<string, any> | undefined;
            if (cb) {
                cb.forEach((buf, name) => {
                    if (!buf) return;
                    // Pick the right setter based on the buffer's class.
                    if ((buf.constructor && buf.constructor.name === 'UniformGPUBuffer')) {
                        (pass as any).setUniformBuffer(name, buf);
                    } else {
                        (pass as any).setStorageBuffer(name, buf);
                    }
                });
            }
            for (const defineName in colorPass.defineValue) {
                pass.setDefine(defineName, colorPass.defineValue[defineName]);
            }
            // Last: flip USE_OIT_ACCUM. Goes after the bulk define
            // copy so any cloned `false` value can't override it.
            pass.setDefine('USE_OIT_ACCUM', true);

            const ctx = this._ctxOf(renderNode);
            if (ctx) bindCtx(pass, ctx);
            pass.preCompile(renderNode.geometry);
            shader.addRenderPass(pass);
        }
    }

    static createReflectionPass(renderNode: RenderNode, shader: Shader) {
        let colorPassList = shader.getDefaultShaders();
        for (let jj = 0; jj < colorPassList.length; jj++) {
            const colorPass = colorPassList[jj];

            let colorSubPassList = shader.getSubShaders(PassType.REFLECTION);
            if (!colorSubPassList || colorSubPassList.length == 0 || colorSubPassList.length < jj) {
                let pass = new RenderShaderPass(colorPass.vsName, colorPass.fsName);
                pass.vsEntryPoint = colorPass.vsEntryPoint;
                pass.fsEntryPoint = colorPass.fsEntryPoint;
                pass.passType = PassType.REFLECTION;

                for (const state in colorPass.shaderState) {
                    var v = colorPass.shaderState[state];
                    pass.shaderState[state] = v;
                }

                for (const textureName in colorPass.textures) {
                    var texture = colorPass.getTexture(textureName);
                    pass.setTexture(textureName, texture);
                }

                for (const uniformName in colorPass.uniforms) {
                    var value = colorPass.getUniform(uniformName);
                    pass.setUniform(uniformName, value);
                }

                for (const defineName in colorPass.defineValue) {
                    var value = colorPass.defineValue[defineName];
                    pass.setDefine(defineName, value);
                }

                pass.setDefine("USE_CASTREFLECTION", true);

                const ctx = this._ctxOf(renderNode);
                if (ctx) bindCtx(pass, ctx);
                pass.preCompile(renderNode.geometry);
                shader.addRenderPass(pass);
            }
        }
    }
}
