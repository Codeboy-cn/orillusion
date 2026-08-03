import { SSGI_cs } from '../../../assets/shader/compute/SSGI_cs';
import { SSGITemporal_cs } from '../../../assets/shader/compute/SSGITemporal_cs';
import { ShaderLib } from '../../../assets/shader/ShaderLib';
import { View3D } from '../../../core/View3D';
import { clamp } from '../../../math/MathUtil';
import { Matrix4 } from '../../../math/Matrix4';
import { VirtualTexture } from '../../../textures/VirtualTexture';
import { GlobalBindGroup } from '../../graphics/webGpu/core/bindGroups/GlobalBindGroup';
import { UniformGPUBuffer } from '../../graphics/webGpu/core/buffer/UniformGPUBuffer';
import { ComputeShader } from '../../graphics/webGpu/shader/ComputeShader';
import { GPUTextureFormat } from '../../graphics/webGpu/WebGPUConst';
import { WebGPUDescriptorCreator } from '../../graphics/webGpu/descriptor/WebGPUDescriptorCreator';
import { GBufferFrame } from '../frame/GBufferFrame';
import { RTDescriptor } from '../../graphics/webGpu/descriptor/RTDescriptor';
import { RTFrame } from '../frame/RTFrame';
import { PostBase } from './PostBase';

/**
 * Horizon-based screen-space global illumination (single bounce).
 *
 * Two compute passes per frame:
 *  1. march (SSGI_cs): azimuthal horizon gather over the scene color —
 *     a noisy single-frame irradiance estimate.
 *  2. resolve (SSGITemporal_cs): reprojected, depth-validated temporal
 *     EMA over the estimates, composited onto the scene color.
 *
 * Complements the volumetric DDGI probe field with contact-scale color
 * bleeding it cannot resolve.
 *
 * Add to scene: `view.scene.addComponent(PostProcessingComponent).addPost(SSGIPost)`.
 * Tuning lives in `engine.setting.render.postProcessing.ssgi`.
 *
 * @group Post Effects
 */
export class SSGIPost extends PostBase {
    private _outTex: VirtualTexture;
    private _giTex: VirtualTexture;
    // History double buffer with single-role usages: the resolve pass
    // samples _historyRead and writes _historyWrite; the frame ends
    // with a write->read copy.
    private _historyRead: VirtualTexture;
    private _historyWrite: VirtualTexture;
    private _marchCompute: ComputeShader;
    private _temporalCompute: ComputeShader;
    private _marchSettings: UniformGPUBuffer;
    private _temporalSettings: UniformGPUBuffer;
    private _rtFrame: RTFrame;
    private _preProjMatrix: Matrix4 = new Matrix4();
    private _preViewMatrix: Matrix4 = new Matrix4();
    private _frameIndex: number = 0;

    /**
     * @internal
     */
    onAttach(view: View3D) {
        this.setting.render.postProcessing.ssgi.enable = true;
    }

    /**
     * @internal
     */
    onDetach(view: View3D) {
        this.setting.render.postProcessing.ssgi.enable = false;
    }

    public get intensity() {
        return this.setting.render.postProcessing.ssgi.intensity;
    }

    public set intensity(value: number) {
        this.setting.render.postProcessing.ssgi.intensity = clamp(value, 0, 10);
    }

    public get radius() {
        return this.setting.render.postProcessing.ssgi.radius;
    }

    public set radius(value: number) {
        this.setting.render.postProcessing.ssgi.radius = clamp(value, 0.1, 1000);
    }

    public get sliceCount() {
        return this.setting.render.postProcessing.ssgi.sliceCount;
    }

    public set sliceCount(value: number) {
        this.setting.render.postProcessing.ssgi.sliceCount = clamp(Math.round(value), 2, 8);
    }

    public get stepCount() {
        return this.setting.render.postProcessing.ssgi.stepCount;
    }

    public set stepCount(value: number) {
        this.setting.render.postProcessing.ssgi.stepCount = clamp(Math.round(value), 4, 16);
    }

    /** Temporal blend: fraction of the accumulated history kept each
     *  frame. 0 disables accumulation, 0.98 averages ~50 frames. */
    public get hysteresis() {
        return this.setting.render.postProcessing.ssgi.hysteresis;
    }

    public set hysteresis(value: number) {
        this.setting.render.postProcessing.ssgi.hysteresis = clamp(value, 0, 0.99);
    }

