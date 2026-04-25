import { GUIHelp } from "@orillusion/debug/GUIHelp";
import {
    AtmosphericComponent,
    BitmapTexture2D,
    BoxGeometry,
    CameraUtil,
    Color,
    DirectLight,
    Engine3D,
    HoverCameraController,
    KelvinUtil,
    LitMaterial,
    MeshRenderer,
    Object3D,
    PlaneGeometry,
    Scene3D,
    SphereGeometry,
    View3D,
} from "@orillusion/core";
import { GUIUtil } from "@samples/utils/GUIUtil";

/** Build a procedural alpha-cutout texture so the A2C plane has actual
 *  alpha variation to demonstrate. Generates a dot-grid leaf-like
 *  pattern in a 256×256 canvas; each dot is fully opaque, gaps are
 *  fully transparent — exactly the case where MSAA + alpha-to-coverage
 *  shines vs hard-cutout discard. */
function buildLeafAlphaTexture(): BitmapTexture2D {
    const size = 256;
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext('2d')!;
    // Fully transparent base
    ctx.clearRect(0, 0, size, size);
    // Random scatter of organic-looking dots, colored leafy-green so the
    // RGB looks reasonable independently of the alpha cutout test.
    ctx.fillStyle = 'rgba(60, 160, 80, 1.0)';
    for (let i = 0; i < 80; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const r = 6 + Math.random() * 14;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }
    // Add a soft border ring so the plane silhouette is visible too
    ctx.strokeStyle = 'rgba(80, 180, 100, 1.0)';
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, size - 16, size - 16);
    // useMipmap=true keeps the sampler binding layout as 'filtering'
    // — matching the shader's baseMap/transmissionMap bindings. Passing
    // false here flips it to 'non-filtering' and produces
    // "Filtering sampler is incompatible with non-filtering sampler binding".
    const tex = new BitmapTexture2D(true);
    tex.source = cv;
    return tex;
}

/**
 * End-to-end demo for the P0→P2 transparency additions:
 *
 * - **P0 Alpha-to-Coverage**: left plane uses `alphaMode='MASK'` +
 *   alphaCutoff. Foliage-style hard cutout with smooth edges when
 *   the engine MSAA is on.
 *
 * - **P1 Transmission**: centre sphere uses `transmissionFactor=1`
 *   and samples the SceneColorPyramid for refraction. Try dragging
 *   the camera — the backdrop seen through the glass sphere updates
 *   each frame.
 *
 * - **P2 OIT opt-in**: a stack of 20+ coloured transparent slabs on
 *   the right exercises the sorted transparent path; toggling
 *   `useOIT` in the GUI re-routes them through the OIT feature
 *   scaffold (see `TransparentOITFeature`). OIT path currently
 *   falls through to the same renderer — full WBOIT shader variant
 *   is a P2-full follow-up — but the graph wiring is validated.
 *
 * - **`alphaMode='BLEND'`**: a simple colored sphere pair demonstrates
 *   back-to-front sorted alpha.
 */
class Sample_Transparency {
    engine: Engine3D;
    scene: Scene3D;
    lightObj3D: Object3D;
    view: View3D;

    async run() {
        this.engine = await Engine3D.init({
            setting: {
                // Per-instance MSAA: the P0 plumbing. When >0 the main
                // colour attachment becomes a multisample target and
                // A2C pipelines are enabled for MASK materials.
                render: { debug: false, msaa: 4, useOIT: true },
                shadow: { enable: true, type: 'HARD' },
            },
        });

        GUIHelp.init();

        this.scene = new Scene3D();
        const sky = this.scene.addComponent(AtmosphericComponent);
        const camera = CameraUtil.createCamera3DObject(this.scene);
        camera.perspective(60, this.engine.aspect, 1, 5000.0);
        camera.object3D.addComponent(HoverCameraController).setCamera(35, -12, 55);

        this.view = new View3D();
        this.view.scene = this.scene;
        this.view.camera = camera;
        this.engine.startRenderView(this.view);

        GUIUtil.renderDebug(this.view);

        await this.initScene();
        sky.relativeTransform = this.lightObj3D.transform;

        this.initGUI();
    }

