import { GUIHelp } from "@orillusion/debug/GUIHelp";
import {
    CameraUtil,
    Color,
    DirectLight,
    Engine3D,
    HoverCameraController,
    KelvinUtil,
    LitMaterial,
    MeshRenderer,
    Object3D,
    Scene3D,
    SphereGeometry,
    View3D,
} from "@orillusion/core";

/**
 * WBOIT showcase: 3×3 grid of 9 translucent spheres (α=0.6) packed so
 * adjacent sphere surfaces mutually intersect — laid out as a flat
 * panel in the XY plane against a black background.
 *
 * Toggle `mode` in the GUI to compare:
 *   - `sorted`: classic back-to-front per-MESH sort with alpha-blend
 *     over. Each sphere is sorted as a single unit by its centre depth;
 *     at sphere intersection circles half the fragments blend in the
 *     wrong order. Visible as hard "wrong tint on top" edges along
 *     the intersection circles.
 *   - `weighted`: WBOIT (McGuire & Bavoil 2013). Order-INDEPENDENT —
 *     every fragment contributes via additive accum / multiplicative
 *     reveal, regardless of draw order. The intersection-circle
 *     artifacts vanish; the trade-off is that the whole cluster
 *     looks "averaged" / softer because depth ordering is intentionally
 *     thrown away. You can no longer read which sphere is in front
 *     from the colour mixing alone — that is the algorithm's defining
 *     property, not a bug.
 *
 * Engine wiring: `setting.render.useOIT = true` bakes the OIT features
 * into the frame graph; the GUI toggle just flips every material's
 * `oitMode` between 'sorted' (routes through SortedTransparentFeature)
 * and 'weighted' (routes through TransparentOITFeature → resolve).
 *
 * Black background: no SkyRenderer / AtmosphericComponent attached so
 * the swapchain clears to (0,0,0,1) every frame, giving the saturated
 * sphere colours maximum contrast against the void.
 */
class Sample_WBOIT {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;

    private sphereMaterials: LitMaterial[] = [];
    private lightObj3D!: Object3D;
    // Verification hook the headless probe sets on `window` BEFORE this
    // module is imported. Default = weighted.
    private _initMode: 'sorted' | 'weighted' =
        ((globalThis as any).__VERIFY_MODE === 'sorted') ? 'sorted' : 'weighted';

    async run() {
        this.engine = await Engine3D.init({
            setting: {
                render: { debug: false, useOIT: true } as any,
                shadow: { enable: false, type: 'HARD' },
            },
        });

        GUIHelp.init();

        this.scene = new Scene3D();
        const camera = CameraUtil.createCamera3DObject(this.scene);
        camera.perspective(45, this.engine.aspect, 0.5, 2000.0);
        // Centre the 3×3 panel; pull camera back enough to frame all
        // nine spheres comfortably.
        // Pull camera off-axis (yaw 25°, pitch -15°) so the cube's
        // depth difference is visible — front-face corners overlap
        // back-face corners on screen, giving the sorted vs weighted
        // comparison something to depth-sort.
        camera.object3D.addComponent(HoverCameraController).setCamera(25, -15, 16);

        this.view = new View3D();
        this.view.scene = this.scene;
        this.view.camera = camera;
        this.engine.startRenderView(this.view);

        await this.initScene();
        this.initGUI();
    }

    async initScene() {
        this.lightObj3D = new Object3D();
        this.lightObj3D.rotationX = 35;
        this.lightObj3D.rotationY = 130;
        const directLight = this.lightObj3D.addComponent(DirectLight);
        directLight.lightColor = KelvinUtil.color_temperature_to_rgb(6500);
        directLight.intensity = 4;
        directLight.castShadow = false;
        this.scene.addChild(this.lightObj3D);

        // 3×3 grid laid out so each row sits at a different z depth.
        // From camera looking along -z:
        //   row 0 (top)    → z = +3 (farthest from camera, drawn first)
        //   row 1 (middle) → z =  0
        //   row 2 (bottom) → z = -3 (closest, drawn last)
        // Columns within a row vary x (-3, 0, +3) so neighbours
        // overlap on screen with the row above/below — that gives the
        // sorted vs weighted comparison something real to depth-sort.
        // α=0.85 keeps each front sphere visibly covering the back
        // sphere behind it; the residual 15% transmittance carries
        // the algorithm difference (sorted = clean stacking from
        // front, weighted = averaged regardless of order).
        const palette = [
            new Color(1.00, 0.40, 0.45),  // [0,0]
            new Color(0.40, 0.80, 1.00),  // [0,1]
            new Color(1.00, 0.85, 0.30),  // [0,2]
            new Color(0.45, 1.00, 0.55),  // [1,0]
            new Color(0.95, 0.45, 1.00),  // [1,1]
            new Color(0.30, 1.00, 0.85),  // [1,2]
            new Color(1.00, 0.65, 0.30),  // [2,0]
            new Color(0.55, 0.50, 1.00),  // [2,1]
            new Color(1.00, 0.30, 0.70),  // [2,2]
        ];

        const radius = 1.6;
        const xySpacing = radius * 2.0;   // half-overlap on screen
        const zSpacing = radius * 1.8;    // distinct depth per row
        // none = both sides of the sphere render so a translucent
        // sphere shows its own far hemisphere through the near one
        // (default back-face cull would slice each sphere into a
        // bowl). Critical for translucent geometry.
        const geom = new SphereGeometry(radius, 32, 24);

        let colorIdx = 0;
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 3; col++) {
                const sphere = new Object3D();
                const m = new LitMaterial();
                const c = palette[colorIdx++];
                m.baseColor = new Color(c.r, c.g, c.b, 0.85);
                m.roughness = 0.5;
                m.metallic = 0;
                m.alphaMode = 'BLEND';
                m.oitMode = this._initMode;
                m.doubleSide = true;
                const r = sphere.addComponent(MeshRenderer);
                r.geometry = geom;
                r.material = m;
                // X / Y centred around origin; Z stepped per row so
                // top row sits behind, bottom row sits in front.
                sphere.transform.x = (col - 1) * xySpacing;
                sphere.transform.y = (1 - row) * xySpacing;
                sphere.transform.z = (1 - row) * zSpacing;
                this.scene.addChild(sphere);
                this.sphereMaterials.push(m);
            }
        }
    }

    private initGUI() {
        GUIHelp.addFolder('WBOIT demo');
        const proxy = { mode: this._initMode };
        GUIHelp.add(proxy, 'mode', ['sorted', 'weighted']).onChange((v: string) => {
            for (const m of this.sphereMaterials) m.oitMode = v as any;
            console.log('[wboit] mode →', v);
        });
        GUIHelp.endFolder();
    }
}

new Sample_WBOIT().run();
