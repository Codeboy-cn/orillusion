import { Object3D } from "..";
import { CEventListener } from "../event/CEventListener";
import { ShadowLightsCollect } from "../gfx/renderJob/collect/ShadowLightsCollect";
import { InteractiveDispatcher } from "../io/InteractiveDispatcher";
import { PickFire } from "../io/PickFire";
import { Vector4 } from "../math/Vector4";
import { Camera3D } from "./Camera3D";
import { OverlayCamera } from "./OverlayCamera";
import { Scene3D } from "./Scene3D";

export class View3D extends CEventListener {
    private _camera: Camera3D;
    private _scene: Scene3D;
    private _viewPort: Vector4;
    private _enablePick: boolean = false;
    private _enable: boolean = true;
    public pickFire: PickFire;
    /**
     * Per-view 2D interaction dispatcher. Created lazily by the first
     * `Interactive` component on this view (see `Interactive.onEnable`).
     * `PickFire` consults it so `Interactive.blocking=true` hits can
     * short-circuit 3D raycast picking.
     */
    public interactiveDispatcher: InteractiveDispatcher | null = null;
    /**
     * Reference to the Engine3D instance that owns this view. Set by
     * `engine.startRenderView(view)`. Components that need per-instance state
     * (input system, context, etc.) read it via this back-pointer so
     * they work under multi-instance setups.
     */
    public engine3D: any;

    constructor(x: number = 0, y: number = 0, width: number = 0, height: number = 0) {
        super();
        this._viewPort = new Vector4(x, y, width, height);
    }

    public get enable(): boolean {
        return this._enable;
    }

    public set enable(value: boolean) {
        this._enable = value;
    }

    public get enablePick(): boolean {
        return this._enablePick;
    }

    public set enablePick(value: boolean) {
        if (this._enablePick != value) {
            this.pickFire = new PickFire(this);
            this.pickFire.start();
        }
        this._enablePick = value;
    }

    public get scene(): Scene3D {
        return this._scene;
    }

    public set scene(value: Scene3D) {
        this._scene = value;
        value.view = this;

        ShadowLightsCollect.createBuffer(this);
    }

    public get camera(): Camera3D {
        return this._camera;
    }

    public set camera(value: Camera3D) {
        this._camera = value;
    }

    public get viewPort(): Vector4 {
        return this._viewPort;
    }

    public set viewPort(value: Vector4) {
        this._viewPort = value;
    }

    /**
     * Create a sibling overlay view driven by an `OverlayCamera` and hook it
     * into this view's engine. Returns the camera so callers can immediately
     * `attach()` sprites/objects to it.
     *
     * The new view owns its own `Scene3D` (the camera's `overlayScene`) so
     * overlay content never mixes into the main scene graph. The overlay view
     * is added to the engine via `engine.addOverlayView()` — requires this
     * view to already be wired to an engine (call after `engine.startRenderView(view)`).
     *
     * @param priority sort key among overlay views. Lower renders first.
     */
    public createOverlayCamera(priority: number = 100): OverlayCamera {
        if (!this.engine3D) {
            throw new Error(
                `View3D.createOverlayCamera: view is not attached to an engine yet. Call engine.startRenderView(view) first.`,
            );
        }
        const overlayView = new View3D(this._viewPort.x, this._viewPort.y, this._viewPort.z, this._viewPort.w);
        const host = new Object3D();
        const camera = host.addComponent(OverlayCamera);
        camera.priority = priority;

        // The camera owns its overlay scene; the camera's host needs to live
        // inside that scene so its world transform resolves.
        camera.overlayScene.addChild(host);

        overlayView.scene = camera.overlayScene;
        overlayView.camera = camera;

        // Engine must be wired to the view BEFORE attachToView runs the
        // ortho projection setup — `_applyScreenOrtho` reads the canvas
        // size off `view.engine3D.context3D`, which is only set inside
        // addOverlayView.
        this.engine3D.addOverlayView(overlayView);
        camera.attachToView(overlayView);
        return camera;
    }

}