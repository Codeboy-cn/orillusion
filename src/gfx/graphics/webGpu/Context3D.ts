import { CEvent, Texture } from '../../..';
import { CEventDispatcher } from '../../../event/CEventDispatcher';
import { CResizeEvent } from '../../../event/CResizeEvent';
import { CanvasConfig } from './CanvasConfig';

/**
 * Shared WebGPU device state across Engine3D instances.
 * Device / adapter / format are obtained once and reused; each engine
 * keeps its own Context3D with a dedicated canvas + GPUCanvasContext.
 * @internal
 */
export class SharedGPU {
    public static adapter: GPUAdapter;
    public static device: GPUDevice;
    public static presentationFormat: GPUTextureFormat;
    private static _initPromise: Promise<void>;

    public static async init(): Promise<void> {
        if (this.device) return;
        if (this._initPromise) return this._initPromise;
        this._initPromise = (async () => {
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
            this.device.label = 'device';
            this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        })();
        return this._initPromise;
    }
}

/**
 * Per-instance WebGPU canvas context. Device/adapter/format are read
 * from SharedGPU; canvas / GPUCanvasContext / size are owned by the
 * instance.
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

    public get pixelRatio() { return this._pixelRatio; }

    public get adapter(): GPUAdapter { return SharedGPU.adapter; }
    public get device(): GPUDevice { return SharedGPU.device; }
    public get presentationFormat(): GPUTextureFormat { return SharedGPU.presentationFormat; }

    async init(canvasConfig?: CanvasConfig): Promise<boolean> {
        await SharedGPU.init();
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
            device: SharedGPU.device,
            format: SharedGPU.presentationFormat,
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
}

/**
 * Active Context3D. Most engine code reads `webGPUContext.canvas`,
 * `.context`, `.presentationSize`, `.device` etc. Before rendering a
 * specific engine, call `setActiveContext3D(engine.context3D)` so these
 * references point at the right canvas.
 * @internal
 */
export let webGPUContext: Context3D = new Context3D();

export function setActiveContext3D(ctx: Context3D): void {
    webGPUContext = ctx;
}

export function getActiveContext3D(): Context3D {
    return webGPUContext;
}
