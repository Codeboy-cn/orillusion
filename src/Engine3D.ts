import { CanvasConfig } from './gfx/graphics/webGpu/CanvasConfig';
import { Color } from './math/Color';
import { EngineSetting } from './setting/EngineSetting';
import { Time } from './util/Time';
import { InputSystem } from './io/InputSystem';
import { View3D } from './core/View3D';
import { version } from '../package.json';

import { Context3D, SharedGPU, setActiveContext3D } from './gfx/graphics/webGpu/Context3D';
import { RTResourceMap } from './gfx/renderJob/frame/RTResourceMap';

import { ForwardRenderJob } from './gfx/renderJob/jobs/ForwardRenderJob';
import { GlobalBindGroup } from './gfx/graphics/webGpu/core/bindGroups/GlobalBindGroup';
import { Interpolator } from './math/TimeInterpolator';
import { RendererJob } from './gfx/renderJob/jobs/RendererJob';
import { Res } from './assets/Res';
import { ShaderLib } from './assets/shader/ShaderLib';
import { ShaderUtil } from './gfx/graphics/webGpu/shader/util/ShaderUtil';
import { ComponentCollect } from './gfx/renderJob/collect/ComponentCollect';
import { ShadowLightsCollect } from './gfx/renderJob/collect/ShadowLightsCollect';
import { WasmMatrix } from './components/matrix/WasmMatrix';
import { Matrix4 } from './math/Matrix4';
import { FXAAPost } from './gfx/renderJob/post/FXAAPost';
import { PostProcessingComponent } from './components/post/PostProcessingComponent';
import { GBufferFrame } from './gfx/renderJob/frame/GBufferFrame';

/**
 * Orillusion 3D Engine.
 *
 * The engine can be used in two modes:
 *  - Legacy single-instance: call `Engine3D.init()` and the static
 *    methods. A default instance is created under the hood and all
 *    static accessors proxy to it.
 *  - Multi-instance: call `await Engine3D.create({ canvasConfig })`
 *    to obtain an Engine3D instance. Multiple instances share the
 *    WebGPU device but own their own canvas, input system, views,
 *    render jobs and render loop.
 *
 * @group engine3D
 */
export class Engine3D {

    // -------- static facade (default instance) --------
    private static _defaultInstance: Engine3D | null = null;

