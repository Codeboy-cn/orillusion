import { CEvent } from '../../../event/CEvent';
import { CEventDispatcher } from '../../../event/CEventDispatcher';
import { CResizeEvent } from '../../../event/CResizeEvent';
import { CanvasConfig } from './CanvasConfig';

/**
 * Per-instance WebGPU device/context. Each Engine3D instance owns its
 * own Context3D with a dedicated GPUAdapter, GPUDevice, canvas and
 * GPUCanvasContext. Devices are fully isolated — no GPU resource
 * (texture, buffer, pipeline, layout) can be shared across contexts.
 *
 * Every GPU-bearing object in the scene graph (Texture, Material,
 * Geometry, GPUBuffer, RenderShaderPass, ComputeShader, ...) binds to
 * exactly one Context3D on first render and holds it in `_boundCtx`.
 * Attempting to render the same object under a different Context3D
 * throws — users must `.clone()` CPU data to share across engines.
 *
 * @group GFX
 */
export class Context3D extends CEventDispatcher {
    public aspect: number;
    public presentationSize: number[] = [0, 0];
    public canvas: HTMLCanvasElement;
    public context: GPUCanvasContext;
    public windowWidth: number;
    public windowHeight: number;
    public canvasConfig: CanvasConfig;
    private _pixelRatio: number = 1.0;
    private _resizeEvent: CEvent;

    public adapter: GPUAdapter;
    public device: GPUDevice;
    public presentationFormat: GPUTextureFormat;

    public get pixelRatio() { return this._pixelRatio; }

    async init(canvasConfig?: CanvasConfig): Promise<boolean> {
        if (navigator.gpu === undefined) throw new Error('Your browser does not support WebGPU!');
        this.adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!this.adapter) throw new Error('Your browser does not support WebGPU!');
        this.device = await this.adapter.requestDevice({
            requiredFeatures: [
                'bgra8unorm-storage',
                'depth-clip-control',
                'depth32float-stencil8',
                'indirect-first-instance',
                'rg11b10ufloat-renderable',
            ],
            requiredLimits: {
                minUniformBufferOffsetAlignment: 256,
                maxStorageBufferBindingSize: this.adapter.limits.maxStorageBufferBindingSize
            }
        });
        if (!this.device) throw new Error('Your browser does not support WebGPU!');
        this.device.label = `device-${Context3D._nextLabel++}`;
        this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();

        this.canvasConfig = canvasConfig;
        if (canvasConfig && canvasConfig.canvas) {
            this.canvas = canvasConfig.canvas;
            if (this.canvas === null) throw new Error('no Canvas');
            if (!this.canvas.style.width) this.canvas.style.width = this.canvas.width + 'px';
            if (!this.canvas.style.height) this.canvas.style.height = this.canvas.height + 'px';
        } else {
            this.canvas = document.createElement('canvas');
            this.canvas.style.position = `absolute`;
            this.canvas.style.top = '0px';
            this.canvas.style.left = '0px';
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            this.canvas.style.zIndex = canvasConfig?.zIndex ? canvasConfig.zIndex.toString() : '0';
            document.body.appendChild(this.canvas);
        }

        if (canvasConfig && canvasConfig.backgroundImage) {
            this.canvas.style.background = `url(${canvasConfig.backgroundImage})`;
            this.canvas.style['background-size'] = 'cover';
            this.canvas.style['background-position'] = 'center';
        } else {
            this.canvas.style.background = 'transparent';
        }

        this.canvas.style['touch-action'] = 'none';
        this.canvas.style['object-fit'] = 'cover';

        this.context = this.canvas.getContext('webgpu');
        this.context.configure({
            device: this.device,
            format: this.presentationFormat,
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            alphaMode: 'premultiplied',
            colorSpace: `srgb`
        });

        this._resizeEvent = new CResizeEvent(CResizeEvent.RESIZE, { width: this.windowWidth, height: this.windowHeight });
        // Lazy require to avoid circular import at module load.
        const resizeObserver = new ResizeObserver(async () => {
            this.updateSize();
            const { Texture } = await import('./core/texture/Texture');
            Texture.destroyTexture();
        });

