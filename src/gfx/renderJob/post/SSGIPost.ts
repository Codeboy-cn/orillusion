import { SSGI_cs } from '../../../assets/shader/compute/SSGI_cs';
import { SSGITemporal_cs } from '../../../assets/shader/compute/SSGITemporal_cs';
import { ShaderLib } from '../../../assets/shader/ShaderLib';
import { View3D } from '../../../core/View3D';
import { clamp } from '../../../math/MathUtil';
import { Matrix4 } from '../../../math/Matrix4';
import { VirtualTexture } from '../../../textures/VirtualTexture';
import { Texture } from '../../graphics/webGpu/core/texture/Texture';
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
 * Screen-space global illumination.
 *
 * Two compute passes per frame:
 *  1. march (SSGI_cs): per-slice horizon walks over the scene color,
 *     sector occupancy tracked in a 32-bit bitfield — a noisy
 *     single-frame estimate of indirect radiance plus visibility (AO).
 *  2. resolve (SSGITemporal_cs): reprojected, depth-validated temporal
 *     EMA over the estimates (the TRAA stage of the reference),
 *     composited as sceneColor * visibility + albedo * gi.
 *
 * Add to scene: `view.scene.addComponent(PostProcessingComponent).addPost(SSGIPost)`.
 * Tuning lives in `engine.setting.render.postProcessing.ssgi`.
 *
 * @group Post Effects
 */
export class SSGIPost extends PostBase {
    private _outTex: VirtualTexture;
    private _giTex: VirtualTexture;
    private _keyTex: VirtualTexture;
    // History double buffers with single-role usages: the resolve pass
    // samples the read textures and writes the write textures; the frame
    // ends with write->read copies.
    private _historyRead: VirtualTexture;
    private _historyWrite: VirtualTexture;
    private _historyKeyRead: VirtualTexture;
    private _historyKeyWrite: VirtualTexture;
    private _marchCompute: ComputeShader;
    private _temporalCompute: ComputeShader;
    private _marchSettings: UniformGPUBuffer;
    private _temporalSettings: UniformGPUBuffer;
    private _rtFrame: RTFrame;
    private _sceneColorTex: Texture;
    private _preProjMatrix: Matrix4 = new Matrix4();
    private _preViewMatrix: Matrix4 = new Matrix4();
    private _frameIndex: number = 0;

    // From the Activision GTAO paper: per-frame slice rotations and ray
    // start offsets, cycled so the temporal EMA integrates the full
    // sampling domain.
    private static readonly _temporalRotations = [60, 300, 180, 240, 120, 0];
    private static readonly _spatialOffsets = [0, 0.5, 0.25, 0.75];

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

    /** Power curve applied to the visibility (AO) term; 0 disables AO. */
    public get aoIntensity() {
        return this.setting.render.postProcessing.ssgi.aoIntensity;
    }

    public set aoIntensity(value: number) {
        this.setting.render.postProcessing.ssgi.aoIntensity = clamp(value, 0, 4);
    }

    /** Strength of the indirect diffuse term. */
    public get giIntensity() {
        return this.setting.render.postProcessing.ssgi.giIntensity;
    }

    public set giIntensity(value: number) {
        this.setting.render.postProcessing.ssgi.giIntensity = clamp(value, 0, 100);
    }

    /** Gather radius: world units, or screen proportion when
     *  useScreenSpaceSampling is on. */
    public get radius() {
        return this.setting.render.postProcessing.ssgi.radius;
    }

    public set radius(value: number) {
        this.setting.render.postProcessing.ssgi.radius = clamp(value, 0.1, 100);
    }

    /** Hemisphere slices per pixel (1..4). */
    public get sliceCount() {
        return this.setting.render.postProcessing.ssgi.sliceCount;
    }

    public set sliceCount(value: number) {
        this.setting.render.postProcessing.ssgi.sliceCount = clamp(Math.round(value), 1, 4);
    }