    /** Engine-level settings. Shared across instances. */
    public static setting: EngineSetting = {
        doublePrecision: false,
        occlusionQuery: { enable: true, debug: false },
        pick: { enable: true, mode: `bound`, detail: `mesh` },
        render: {
            debug: false,
            renderPassState: 4,
            renderState_left: 5,
            renderState_right: 5,
            renderState_split: 0.5,
            quadScale: 1,
            hdrExposure: 1.5,
            debugQuad: -1,
            maxPointLight: 1000,
            maxDirectLight: 4,
            maxSportLight: 1000,
            drawOpMin: 0,
            drawOpMax: Number.MAX_SAFE_INTEGER,
            drawTrMin: 0,
            drawTrMax: Number.MAX_SAFE_INTEGER,
            zPrePass: false,
            useLogDepth: false,
            useCompressGBuffer: false,
            gi: false,
            postProcessing: {
                bloom: {
                    downSampleStep: 3,
                    downSampleBlurSize: 9,
                    downSampleBlurSigma: 1.0,
                    upSampleBlurSize: 9,
                    upSampleBlurSigma: 1.0,
                    luminanceThreshole: 1.0,
                    bloomIntensity: 1.0,
                    hdr: 1.0
                },
                globalFog: {
                    debug: false,
                    enable: false,
                    fogType: 0.0,
                    fogHeightScale: 0.1,
                    start: 400,
                    end: 10,
                    density: 0.02,
                    ins: 0.5,
                    skyFactor: 0.5,
                    skyRoughness: 0.4,
                    overrideSkyFactor: 0.8,
                    fogColor: new Color(96 / 255, 117 / 255, 133 / 255, 1),
                    falloff: 0.7,
                    rayLength: 200.0,
                    scatteringExponent: 2.7,
                    dirHeightLine: 10.0,
                },
                godRay: {
                    blendColor: true,
                    rayMarchCount: 16,
                    scatteringExponent: 5,
                    intensity: 0.5
                },
                ssao: { enable: false, radius: 0.15, bias: -0.1, aoPower: 2.0, debug: true },
                outline: { enable: false, strength: 1, groupCount: 4, outlinePixel: 2, fadeOutlinePixel: 4, textureScale: 1, useAddMode: false, debug: true },
                taa: { enable: false, jitterSeedCount: 8, blendFactor: 0.1, sharpFactor: 0.6, sharpPreBlurFactor: 0.5, temporalJitterScale: 0.13, debug: true },
                gtao: { enable: false, darkFactor: 1.0, maxDistance: 5.0, maxPixel: 50.0, rayMarchSegment: 6, multiBounce: false, usePosFloat32: true, blendColor: true, debug: true },
                ssr: { enable: false, pixelRatio: 1, fadeEdgeRatio: 0.2, rayMarchRatio: 0.5, fadeDistanceMin: 600, fadeDistanceMax: 2000, roughnessThreshold: 0.5, powDotRN: 0.2, mixThreshold: 0.1, debug: true },
                fxaa: { enable: false },
                depthOfView: { enable: false, iterationCount: 3, pixelOffset: 1.0, near: 150, far: 300 },
            },
        },
        shadow: {
            enable: true, type: 'HARD', pointShadowBias: 0.0005, shadowSize: 2048, pointShadowSize: 1024,
            shadowSoft: 0.005, shadowBound: 100, shadowBias: 0.05, needUpdate: true, autoUpdate: true,
            updateFrameRate: 2, csmMargin: 0.1, csmScatteringExp: 0.7, csmAreaScale: 0.4, debug: false,
        },
        gi: {
            enable: false, offsetX: 0, offsetY: 0, offsetZ: 0, probeSpace: 64, probeXCount: 4, probeYCount: 2,
            probeZCount: 4, probeSize: 32, probeSourceTextureSize: 2048, octRTMaxSize: 2048, octRTSideSize: 16,
            maxDistance: 64 * 1.73, normalBias: 0.25, depthSharpness: 1, hysteresis: 0.98, lerpHysteresis: 0.01,
            irradianceChebyshevBias: 0.01, rayNumber: 144, irradianceDistanceBias: 32, indirectIntensity: 1.0,
            ddgiGamma: 2.2, bounceIntensity: 0.025, probeRoughness: 1, realTimeGI: false, debug: false, autoRenderProbe: false,
        },
        sky: { type: 'HDRSKY', sky: null, skyExposure: 1.0, defaultFar: 65536, defaultNear: 1 },
        light: { maxLight: 4096 },
        material: { materialChannelDebug: false, materialDebug: false },
        loader: { numConcurrent: 20 },
        reflectionSetting: { reflectionProbeMaxCount: 8, reflectionProbeSize: 256, width: 256 * 6, height: 8 * 256, enable: true }
    };

    /** Shared resource manager (initialized lazily). */
    public static res: Res;

    /** All registered engine instances (for the shared render loop). */
    private static _instances: Set<Engine3D> = new Set();

    private static _sharedInit: boolean = false;

    private static _rafId: number = 0;
    private static _time: number = 0;

    // -------- instance fields --------
    public readonly context3D: Context3D;
    public readonly id: number;
    public views: View3D[] = [];
    public renderJobs: Map<View3D, RendererJob> = new Map();
    public inputSystem: InputSystem;
    public running: boolean = false;

    private _frameRateValue: number = 0;
    private _frameRate: number = 360;
    private _beforeRender: Function | null = null;
    private _renderLoop: Function | null = null;
    private _lateRender: Function | null = null;
    /** Number of frames this instance has rendered since start. */
    public frameCount: number = 0;

    private static _nextId: number = 0;

    constructor() {
        this.id = ++Engine3D._nextId;
        this.context3D = new Context3D();
    }

    // -------- static legacy API --------

    /**
     * Pick the default instance used by the legacy static API.
     * Created lazily by `Engine3D.init()` and used by callers that
     * still read static fields such as `Engine3D.views` or
     * `Engine3D.inputSystem`.
     */
    public static getDefault(): Engine3D {
        if (!this._defaultInstance) this._defaultInstance = new Engine3D();
        return this._defaultInstance;
    }

    public static get views(): View3D[] { return this.getDefault().views; }
    public static set views(v: View3D[]) { this.getDefault().views = v; }
    public static get renderJobs(): Map<View3D, RendererJob> { return this.getDefault().renderJobs; }
    public static get inputSystem(): InputSystem { return this.getDefault().inputSystem; }
    public static set inputSystem(v: InputSystem) { this.getDefault().inputSystem = v; }

    public static get frameRate(): number { return this.getDefault().frameRate; }
    public static set frameRate(value: number) { this.getDefault().frameRate = value; }