        resizeObserver.observe(this.canvas);
        this.updateSize();
        return true;
    }

    public updateSize() {
        this._pixelRatio = this.canvasConfig?.devicePixelRatio || window.devicePixelRatio || 1;
        this._pixelRatio = Math.min(this._pixelRatio, 2.0);
        let w = Math.floor(this.canvas.clientWidth * this._pixelRatio);
        let h = Math.floor(this.canvas.clientHeight * this._pixelRatio);
        if (w != this.windowWidth || h != this.windowHeight) {
            this.canvas.width = this.windowWidth = w;
            this.canvas.height = this.windowHeight = h;
            this.presentationSize[0] = this.windowWidth;
            this.presentationSize[1] = this.windowHeight;
            this.aspect = this.windowWidth / this.windowHeight;
            this._resizeEvent.data.width = this.windowWidth;
            this._resizeEvent.data.height = this.windowHeight;
            this.dispatchEvent(this._resizeEvent);
        }
    }

    private static _nextLabel: number = 0;
}

/**
 * @deprecated Migration shim. Points at the most-recently-active Context3D.
 * In Plan-B, GPU-bearing objects should hold `_boundCtx` and use
 * `bindCtx(this, ctx)` instead of reading this global. This shim exists
 * only so that the file-by-file migration does not require a single
 * big-bang commit. DO NOT use in new code.
 * @internal
 */
export let webGPUContext: Context3D = new Context3D();

/**
 * @deprecated Migration shim. Use explicit `ctx` params threaded through
 * the render call chain; use `bindCtx(this, ctx)` on GPU-bearing objects.
 * @internal
 */
export function setActiveContext3D(ctx: Context3D): void {
    webGPUContext = ctx;
}

/**
 * @deprecated Migration shim. Prefer explicit ctx threading.
 * @internal
 */
export function getActiveContext3D(): Context3D {
    return webGPUContext;
}

/**
 * @deprecated Migration shim. Old per-context cache helper.
 * In Plan-B, each GPU-bearing object has a single-field GPU resource
 * tied to its `_boundCtx`; this factory is no longer needed.
 * @internal
 */
export function perContextResource<T>(): (factory: () => T, ctx?: Context3D) => T {
    const store = new WeakMap<Context3D, T>();
    return (factory: () => T, ctx: Context3D = webGPUContext): T => {
        let v = store.get(ctx);
        if (v === undefined) {
            v = factory();
            store.set(ctx, v);
        }
        return v;
    };
}

/**
 * Bind a GPU-bearing object to a Context3D on first use. Idempotent for
 * the same ctx; throws if called with a different ctx than the one this
 * object was first bound to.
 *
 * Plan-B contract: each GPU-bearing resource (Texture / Material /
 * Geometry / GPUBuffer / Shader / Pass) may only be used by a single
 * Engine3D. To share across engines, users must clone CPU data.
 *
 * @internal
 */
export function bindCtx(owner: { _boundCtx: Context3D | null }, ctx: Context3D): Context3D {
    if (owner._boundCtx === ctx) return ctx;
    if (owner._boundCtx && owner._boundCtx !== ctx) {
        throw new Error(
            `GPU resource already bound to a different Engine3D. ` +
            `Each GPU-bearing resource may only be used by one engine. ` +
            `Clone the CPU data to share across engines.`
        );
    }
    owner._boundCtx = ctx;
    return ctx;
}

/**
 * @deprecated Migration shim. Old static facade for shared GPU access.
 * Use `engine.context3D` / `this._boundCtx` instead.
 * @internal
 */
export class SharedGPU {
    public static get adapter(): GPUAdapter { return webGPUContext.adapter; }
    public static get device(): GPUDevice { return webGPUContext.device; }
    public static get presentationFormat(): GPUTextureFormat { return webGPUContext.presentationFormat; }
    public static async init(): Promise<void> { /* no-op */ }
}