    /** March steps along each side of a slice (1..32). */
    public get stepCount() {
        return this.setting.render.postProcessing.ssgi.stepCount;
    }

    public set stepCount(value: number) {
        this.setting.render.postProcessing.ssgi.stepCount = clamp(Math.round(value), 1, 32);
    }

    /** Step distribution exponent (1 = uniform, higher = denser near). */
    public get expFactor() {
        return this.setting.render.postProcessing.ssgi.expFactor;
    }

    public set expFactor(value: number) {
        this.setting.render.postProcessing.ssgi.expFactor = clamp(value, 1, 3);
    }

    /** Assumed surface thickness in world units. */
    public get thickness() {
        return this.setting.render.postProcessing.ssgi.thickness;
    }

    public set thickness(value: number) {
        this.setting.render.postProcessing.ssgi.thickness = clamp(value, 0.01, 10);
    }

    /** Fraction of light emitted by back-facing surfaces (0..1). */
    public get backfaceLighting() {
        return this.setting.render.postProcessing.ssgi.backfaceLighting;
    }

    public set backfaceLighting(value: number) {
        this.setting.render.postProcessing.ssgi.backfaceLighting = clamp(value, 0, 1);
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
        this._keyTex = new VirtualTexture(w, h, GPUTextureFormat.r32float, false,
            GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING, 1, 0, 1, this._boundCtx!);
        this._keyTex.name = 'SSGIDepthKey';
        // Fresh textures are zero-initialized; a zero depth key marks
        // the history invalid, so no explicit clear is needed.
        this._historyRead = new VirtualTexture(w, h, GPUTextureFormat.rgba16float, false,
            GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST, 1, 0, 1, this._boundCtx!);
        this._historyRead.name = 'SSGIHistoryRead';
        this._historyWrite = new VirtualTexture(w, h, GPUTextureFormat.rgba16float, false,
            GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC, 1, 0, 1, this._boundCtx!);
        this._historyWrite.name = 'SSGIHistoryWrite';
        this._historyKeyRead = new VirtualTexture(w, h, GPUTextureFormat.r32float, false,
            GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST, 1, 0, 1, this._boundCtx!);
        this._historyKeyRead.name = 'SSGIHistoryKeyRead';
        this._historyKeyWrite = new VirtualTexture(w, h, GPUTextureFormat.r32float, false,
            GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC, 1, 0, 1, this._boundCtx!);
        this._historyKeyWrite.name = 'SSGIHistoryKeyWrite';
        const desc = new RTDescriptor(); desc.loadOp = 'load';
        this._rtFrame = new RTFrame([this._outTex], [desc]);
    }