    public static get size(): number[] { return this.getDefault().context3D.presentationSize; }
    public static get aspect(): number { return this.getDefault().context3D.aspect; }
    public static get width(): number { return this.getDefault().context3D.windowWidth; }
    public static get height(): number { return this.getDefault().context3D.windowHeight; }

    /** Legacy single-instance init. Creates (or re-uses) the default instance. */
    public static async init(descriptor: { canvasConfig?: CanvasConfig; beforeRender?: Function; renderLoop?: Function; lateRender?: Function, engineSetting?: EngineSetting } = {}) {
        let inst = this.getDefault();
        await Engine3D._initSharedSubsystems(descriptor.engineSetting);
        await inst._initInstance(descriptor);
        return;
    }

    /** Multi-instance factory. Each returned engine owns its own canvas & render loop. */
    public static async create(descriptor: { canvasConfig?: CanvasConfig; beforeRender?: Function; renderLoop?: Function; lateRender?: Function, engineSetting?: EngineSetting } = {}): Promise<Engine3D> {
        await Engine3D._initSharedSubsystems(descriptor.engineSetting);
        let inst = new Engine3D();
        await inst._initInstance(descriptor);
        return inst;
    }

    /** Initialize shared cross-instance subsystems (WebGPU device, shader lib, etc.). Idempotent. */
    private static async _initSharedSubsystems(settingOverride?: EngineSetting) {
        if (settingOverride) this.setting = { ...this.setting, ...settingOverride };
        if (this._sharedInit) return;
        console.log('Engine Version', version);
        if (!window.isSecureContext) {
            console.warn('WebGPU is only supported in secure contexts (HTTPS or localhost)');
        }
        await WasmMatrix.init(Matrix4.allocCount, this.setting.doublePrecision);
        await SharedGPU.init();
        this.setting.reflectionSetting.width = this.setting.reflectionSetting.reflectionProbeSize * 6;
        this.setting.reflectionSetting.height = this.setting.reflectionSetting.reflectionProbeSize * this.setting.reflectionSetting.reflectionProbeMaxCount;
        ShaderLib.init();
        ShaderUtil.init();
        GlobalBindGroup.init();
        ShadowLightsCollect.init();
        this.res = new Res();
        this.res.initDefault();
        this._sharedInit = true;
    }

    // -------- instance methods --------

    private async _initInstance(descriptor: { canvasConfig?: CanvasConfig; beforeRender?: Function; renderLoop?: Function; lateRender?: Function }) {
        setActiveContext3D(this.context3D);
        await this.context3D.init(descriptor.canvasConfig);

        // Instance-local resource registries.
        RTResourceMap.init();

        // Pre-compute reflection GBuffer (scoped to this engine's context).
        GBufferFrame.getGBufferFrame(
            GBufferFrame.reflections_GBuffer,
            Engine3D.setting.reflectionSetting.width,
            Engine3D.setting.reflectionSetting.height,
            false
        );

        this._beforeRender = descriptor.beforeRender ?? null;
        this._renderLoop = descriptor.renderLoop ?? null;
        this._lateRender = descriptor.lateRender ?? null;
        this.inputSystem = new InputSystem();
        this.inputSystem.initCanvas(this.context3D.canvas);

        Engine3D._instances.add(this);
    }

    public get frameRate(): number { return this._frameRate; }
    public set frameRate(value: number) {
        this._frameRate = value;
        this._frameRateValue = 1000 / value;
        if (value >= 360) this._frameRateValue = 0;
    }

    public dispose() {
        Engine3D._instances.delete(this);
        this.views = [];
        this.renderJobs.clear();
    }

    // -------- render view setup --------

    private _startRenderJob(view: View3D): RendererJob {
        setActiveContext3D(this.context3D);
        view.engine3D = this;
        let renderJob = new ForwardRenderJob(view);
        this.renderJobs.set(view, renderJob);

        if (Engine3D.setting.pick.mode == `pixel`) {
            let postProcessing = view.scene.getOrAddComponent(PostProcessingComponent);
            postProcessing.addPost(FXAAPost);
        }
        if (Engine3D.setting.pick.mode == `pixel` || Engine3D.setting.pick.mode == `bound`) {
            view.enablePick = true;
        }
        return renderJob;
    }

    public startView(view: View3D): RendererJob {
        this.views = [view];
        let job = this._startRenderJob(view);
        Engine3D._ensureLoop();
        return job;
    }

