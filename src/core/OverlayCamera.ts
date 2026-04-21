import { CResizeEvent } from '../event/CResizeEvent';
import { Camera3D } from './Camera3D';
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

    private _applyScreenOrtho() {
        const ctx = this._ownerView?.engine3D?.context3D ?? this._boundCtx;
        if (!ctx) return;
        const w = ctx.presentationSize[0] / ctx.pixelRatio;
        const h = ctx.presentationSize[1] / ctx.pixelRatio;
        // Top-left origin: left=0, right=w, top=0, bottom=h. Y increases downward.
        this.orthoOffCenter(0, w, h, 0, -1000, 1000);
    }
}
