import { CResizeEvent } from '../event/CResizeEvent';
import { Camera3D } from './Camera3D';
import { CameraType } from './CameraType';
import { Object3D } from './entities/Object3D';
import { Scene3D } from './Scene3D';
import { View3D } from './View3D';

/**
 * Orthographic camera sized to the canvas with a top-left origin, suited for
 * screen-space overlays (HUDs, health bars, mini-maps). Attach to an overlay
 * View3D via `engine.addOverlayView(view)` or build the whole pipeline with
 * `view.createOverlayCamera()`.
 *
 * The projection is regenerated automatically on `CResizeEvent.RESIZE` so the
 * pixel mapping stays 1:1 with the canvas.
 *
 * Coordinate convention: X right, Y down, origin (0,0) at top-left.
 *
 * @group Core
 */
export class OverlayCamera extends Camera3D {
    /** Render order among overlay views. Lower renders first (further back). */
    public priority: number = 100;

    /** If false, the overlay pass preserves the color buffer (default). */
    public clearColor: boolean = false;

    /** Overlay child scene owned by this camera. Sprites added via `attach` go here. */
    public readonly overlayScene: Scene3D;

    private _ownerView: View3D | null = null;
    private _overlayResizeAttached: boolean = false;

    constructor(view?: View3D) {
        super();
        this.overlayScene = new Scene3D();
        if (view) this.attachToView(view);
    }

    /** Wire this camera to an overlay View3D. Sets up resize tracking. */
    public attachToView(view: View3D) {
        this._ownerView = view;
        const ctx = view.engine3D?.context3D ?? this._boundCtx;
        if (ctx && !this._overlayResizeAttached) {
            ctx.addEventListener(CResizeEvent.RESIZE, this._onResize, this);
            this._overlayResizeAttached = true;
        }
        this._applyScreenOrtho();
    }

    /** Add an Object3D to this overlay's scene. */
    public attach(obj: Object3D) {
        this.overlayScene.addChild(obj);
    }

    public remove(obj: Object3D) {
        this.overlayScene.removeChild(obj);
    }

    private _onResize() {
        this._applyScreenOrtho();
    }

    /**
     * Override Camera3D's resize-triggered projection rebuild — the inherited
     * one re-runs `Matrix4.orthoOffCenter`, which uses the engine's
     * negative-X convention and is broken for asymmetric (l=0, r=w) ranges.
     * We always want the screen-space top-left ortho.
     */
    public updateProjection() {
        const ctx = this._ownerView?.engine3D?.context3D ?? this._boundCtx;
        if (ctx) this.aspect = ctx.aspect;
        this._applyScreenOrtho();
    }

    private _applyScreenOrtho() {
        const ctx = this._ownerView?.engine3D?.context3D ?? this._boundCtx;
        if (!ctx) return;
        const w = ctx.presentationSize[0] / ctx.pixelRatio;
        const h = ctx.presentationSize[1] / ctx.pixelRatio;
        const near = -1000, far = 1000;

        // Build the projection matrix directly. Cannot use
        // `Camera3D.orthoOffCenter` here because Orillusion's Matrix4.orthoOffCenter
        // is wired for the engine's negative-X projection convention (works
        // for symmetric ranges where lookAt counter-flips X, but maps
        // asymmetric world.x=w → clip.x=-3 instead of +1, putting every
        // overlay sprite off-screen-left).
        //
        // Top-left screen origin: world (0,0) → NDC (-1,+1); world (w,h) → NDC (+1,-1).
        //   clip.x = 2*world.x/w - 1
        //   clip.y = 1 - 2*world.y/h     (Y-down)
        // Standard WebGPU NDC (Z in [0,1]) for depth.
        this.left = 0; this.right = w; this.top = 0; this.bottom = h;
        this.near = near; this.far = far;
        this.aspect = w / h;
        this.type = CameraType.ortho;

        const data = (this as any)._projectionMatrix.rawData as Float32Array;
        data[0] = 2 / w;  data[1] = 0;       data[2] = 0;                       data[3] = 0;
        data[4] = 0;      data[5] = -2 / h;  data[6] = 0;                       data[7] = 0;
        data[8] = 0;      data[9] = 0;       data[10] = 1 / (far - near);       data[11] = 0;
        data[12] = -1;    data[13] = 1;      data[14] = -near / (far - near);   data[15] = 1;
    }
}
