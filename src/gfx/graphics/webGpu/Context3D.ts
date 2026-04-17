import { CEvent, Texture } from '../../..';
import { CEventDispatcher } from '../../../event/CEventDispatcher';
import { CResizeEvent } from '../../../event/CResizeEvent';
import { CanvasConfig } from './CanvasConfig';

/**
 * Per-instance WebGPU device/context. Each Engine3D instance owns its
 * own Context3D with a dedicated GPUAdapter, GPUDevice, canvas and
 * GPUCanvasContext. Devices are fully isolated — no GPU resource
 * (texture, buffer, pipeline, layout) can be shared across contexts.
 *
 * Code that needs to create GPU resources reads `webGPUContext.device`,
 * which is an ES-module `let` binding swapped to the currently-active
 * Context3D by `setActiveContext3D()` before each engine renders. All
 * device-bound static caches are keyed by Context3D (see
 * `perContextResource()` in this module).
 * @internal
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
        const resizeObserver = new ResizeObserver(() => {
            this.updateSize();
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
 * Active Context3D. Most engine code reads `webGPUContext.canvas`,
 * `.context`, `.presentationSize`, `.device` etc. Before rendering a
 * specific engine, call `setActiveContext3D(engine.context3D)` so these
 * references point at the right device.
 * @internal
 */
export let webGPUContext: Context3D = new Context3D();

export function setActiveContext3D(ctx: Context3D): void {
    webGPUContext = ctx;
}

export function getActiveContext3D(): Context3D {
    return webGPUContext;
}

/**
 * Helper for device-bound static caches: store one factory-created value
 * per Context3D. Call like:
 *   private static _cache = perContextResource<MyThing>();
 *   static get(): MyThing { return this._cache(() => new MyThing()); }
 * Each engine's device sees its own cached instance.
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

/** Backwards-compat shim: tests/old samples may import SharedGPU. */
export class SharedGPU {
    public static get adapter(): GPUAdapter { return webGPUContext.adapter; }
    public static get device(): GPUDevice { return webGPUContext.device; }
    public static get presentationFormat(): GPUTextureFormat { return webGPUContext.presentationFormat; }
    /** No-op — devices are now per Context3D. Kept for API compatibility. */
    public static async init(): Promise<void> { /* intentional */ }
}
