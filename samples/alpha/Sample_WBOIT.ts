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
 * WBOIT showcase: 3×3×3 grid of 27 translucent spheres rendered through
 * an orthographic camera against a black background. Ortho removes
 * perspective foreshortening as a depth cue, so the only thing telling
 * you which sphere is in front is fragment ordering — exactly the
 * signal we're comparing.
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
 */
class Sample_WBOIT {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;

    private sphereMaterials: LitMaterial[] = [];
    private sphereObjs: Object3D[] = [];
    private palette: Color[] = [];
    private directLight!: DirectLight;

    private params = {
        mode: 'weighted' as 'sorted' | 'weighted',
        alpha: 0.85,
        radius: 1.0,
        xySpacing: 2.0,
        zSpacing: 2.0,
        doubleSide: true,
        roughness: 0.5,
        frustumSize: 14,
    };

    private camera!: ReturnType<typeof CameraUtil.createCamera3DObject>;

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
        this.camera = CameraUtil.createCamera3DObject(this.scene);
        // Orthographic projection: frustumSize ≈ vertical world-unit
        // span. Cluster occupies ~6 units; 14 leaves comfortable margin.
        this.camera.ortho2(this.params.frustumSize, 0.5, 2000.0);
        // HoverCameraController only manipulates transform — projection
        // stays orthographic. Yaw/pitch values pulled off-axis so the
        // 3×3×3 cube's depth layers separate visually.
        this.camera.object3D.addComponent(HoverCameraController).setCamera(25, -15, 30);

        this.view = new View3D();
        this.view.scene = this.scene;
        this.view.camera = this.camera;
        this.engine.startRenderView(this.view);

        this.params.mode = this._initMode;
        this.palette = this.generatePalette(27);

        await this.initScene();
        this.initGUI();
    }

    async initScene() {
        // Single DirectLight, no shadows, no sky/IBL. Engine's default
        // envMap is a black cubemap, so all visible lighting comes
        // from this one direct source.
        const lightObj = new Object3D();
        lightObj.rotationX = 35;
        lightObj.rotationY = 130;
        this.directLight = lightObj.addComponent(DirectLight);
        this.directLight.lightColor = KelvinUtil.color_temperature_to_rgb(6500);
        this.directLight.intensity = 8;
        this.directLight.castShadow = false;
        this.scene.addChild(lightObj);

        this.buildSpheres();
    }

    /**
     * (Re)build the 3×3×3 sphere lattice. Geometry depends on `radius`,
     * positions depend on `xySpacing` / `zSpacing` — when the user
     * drags those sliders we tear down and rebuild rather than try to
     * mutate live transforms / geometry slot-by-slot.
     */
    private buildSpheres() {
        for (const obj of this.sphereObjs) this.scene.removeChild(obj);
        this.sphereObjs.length = 0;
        this.sphereMaterials.length = 0;

        const { radius, xySpacing, zSpacing, alpha, roughness, doubleSide, mode } = this.params;
        const geom = new SphereGeometry(radius, 32, 24);

        let idx = 0;
        for (let depth = 0; depth < 3; depth++) {
            for (let row = 0; row < 3; row++) {
                for (let col = 0; col < 3; col++) {
                    const sphere = new Object3D();
                    const m = new LitMaterial();
                    const c = this.palette[idx++];
                    m.baseColor = new Color(c.r, c.g, c.b, alpha);
                    m.roughness = roughness;
                    m.metallic = 0;
                    m.alphaMode = 'BLEND';
                    m.oitMode = mode;
                    m.doubleSide = doubleSide;
                    const r = sphere.addComponent(MeshRenderer);
                    r.geometry = geom;
                    r.material = m;
                    sphere.transform.x = (col - 1) * xySpacing;
                    sphere.transform.y = (1 - row) * xySpacing;
                    sphere.transform.z = (1 - depth) * zSpacing;
                    this.scene.addChild(sphere);
                    this.sphereObjs.push(sphere);
                    this.sphereMaterials.push(m);
                }
            }
        }
    }

    private updateMaterials() {
        const { alpha, roughness, doubleSide, mode } = this.params;
        for (let i = 0; i < this.sphereMaterials.length; i++) {
            const m = this.sphereMaterials[i];
            const c = this.palette[i];
            m.baseColor = new Color(c.r, c.g, c.b, alpha);
            m.roughness = roughness;
            m.doubleSide = doubleSide;
            m.oitMode = mode;
        }
    }

    private initGUI() {
        GUIHelp.addFolder('WBOIT demo');

        GUIHelp.add(this.params, 'mode', ['sorted', 'weighted']).onChange((v: string) => {
            this.params.mode = v as any;
            for (const m of this.sphereMaterials) m.oitMode = v as any;
            console.log('[wboit] mode →', v);
        });

        GUIHelp.add(this.params, 'alpha', 0.0, 1.0, 0.01).onChange(() => this.updateMaterials());
        GUIHelp.add(this.params, 'roughness', 0.0, 1.0, 0.01).onChange(() => this.updateMaterials());

        GUIHelp.endFolder();
    }

    /**
     * Generate `count` distinct, saturated colours by golden-ratio
     * hue stepping. Avoids palette repetition for the 27-sphere cube.
     */
    private generatePalette(count: number): Color[] {
        const out: Color[] = [];
        for (let i = 0; i < count; i++) {
            const h = (i * 0.61803398875) % 1;
            const [r, g, b] = hslToRgb(h, 0.7, 0.6);
            out.push(new Color(r, g, b));
        }
        return out;
    }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    if (s === 0) return [l, l, l];
    const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

new Sample_WBOIT().run();
