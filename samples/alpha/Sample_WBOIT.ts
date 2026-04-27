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
    PostProcessingComponent,
    Scene3D,
    SphereGeometry,
    TAAPost,
    View3D,
} from "@orillusion/core";

type Mode = 'sorted' | 'weighted' | 'hash';

/**
 * Transparency-algorithm showcase: 3×3×3 grid of 27 translucent spheres
 * rendered through an orthographic camera against a black background.
 * Ortho removes perspective foreshortening as a depth cue, so the only
 * thing telling you which sphere is in front is fragment ordering —
 * exactly the signal we're comparing.
 *
 * Three GUI modes, exercising three different algorithms:
 *
 *   - `sorted` (alphaMode='BLEND', oitMode='sorted'):
 *     classic back-to-front per-MESH sort with alpha-blend over. Each
 *     sphere is sorted as a single unit by its centre depth; at sphere
 *     intersection circles half the fragments blend in the wrong order.
 *     Inside each sphere triangles draw in geometry order, NOT depth
 *     order — at oblique camera angles the sphere's latitude rings
 *     show up as horizontal banding (the back hemisphere's fragments
 *     can land on top of the front's because depth-write is off).
 *
 *   - `weighted` (alphaMode='BLEND', oitMode='weighted'):
 *     WBOIT (McGuire & Bavoil 2013). Order-INDEPENDENT — every fragment
 *     contributes via additive accum / multiplicative reveal, regardless
 *     of draw order. Intersection-circle artifacts and the in-sphere
 *     banding vanish; trade-off is the whole cluster looks "averaged"
 *     / softer because depth ordering is intentionally thrown away.
 *
 *   - `hash` (alphaMode='HASH'):
 *     Stochastic transparency (Wyman 2017). Each fragment compares its
 *     alpha against a hash of its world position; below threshold →
 *     discard, above → solid opaque write (depth & color). No sorting,
 *     no blending, depth-correct. Single-frame output is a dithered
 *     noise pattern; TAA's sub-pixel camera jitter shifts the hash
 *     each frame and the temporal blend converges to true alpha.
 *     This sample auto-attaches TAAPost so the convergence is visible.
 *
 * Engine wiring: `setting.render.useOIT = true` bakes the OIT features
 * into the frame graph; the GUI toggle flips every material's
 * `alphaMode` (BLEND vs HASH) and `oitMode` (sorted vs weighted).
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
        mode: 'weighted' as Mode,
        alpha: 0.85,
        radius: 1.0,
        xySpacing: 2.0,
        zSpacing: 2.0,
        doubleSide: true,
        roughness: 0.5,
        frustumSize: 14,
    };

    private camera!: ReturnType<typeof CameraUtil.createCamera3DObject>;

    private _initMode: Mode = (() => {
        const m = (globalThis as any).__VERIFY_MODE;
        return (m === 'sorted' || m === 'hash') ? m : 'weighted';
    })();

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

        // TAA is the convergence engine for `hash` mode (sub-pixel
        // camera jitter shifts the per-fragment hash every frame, and
        // the history blend averages the noise into smooth alpha). It
        // does no harm to `sorted` / `weighted`, so we always-on it.
        const post = this.scene.addComponent(PostProcessingComponent);
        post.addPost(TAAPost);

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

        const { radius, xySpacing, zSpacing, alpha, roughness, doubleSide } = this.params;
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
                    m.doubleSide = doubleSide;
                    this.applyModeToMaterial(m, this.params.mode);
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
            this.applyModeToMaterial(m, mode);
        }
    }

    /**
     * Map the GUI's three-way `mode` to the underlying material flags.
     * `sorted` and `weighted` share alphaMode='BLEND' but route through
     * different OIT features; `hash` uses alphaMode='HASH' (opaque
     * queue + per-fragment hash discard) and oitMode is irrelevant.
     */
    private applyModeToMaterial(m: LitMaterial, mode: Mode) {
        if (mode === 'hash') {
            m.alphaMode = 'HASH';
        } else {
            m.alphaMode = 'BLEND';
            m.oitMode = mode;
        }
    }

    private initGUI() {
        GUIHelp.addFolder('WBOIT demo');

        GUIHelp.add(this.params, 'mode', ['sorted', 'weighted', 'hash']).onChange((v: string) => {
            this.params.mode = v as Mode;
            for (const m of this.sphereMaterials) this.applyModeToMaterial(m, v as Mode);
            console.log('[transparency] mode →', v);
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
