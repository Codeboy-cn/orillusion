import { Camera3D } from '../core/Camera3D';
import { Object3D } from '../core/entities/Object3D';
import { View3D } from '../core/View3D';
import { MirrorMaterial } from '../materials/MirrorMaterial';
import { MeshRenderer } from './renderer/MeshRenderer';
import { SceneCaptureCameraComponent } from './SceneCaptureCameraComponent';
import { Vector3 } from '../math/Vector3';
import { ComponentBase } from './ComponentBase';
import { RegisterComponent } from '../util/SerializeDecoration';
import { RendererMaskUtil } from '../gfx/renderJob/passRenderer/state/RendererMask';

/**
 * One-stop planar mirror component. Attach to an Object3D that already
 * carries a {@link MeshRenderer} with a {@link MirrorMaterial} (any
 * geometry — plane, terrain patch, irregular puddle) and the component
 * sets up the rest:
 *
 *   1. Spawns an off-screen {@link Camera3D} at the y-mirror of the
 *      main camera (refreshed every frame from
 *      {@link MirrorComponent.onUpdate}).
 *   2. Attaches a {@link SceneCaptureCameraComponent} so that camera
 *      renders the scene into a render target every frame.
 *   3. Tags the host renderer with {@link MirrorComponent.MIRROR_MASK}
 *      and configures the capture's `excludeMask` so the mirror surface
 *      does not capture itself (avoids feedback / "mirror in mirror"
 *      recursion artefacts).
 *   4. Binds the capture RT into the host's {@link MirrorMaterial} as
 *      soon as the capture pass has produced a texture (lazy — runs
 *      once on the first frame the RT becomes non-null).
 *
 * Usage
 * -----
 *
 * ```ts
 * const floor = new Object3D();
 * const mr = floor.addComponent(MeshRenderer);
 * mr.geometry = new PlaneGeometry(40, 40);
 * mr.material = new MirrorMaterial();
 * const mirror = floor.addComponent(MirrorComponent);
 * mirror.mainTarget = new Vector3(0, 1, 0);  // what the main camera looks at
 * mirror.mirrorY = 0;                        // mirror plane height (default 0)
 * scene.addChild(floor);
 * ```
 *
 * The component reads {@link mainCamera} from {@link View3D.camera} on
 * enable when not explicitly set, so a single-camera scene needs no
 * other configuration.
 *
 * Limits
 * ------
 *
 * - Reflects across a horizontal plane (constant world Y); arbitrary
 *   plane normals are not supported in this version.
 * - Multiple mirrors in the same scene all share
 *   {@link MIRROR_MASK} — that means no mirror captures any other
 *   mirror surface (good — prevents feedback) but it also means a
 *   mirror can not appear in another mirror's reflection. If you
 *   need cross-mirror reflections, give each mirror a unique bit on
 *   {@link MeshRenderer.rendererMask} + a matching `excludeMask` set
 *   on its {@link captureComponent} manually.
 *
 * @group Components
 */
@RegisterComponent(MirrorComponent, 'MirrorComponent')
export class MirrorComponent extends ComponentBase {
    /**
     * Custom {@link RendererMask} bit reserved for "this is a mirror
     * surface and should not appear in other mirrors". Bit 11 is
     * unclaimed by the engine's built-in mask values (highest is
     * {@link RendererMask.Graphic3D} = `1 << 10`). Exposed so user
     * code can check / clear it on hand-managed renderers.
     */
    public static readonly MIRROR_MASK = 1 << 11;

    /** Capture render-target width in pixels. Forwarded to
     *  {@link SceneCaptureCameraComponent.width}. Setting this after
     *  enable triggers an RT reallocation on the next frame. */
    public width: number = 1024;

    /** Capture render-target height in pixels. */
    public height: number = 1024;

    /** Mirror plane height in world space (constant world Y). */
    public mirrorY: number = 0;

    /** The scene's main camera that this mirror reflects. When left
     *  null, resolves to {@link View3D.camera} on enable. Set
     *  explicitly if your scene swaps cameras at runtime. */
    public mainCamera: Camera3D | null = null;

    /** World-space point the main camera looks at — the mirror camera
     *  is aimed at the reflection of this point across `mirrorY`.
     *  Default is the world origin; override to match your camera
     *  controller's pivot (e.g. `HoverCameraController.setCamera`'s
     *  `target` argument). */
    public mainTarget: Vector3 = new Vector3(0, 0, 0);

    private _captureRoot: Object3D | null = null;
    private _captureCam: Camera3D | null = null;
    private _capture: SceneCaptureCameraComponent | null = null;
    private _material: MirrorMaterial | null = null;
    private _bound: boolean = false;
    private _hostRenderer: MeshRenderer | null = null;

    private _mirrorPos = new Vector3();
    private _mirrorTarget = new Vector3();
    /** Reflecting +Y across the mirror flips up. Stored once instead of
     *  re-allocated each frame. */
    private _mirrorUp = new Vector3(0, -1, 0);

    /** Live reference to the auto-created scene-capture component, in
     *  case advanced users want to tweak its properties (clearColor,
     *  includeSky, updateMode, …). Null until enable. */
    public get captureComponent(): SceneCaptureCameraComponent | null {
        return this._capture;
    }

    /** The {@link MirrorMaterial} the component bound. Resolved from
     *  the host {@link MeshRenderer} on enable. Null if no
     *  MirrorMaterial was found (the component logs a warning and
     *  no-ops in that case). */
    public get material(): MirrorMaterial | null {
        return this._material;
    }