    private _createCompute(view: View3D) {
        ShaderLib.register('SSGI_cs', SSGI_cs);
        ShaderLib.register('SSGITemporal_cs', SSGITemporal_cs);
        const rtFrame = GBufferFrame.getGBufferFrame(GBufferFrame.colorPass_GBuffer, view.engine3D.context3D);
        const gBufferTex = rtFrame.getCompressGBufferTexture();
        const cameraGroup = GlobalBindGroup.getCameraGroup(view.camera);

        // Reference behavior: the
        // gather reads the raw linear beauty pass, not the FXAA'd chain
        // cursor — bind the ColorPass scene color directly.
        this._sceneColorTex = rtFrame.getColorTexture();

        this._marchCompute = new ComputeShader(SSGI_cs);
        this._marchSettings = new UniformGPUBuffer(16);
        this._marchCompute.setUniformBuffer('ssgiSettings', this._marchSettings);
        this._marchCompute.setSamplerTexture('gBufferTexture', gBufferTex);
        this._marchCompute.setSamplerTexture('inTex', this._sceneColorTex);
        this._marchCompute.setStorageTexture('giTex', this._giTex);
        this._marchCompute.setStorageTexture('keyTex', this._keyTex);
        this._marchCompute.setUniformBuffer('globalUniform', cameraGroup.uniformGPUBuffer);

        this._temporalCompute = new ComputeShader(SSGITemporal_cs);
        this._temporalSettings = new UniformGPUBuffer(16 * 2 + 4);
        this._temporalCompute.setUniformBuffer('temporalSettings', this._temporalSettings);
        this._temporalCompute.setSamplerTexture('gBufferTexture', gBufferTex);
        this._temporalCompute.setSamplerTexture('inTex', this._sceneColorTex);
        this._temporalCompute.setStorageTexture('outTex', this._outTex);
        this._temporalCompute.setSamplerTexture('giTex', this._giTex);
        this._temporalCompute.setSamplerTexture('keyTex', this._keyTex);
        this._temporalCompute.setSamplerTexture('historyTex', this._historyRead);
        this._temporalCompute.setSamplerTexture('historyKeyTex', this._historyKeyRead);
        this._temporalCompute.setStorageTexture('historyOut', this._historyWrite);
        this._temporalCompute.setStorageTexture('historyKeyOut', this._historyKeyWrite);
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
        const cfg = this.setting.render.postProcessing.ssgi;

        // Reference behavior: cycle the sampling pattern only when the
        // temporal filter is on; otherwise keep it static.
        const temporalOn = cfg.hysteresis > 0;
        const temporalDirection = temporalOn
            ? SSGIPost._temporalRotations[this._frameIndex % 6] / 360 : 1;
        const temporalOffset = temporalOn
            ? SSGIPost._spatialOffsets[this._frameIndex % 4] : 1;
        const [, h] = this._boundCtx!.presentationSize;
        const halfProjScale = h / (Math.tan(view.camera.fov * Math.PI / 180 * 0.5) * 2) * 0.5;

        this._marchSettings.setFloat('radius', cfg.radius);
        this._marchSettings.setFloat('sliceCount', cfg.sliceCount);
        this._marchSettings.setFloat('stepCount', cfg.stepCount);
        this._marchSettings.setFloat('expFactor', cfg.expFactor);
        this._marchSettings.setFloat('thickness', cfg.thickness);
        this._marchSettings.setFloat('backfaceLighting', cfg.backfaceLighting);
        this._marchSettings.setFloat('aoIntensity', cfg.aoIntensity);
        this._marchSettings.setFloat('giIntensity', cfg.giIntensity);
        this._marchSettings.setFloat('temporalDirection', temporalDirection);
        this._marchSettings.setFloat('temporalOffset', temporalOffset);
        this._marchSettings.setFloat('halfProjScale', halfProjScale);
        this._marchSettings.setFloat('useScreenSpaceSampling', cfg.useScreenSpaceSampling ? 1 : 0);
        this._marchSettings.setFloat('useLinearThickness', cfg.useLinearThickness ? 1 : 0);
        this._marchSettings.setFloat('frameIndex', this._frameIndex);
        this._marchSettings.apply();

        this._temporalSettings.setMatrix('preProjMatrix', this._preProjMatrix);
        this._temporalSettings.setMatrix('preViewMatrix', this._preViewMatrix);
        this._temporalSettings.setFloat('hysteresis', cfg.hysteresis);
        this._temporalSettings.setFloat('frameIndex', this._frameIndex);
        this._temporalSettings.apply();

        this._boundCtx!.gpuContext.computeCommand(command, [this._marchCompute, this._temporalCompute]);
        this._boundCtx!.gpuContext.copyTexture(command, this._historyWrite, this._historyRead);
        this._boundCtx!.gpuContext.copyTexture(command, this._historyKeyWrite, this._historyKeyRead);
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
            this._keyTex.resize(w, h);
            this._historyRead.resize(w, h);
            this._historyWrite.resize(w, h);
            this._historyKeyRead.resize(w, h);
            this._historyKeyWrite.resize(w, h);
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
