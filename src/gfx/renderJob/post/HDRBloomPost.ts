import { ViewQuad } from '../../../core/ViewQuad';
import { Engine3D } from '../../../Engine3D';
import { Vector2 } from '../../../math/Vector2';
import { UniformNode } from '../../graphics/webGpu/core/uniforms/UniformNode';
import { GPUTextureFormat } from '../../graphics/webGpu/WebGPUConst';
import { webGPUContext } from '../../graphics/webGpu/Context3D';
import { GPUContext } from '../GPUContext';
import { RTResourceConfig } from '../config/RTResourceConfig';
import { RTResourceMap } from '../frame/RTResourceMap';
import { PostBase } from './PostBase';
import { View3D } from '../../../core/View3D';
import { Color, RendererType } from '../../..';
/**
 * HDR Bloom effect
 * ```
 * @group Post Effects
 */
export class HDRBloomPost extends PostBase {
    private brightnessView: ViewQuad;
    private compositeView: ViewQuad;
    private blurList: { ql: ViewQuad; qr: ViewQuad }[];
    /**
     * @internal
     */
    public blurX: number = 1;
    /**
     * @internal
     */
    public blurY: number = 1;
    constructor() {
        super();
        const bloomSetting = Engine3D.setting.render.postProcessing.bloom;

        bloomSetting.enable = true;

        let presentationSize = webGPUContext.presentationSize;
        let outTextures = this.createRTTexture('HDRBloomPost-outTextures', presentationSize[0], presentationSize[1], GPUTextureFormat.rgba16float, false);
        RTResourceMap.createRTTexture(RTResourceConfig.colorBufferTex_NAME, presentationSize[0], presentationSize[1], GPUTextureFormat.rgba16float, false);

        {
            let brightnessTextures = this.createRTTexture('brightnessTextures', presentationSize[0], presentationSize[1], GPUTextureFormat.rgba16float, false);

            this.brightnessView = this.createViewQuad(`brightnessView`, `Bloom_Brightness_frag_wgsl`, brightnessTextures, {
                luminosityThreshold: new UniformNode(bloomSetting.luminosityThreshold),
            });
        }

        let blurMip = 5;
        let sizeW = presentationSize[0];
        let sizeH = presentationSize[1];
        this.blurList = [];
        for (let i = 0; i < blurMip; i++) {
            let tex_l = this.createRTTexture(`tex_l${i}`, sizeW, sizeH, GPUTextureFormat.rgba16float);
            let tex_r = this.createRTTexture(`tex_r${i}`, sizeW, sizeH, GPUTextureFormat.rgba16float);

            let ql = this.createViewQuad(`ql${i}`, `Bloom_blur_frag_wgsl`, tex_l, {
                texSize: new UniformNode(new Vector2(sizeW * 2, sizeH * 2)),
                hScale: new UniformNode(i),
                vScale: new UniformNode(i),
                horizontal: new UniformNode(0.5),
            });

            let qr = this.createViewQuad(`qr${i}`, `Bloom_blur_frag_wgsl`, tex_r, {
                texSize: new UniformNode(new Vector2(sizeW * 2, sizeH * 2)),
                hScale: new UniformNode(i),
                vScale: new UniformNode(i),
                horizontal: new UniformNode(1.0),
            });

            this.blurList.push({
                ql: ql,
                qr: qr,
            });

            sizeW /= 2;
            sizeH /= 2;
        }

        {
            this.compositeView = this.createViewQuad(`compositeView`, `Bloom_composite_frag_wgsl`, outTextures, {
                tintColor: new UniformNode(new Color(1, 1, 1)),
                bloomStrength: new UniformNode(bloomSetting.strength),
                exposure: new UniformNode(bloomSetting.exposure),
                bloomRadius: new UniformNode(1),
            });
        }

        this.blurX = bloomSetting.blurX;
        this.blurY = bloomSetting.blurY;
        this.luminosityThreshold = bloomSetting.luminosityThreshold;
        this.strength = bloomSetting.strength;
        this.radius = bloomSetting.radius;
    }

    onAttach(view: View3D): void {
        this.debug();
    }

    onDetach(view: View3D): void {
    }

    public debug() {
    }

    public get tintColor(): Color {
        return this.compositeView.uniforms['tintColor'].color;
    }

    public set tintColor(color: Color) {
        this.compositeView.uniforms['tintColor'].color = color;
    }

    public get strength() {
        return this.compositeView.uniforms['bloomStrength'].value;
    }

    public set strength(value: number) {
        this.compositeView.uniforms['bloomStrength'].value = value;
    }

    public get exposure() {
        return this.compositeView.uniforms['exposure'].value;
    }

    public set exposure(value: number) {
        this.compositeView.uniforms['exposure'].value = value;
    }


    public get radius() {
        return this.compositeView.uniforms['bloomRadius'].value;
    }

    public set radius(value: number) {
        this.compositeView.uniforms['bloomRadius'].value = value;
    }

    public get luminosityThreshold(): number {
        return this.brightnessView.uniforms['luminosityThreshold'].value;
    }

    public set luminosityThreshold(value: number) {
        this.brightnessView.uniforms['luminosityThreshold'].value = value;
    }

    /**
     * @internal
     */
    render(view: View3D, command: GPUCommandEncoder) {
        // let command = GPUContext.beginCommandEncoder();
        {
            let colorTexture = this.getOutTexture();
            {
                this.brightnessView.renderToViewQuad(view, this.brightnessView, command, colorTexture);
            }
            {
                let tex = this.brightnessView.rendererPassState.renderTargets[0];
                for (let i = 0; i < this.blurList.length; i++) {
                    let ql = this.blurList[i].ql;
                    let qr = this.blurList[i].qr;

                    ql.pass.setUniformFloat(`horizontal`, 0.5);
                    ql.pass.setUniformFloat(`vScale`, i * this.blurX);

                    ql.renderToViewQuad(view, ql, command, tex);
                    tex = ql.rendererPassState.renderTargets[0];

                    qr.pass.setUniformFloat(`horizontal`, 2.0);
                    qr.pass.setUniformFloat(`hScale`, i * this.blurY);

                    qr.renderToViewQuad(view, qr, command, tex);
                    tex = qr.rendererPassState.renderTargets[0];
                }
            }

            {
                let pass = this.compositeView.pass;
                pass.setTexture(`blurTex1`, this.blurList[0].qr.rendererPassState.renderTargets[0]);
                pass.setTexture(`blurTex2`, this.blurList[1].qr.rendererPassState.renderTargets[0]);
                pass.setTexture(`blurTex3`, this.blurList[2].qr.rendererPassState.renderTargets[0]);
                pass.setTexture(`blurTex4`, this.blurList[3].qr.rendererPassState.renderTargets[0]);
                pass.setTexture(`blurTex5`, this.blurList[4].qr.rendererPassState.renderTargets[0]);

                this.compositeView.renderToViewQuad(view, this.compositeView, command, colorTexture);
            }
        }
        // GPUContext.endCommandEncoder(command);
    }
}