    public start(): void {
        // Use start (not onEnable) for setup so the default mainCamera
        // pull from the view + the capture-node allocation are one-shot,
        // and the onEnable / onDisable cycle only toggles the capture
        // component's enable rather than tearing down GPU resources.
        // ComponentBase calls onEnable BEFORE start on first attach, so
        // doing this work in onEnable would have to defend against
        // not-yet-resolved view/camera references.
        const view = this.transform?.view3D;
        if (!view) {
            console.warn('[MirrorComponent] no view3D in start — mirror disabled.');
            return;
        }

        this.mirrorY = this.object3D.y;
        
        this._setup(view);
    }

    public onEnable(_view?: View3D): void {
        // Resume capture when the mirror is re-enabled. Setup happened
        // in start() — we only flip the capture component's enable
        // here so SceneCapturePass starts/stops scheduling captures.
        if (this._capture) this._capture.enable = true;
    }

    public onDisable(_view?: View3D): void {
        // Pause capture without tearing down the capture chain. The RT
        // stays bound on the material, so the floor keeps showing the
        // last captured frame — which is the right behaviour for
        // freeze-frame disable. If you need full teardown, destroy
        // the component instead.
        if (this._capture) this._capture.enable = false;
    }

    public onUpdate(_view?: View3D): void {
        if (!this._captureCam || !this._captureRoot || !this.mainCamera) return;

        // Mirror the main camera position + look-at across y = mirrorY.
        // We don't extract basis vectors from the camera's worldMatrix —
        // different engines disagree on whether camera-forward is the
        // +Z or -Z column, and using an explicit look-at point sidesteps
        // the convention question entirely.
        const wp = this.mainCamera.transform.worldPosition;
        this._mirrorPos.set(wp.x, 2 * this.mirrorY - wp.y, wp.z);
        this._mirrorTarget.set(
            this.mainTarget.x,
            2 * this.mirrorY - this.mainTarget.y,
            this.mainTarget.z,
        );

        // Y-reflection flips up; without this lookAt would still produce
        // a valid orthonormal frame but the captured RT would be
        // vertically flipped relative to the main-camera screen — half
        // the planar-mirror pixels would then read wrong rows.
        this._captureRoot.transform.lookAt(this._mirrorPos, this._mirrorTarget, this._mirrorUp);
        this._captureRoot.transform.localPosition = this._mirrorPos;
        this._captureRoot.transform.updateWorldMatrix(true);

        // Late-bind the capture RT into the material on the first frame
        // it becomes available. SceneCaptureCameraComponent allocates
        // its GBuffer lazily on first execute, so getCaptureTexture()
        // returns null until then.
        if (!this._bound && this._material && this._capture) {
            const tex = this._capture.getCaptureTexture();
            if (tex) {
                this._material.mirrorMap = tex;
                this._bound = true;
            }
        }
    }

    private _setup(view: View3D): void {
        this._hostRenderer = this.object3D.getComponent(MeshRenderer);
        if (!this._hostRenderer) {
            console.warn('[MirrorComponent] no MeshRenderer found on host Object3D — mirror disabled.');
            return;
        }
        const mat = this._hostRenderer.material;
        if (!(mat instanceof MirrorMaterial)) {
            console.warn('[MirrorComponent] host MeshRenderer.material must be a MirrorMaterial — mirror disabled.');
            return;
        }
        this._material = mat;

        // Tag the host renderer so the capture skips it. addMask is
        // idempotent so repeated calls won't accumulate duplicate bits.
        this._hostRenderer.rendererMask = RendererMaskUtil.addMask(
            this._hostRenderer.rendererMask,
            MirrorComponent.MIRROR_MASK,
        );

        // Default mainCamera to the active view's camera. This is the
        // primary reason setup is in start() rather than onEnable() —
        // the user can attach MirrorComponent without naming a camera
        // and the component picks up whatever the View3D is rendering
        // through, matching the zero-config story for other view-aware
        // components in the engine.
        if (!this.mainCamera) {
            this.mainCamera = view.camera;
            this.mainTarget = view.camera.lookTarget;
        }
        if (!this.mainCamera) {
            console.warn('[MirrorComponent] no main camera — set mainCamera explicitly or attach the view first.');
            return;
        }

        // Spin up the capture camera under the scene root (NOT under the
        // host) so its world transform isn't double-folded by the host's
        // transform. Match the main camera's projection so the reflected
        // view has the same FOV / aspect / near-far as what the user
        // sees directly.
        this._captureRoot = new Object3D();
        this._captureRoot.name = 'MirrorComponent.captureRoot';
        this._captureCam = this._captureRoot.addComponent(Camera3D);
        this._captureCam.perspective(
            this.mainCamera.fov,
            this.mainCamera.aspect,
            this.mainCamera.near,
            this.mainCamera.far,
        );

        this._capture = this._captureRoot.addComponent(SceneCaptureCameraComponent);
        this._capture.width = this.width;
        this._capture.height = this.height;
        // Skip the mirror surface itself; otherwise the floor's back face
        // would render into its own reflection RT.
        this._capture.excludeMask = MirrorComponent.MIRROR_MASK;

        view.scene.addChild(this._captureRoot);
        this._bound = false;
    }

    public destroy(force?: boolean): void {
        if (this._captureRoot) {
            const parent = this._captureRoot.parent && (this._captureRoot.parent.object3D as Object3D);
            if (parent) parent.removeChild(this._captureRoot);
        }
        this._captureRoot = null;
        this._captureCam = null;
        this._capture = null;
        this._material = null;
        this._hostRenderer = null;
        super.destroy?.(force);
    }
}