    private _createResources() {
        const [w, h] = this._boundCtx!.presentationSize;
        const rwUsage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING;
        this._outTex = new VirtualTexture(w, h, GPUTextureFormat.rgba16float, false, rwUsage, 1, 0, 1, this._boundCtx!);
        this._outTex.name = 'SSGIOut';
        this._giTex = new VirtualTexture(w, h, GPUTextureFormat.rgba16float, false,
            GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING, 1, 0, 1, this._boundCtx!);
        this._giTex.name = 'SSGIRaw';
        // Fresh textures are zero-initialized; a zero depth key marks
        // the history invalid, so no explicit clear is needed.
        this._historyRead = new VirtualTexture(w, h, GPUTextureFormat.rgba16float, false,
            GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST, 1, 0, 1, this._boundCtx!);
        this._historyRead.name = 'SSGIHistoryRead';
        this._historyWrite = new VirtualTexture(w, h, GPUTextureFormat.rgba16float, false,
            GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC, 1, 0, 1, this._boundCtx!);
        this._historyWrite.name = 'SSGIHistoryWrite';
        const desc = new RTDescriptor(); desc.loadOp = 'load';
        this._rtFrame = new RTFrame([this._outTex], [desc]);
    }

    private _createCompute(view: View3D) {
        ShaderLib.register('SSGI_cs', SSGI_cs);
        ShaderLib.register('SSGITemporal_cs', SSGITemporal_cs);
        const rtFrame = GBufferFrame.getGBufferFrame(GBufferFrame.colorPass_GBuffer, view.engine3D.context3D);
        const gBufferTex = rtFrame.getCompressGBufferTexture();
        const cameraGroup = GlobalBindGroup.getCameraGroup(view.camera);

        this._marchCompute = new ComputeShader(SSGI_cs);
        this._marchSettings = new UniformGPUBuffer(4);
        this._marchCompute.setUniformBuffer('ssgiSettings', this._marchSettings);
        this._marchCompute.setSamplerTexture('gBufferTexture', gBufferTex);
        this._marchCompute.setSamplerTexture('inTex', this.getLastRenderTexture());
        this._marchCompute.setStorageTexture('giTex', this._giTex);
        this._marchCompute.setUniformBuffer('globalUniform', cameraGroup.uniformGPUBuffer);

        this._temporalCompute = new ComputeShader(SSGITemporal_cs);
        this._temporalSettings = new UniformGPUBuffer(16 * 2 + 4);
        this._temporalCompute.setUniformBuffer('temporalSettings', this._temporalSettings);
        this._temporalCompute.setSamplerTexture('gBufferTexture', gBufferTex);
        this._temporalCompute.setSamplerTexture('inTex', this.getLastRenderTexture());
        this._temporalCompute.setStorageTexture('outTex', this._outTex);
        this._temporalCompute.setSamplerTexture('giTex', this._giTex);
        this._temporalCompute.setSamplerTexture('historyTex', this._historyRead);
        this._temporalCompute.setStorageTexture('historyOut', this._historyWrite);
        this._temporalCompute.setUniformBuffer('globalUniform', cameraGroup.uniformGPUBuffer);
    }

    public render(view: View3D, command: GPUCommandEncoder) {
        if (!this._marchCompute) {
            this._createResources();
            this._createCompute(view);
            this.onResize();
            this.rendererPassState = WebGPUDescriptorCreator.createRendererPassState(view.engine3D.context3D, this._rtFrame, null);
            this.rendererPassState.label = 'SSGI';
        }
        this.bindUpstream(this._marchCompute, 'inTex');
        this.bindUpstream(this._temporalCompute, 'inTex');
        const cfg = this.setting.render.postProcessing.ssgi;
        this._marchSettings.setFloat('radius', cfg.radius);
        this._marchSettings.setFloat('sliceCount', cfg.sliceCount);
        this._marchSettings.setFloat('stepCount', cfg.stepCount);
        this._marchSettings.setFloat('frameIndex', this._frameIndex);
        this._marchSettings.apply();
        this._temporalSettings.setMatrix('preProjMatrix', this._preProjMatrix);
        this._temporalSettings.setMatrix('preViewMatrix', this._preViewMatrix);
        this._temporalSettings.setFloat('intensity', cfg.intensity);
        this._temporalSettings.setFloat('hysteresis', cfg.hysteresis);
        this._temporalSettings.setFloat('frameIndex', this._frameIndex);
        this._temporalSettings.apply();
        this._boundCtx!.gpuContext.computeCommand(command, [this._marchCompute, this._temporalCompute]);
        this._boundCtx!.gpuContext.copyTexture(command, this._historyWrite, this._historyRead);
        this._boundCtx!.gpuContext.lastRenderPassState = this.rendererPassState;
        this._preProjMatrix.copy(view.camera.projectionMatrix);
        this._preViewMatrix.copy(view.camera.viewMatrix);
        this._frameIndex++;
    }

    public onResize() {
        const [w, h] = this._boundCtx!.presentationSize;
        if (this._outTex) {
            this._outTex.resize(w, h);
            this._giTex.resize(w, h);
            this._historyRead.resize(w, h);
            this._historyWrite.resize(w, h);
        }
        for (const compute of [this._marchCompute, this._temporalCompute]) {
            if (compute) {
                compute.workerSizeX = Math.ceil(w / 8);
                compute.workerSizeY = Math.ceil(h / 8);
                compute.workerSizeZ = 1;
            }
        }
    }
}