    public startViews(views: View3D[]) {
        this.views = views;
        for (let v of views) this._startRenderJob(v);
        Engine3D._ensureLoop();
    }

    public getRenderJobOf(view: View3D): RendererJob {
        return this.renderJobs.get(view);
    }

    // -------- legacy static render-start methods --------

    public static startRenderView(view: View3D) {
        return this.getDefault().startView(view);
    }

    public static startRenderViews(views: View3D[]) {
        this.getDefault().startViews(views);
    }

    public static getRenderJob(view: View3D): RendererJob {
        // Multi-instance: first try the engine that owns this view.
        const owner = (view as any)?.engine3D as Engine3D | undefined;
        if (owner) {
            const job = owner.renderJobs.get(view);
            if (job) return job;
        }
        // Fall back to scanning every registered engine.
        for (const eng of Engine3D._instances) {
            const job = eng.renderJobs.get(view);
            if (job) return job;
        }
        return this.getDefault().renderJobs.get(view);
    }

    public static pause() {
        if (this._rafId !== 0) {
            cancelAnimationFrame(this._rafId);
            this._rafId = 0;
        }
    }

    public static resume() {
        Engine3D._ensureLoop();
    }

    // -------- shared render loop --------

    private static _ensureLoop() {
        if (this._rafId === 0) {
            this._rafId = requestAnimationFrame((t) => this._tick(t));
        }
    }

    private static async _tick(time: number) {
        // Gate on the smallest desired frame interval across instances.
        let minGate = 0;
        for (let inst of this._instances) {
            if (inst._frameRateValue > 0 && (minGate === 0 || inst._frameRateValue < minGate)) {
                minGate = inst._frameRateValue;
            }
        }
        if (minGate > 0) {
            let delta = time - this._time;
            if (delta < minGate) {
                let t = performance.now();
                await new Promise(res => setTimeout(() => {
                    time += (performance.now() - t);
                    res(true);
                }, minGate - delta));
            }
            this._time = time;
        }

        // Advance global time once per composite frame.
        Time.delta = time - Time.time;
        Time.time = time;
        Time.frame += 1;
        Interpolator.tick(Time.delta);

        for (let inst of this._instances) {
            await inst._renderOnce(time);
        }

        this._rafId = 0;
        this._ensureLoop();
    }

    private async _renderOnce(_time: number) {
        setActiveContext3D(this.context3D);
        this.frameCount++;

        let views = this.views;
        let ctxSize = this.context3D.presentationSize;
        for (let i = 0; i < views.length; i++) {
            const view = views[i];
            view.scene.waitUpdate();
            view.camera.viewPort.setTo(0, 0, ctxSize[0], ctxSize[1]);
        }

        if (this._beforeRender) await this._beforeRender();

        // Per-view component updates (filter by the views owned by this engine).
        const viewSet = new Set(views);
        const runViewMap = (src: Map<View3D, Map<any, Function>> | undefined) => {
            if (!src) return;
            for (const [k, v] of src) {
                if (!viewSet.has(k)) continue;
                for (const [comp, cb] of v) {
                    if (comp.enable) cb(k);
                }
            }
        };

        runViewMap(ComponentCollect.componentsBeforeUpdateList);

        let command = this.context3D.device.createCommandEncoder();
        if (ComponentCollect.componentsComputeList) {
            for (const [k, v] of ComponentCollect.componentsComputeList) {
                if (!viewSet.has(k)) continue;
                for (const [comp, cb] of v) {
                    if (comp.enable) cb(k, command);
                }
            }
        }
        this.context3D.device.queue.submit([command.finish()]);

        runViewMap(ComponentCollect.componentsUpdateList);

        if (ComponentCollect.graphicComponent) {
            for (const [k, v] of ComponentCollect.graphicComponent) {
                if (!viewSet.has(k)) continue;
                for (const [comp, cb] of v) {
                    if (k && comp.enable) cb(k);
                }
            }
        }

        if (this._renderLoop) await this._renderLoop();

        WasmMatrix.updateAllContinueTransform(0, Matrix4.useCount, 16);
        let globalMatrixBindGroup = GlobalBindGroup.modelMatrixBindGroup;
        globalMatrixBindGroup.writeBuffer(Matrix4.useCount * 16);

        this.renderJobs.forEach((v) => {
            if (!v.renderState) v.start();
            v.renderFrame();
        });

        runViewMap(ComponentCollect.componentsLateUpdateList);

        if (this._lateRender) await this._lateRender();
    }
}