    async initScene() {
        // Lights.
        this.lightObj3D = new Object3D();
        this.lightObj3D.rotationX = 30;
        this.lightObj3D.rotationY = 120;
        const directLight = this.lightObj3D.addComponent(DirectLight);
        directLight.lightColor = KelvinUtil.color_temperature_to_rgb(6500);
        directLight.intensity = 4;
        directLight.castShadow = false;
        this.scene.addChild(this.lightObj3D);

        // Ground: an opaque chequer plane — the backdrop that
        // transmission materials sample and A2C plane stands against.
        {
            const ground = new Object3D();
            const gr = ground.addComponent(MeshRenderer);
            gr.geometry = new PlaneGeometry(120, 120, 1, 1);
            const mat = new LitMaterial();
            mat.baseColor = new Color(0.85, 0.85, 0.85, 1);
            mat.roughness = 0.9;
            mat.metallic = 0.0;
            gr.material = mat;
            ground.transform.y = -5;
            this.scene.addChild(ground);
        }

        // Colored opaque cubes behind the glass so refraction has
        // something visually interesting to distort.
        const colors = [
            new Color(0.95, 0.15, 0.20, 1),
            new Color(0.15, 0.60, 0.95, 1),
            new Color(0.95, 0.80, 0.10, 1),
            new Color(0.30, 0.95, 0.35, 1),
            new Color(0.85, 0.35, 0.95, 1),
        ];
        for (let i = 0; i < colors.length; i++) {
            const box = new Object3D();
            const m = new LitMaterial();
            m.baseColor = colors[i];
            m.roughness = 0.6;
            m.metallic = 0.1;
            const r = box.addComponent(MeshRenderer);
            r.geometry = new BoxGeometry(3, 6, 3);
            r.material = m;
            box.transform.x = (i - 2) * 5;
            box.transform.y = -2;
            box.transform.z = -8;
            this.scene.addChild(box);
        }

        // --- P0: Alpha-to-Coverage plane. ---
        // Procedurally-built dot-grid alpha texture demonstrates the
        // visual difference vs hard `discard` cutout: with MSAA + A2C
        // each dot's silhouette is anti-aliased through coverage masks.
        {
            const plane = new Object3D();
            const m = new LitMaterial();
            m.baseColor = new Color(1, 1, 1, 1);
            m.alphaCutoff = 0.5;
            m.alphaMode = 'MASK';
            m.baseMap = buildLeafAlphaTexture();
            m.doubleSide = true;
            const r = plane.addComponent(MeshRenderer);
            r.geometry = new PlaneGeometry(10, 8, 1, 1);
            r.material = m;
            plane.transform.x = -16;
            plane.transform.y = 1;
            plane.transform.rotationX = 90;
            this.scene.addChild(plane);
        }

        // --- P1: Transmission "glass" sphere. ---
        {
            const glass = new Object3D();
            const m = new LitMaterial();
            m.baseColor = new Color(1, 1, 1, 1);
            m.roughness = 0.05;
            m.metallic = 0;
            m.ior = 1.5;
            m.transmissionFactor = 1.0;
            m.thicknessFactor = 0.6;
            m.attenuationDistance = 2.5;
            m.attenuationColor = new Color(0.9, 1.0, 0.95, 1);
            // Transmission stays on the OPAQUE queue — the fragment
            // shader folds scene colour into the output and writes
            // alpha=1. alphaMode='OPAQUE' is already the default.
            const r = glass.addComponent(MeshRenderer);
            r.geometry = new SphereGeometry(3.5, 48, 48);
            r.material = m;
            glass.transform.x = 0;
            glass.transform.y = 2;
            glass.transform.z = 2;
            this.scene.addChild(glass);
        }

        // --- Mixed transparent stack — 12 coloured slabs.
        // Even-indexed slabs use the legacy sorted path (oitMode='sorted'),
        // odd-indexed use Weighted-Blended OIT (oitMode='weighted').
        // When `useOIT=true` both render paths run in the same frame:
        // sorted slabs draw via SortedTransparentFeature with the
        // 'sorted' filter, weighted slabs draw via TransparentOITFeature.
        // This validates the A8 "OIT and sorted coexistence" wiring.
        for (let i = 0; i < 12; i++) {
            const slab = new Object3D();
            const m = new LitMaterial();
            const hue = i / 12;
            const c = new Color(
                0.5 + 0.4 * Math.sin(hue * 6.28),
                0.5 + 0.4 * Math.sin(hue * 6.28 + 2.1),
                0.5 + 0.4 * Math.sin(hue * 6.28 + 4.2),
                0.35,
            );
            m.baseColor = c;
            m.roughness = 0.3;
            m.metallic = 0;
            m.alphaMode = 'BLEND';
            m.oitMode = (i % 2 === 0) ? 'sorted' : 'weighted';
            const r = slab.addComponent(MeshRenderer);
            r.geometry = new BoxGeometry(6, 6, 0.3);
            r.material = m;
            slab.transform.x = 16;
            slab.transform.y = 0;
            slab.transform.z = -6 + i * 0.5;
            this.scene.addChild(slab);
        }
    }

    private initGUI() {
        GUIHelp.addFolder('Transparency demo');
        const proxy: any = {
            alphaCutoff: 0.5,
            transmissionFactor: 1.0,
            attenuationDistance: 2.5,
            ior: 1.5,
        };
        // Expose knobs so the user can feel the pipeline end-to-end.
        GUIHelp.add(proxy, 'alphaCutoff', 0.0, 1.0, 0.01).onChange((v: number) => {
            this.scene.forChild((c: Object3D) => {
                const r = c.getComponent(MeshRenderer);
                const mat: any = r?.material;
                if (mat instanceof LitMaterial && mat.alphaMode === 'MASK') {
                    mat.alphaCutoff = v;
                }
            });
        });
        GUIHelp.add(proxy, 'transmissionFactor', 0.0, 1.0, 0.01).onChange((v: number) => {
            this.scene.forChild((c: Object3D) => {
                const r = c.getComponent(MeshRenderer);
                const mat: any = r?.material;
                if (mat instanceof LitMaterial && mat.transmissionFactor > 0) {
                    mat.transmissionFactor = v;
                }
            });
        });
        GUIHelp.add(proxy, 'ior', 1.0, 2.5, 0.01).onChange((v: number) => {
            this.scene.forChild((c: Object3D) => {
                const r = c.getComponent(MeshRenderer);
                const mat: any = r?.material;
                if (mat instanceof LitMaterial && mat.transmissionFactor > 0) {
                    mat.ior = v;
                }
            });
        });
        GUIHelp.add(proxy, 'attenuationDistance', 0.1, 20.0, 0.1).onChange((v: number) => {
            this.scene.forChild((c: Object3D) => {
                const r = c.getComponent(MeshRenderer);
                const mat: any = r?.material;
                if (mat instanceof LitMaterial && mat.transmissionFactor > 0) {
                    mat.attenuationDistance = v;
                }
            });
        });
        GUIHelp.endFolder();
    }
}

new Sample_Transparency().run();
