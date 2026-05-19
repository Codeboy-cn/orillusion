import {
    AtmosphericComponent, BlendMode, BoxGeometry, CameraUtil, Color, DirectLight, Engine3D,
    ForwardRendererJob, HoverCameraController, KelvinUtil, LitMaterial, MeshRenderer,
    Object3D, PlaneGeometry, Scene3D, SortedTransparentPass, ShadowPass, ColorPass,
    RenderLayer, View3D, Vector3,
} from "@orillusion/core";

/*
 * Sample_GISLayerComposition — strict scene-composition layering.
 *
 * Demonstrates the layer-mask system added on top of RenderGraph:
 *   - `RenderNode.renderLayer`  — which composition layers a node belongs to
 *   - `RenderGraphPass.layerMask` — which layers a pass draws
 *   - `Camera3D.cullingMask`    — which layers a camera can see
 *
 * Filtering rule applied at pass execute time:
 *     (node.renderLayer & pass.layerMask & camera.cullingMask) !== 0
 *
 * The engine ships only the `RenderLayer.{ None, Default, All }`
 * constants — every other bit's meaning is for the application to
 * define. This sample shows the convention by declaring a project-
 * local `GisLayer` mapping at file scope.
 */

// ─── Project-defined layer semantics (NOT part of the engine) ─────
// Application code owns the bit ↔ meaning mapping. Bit 0 is reserved
// for RenderLayer.Default (legacy / unassigned), so application bits
// start from bit 1.
const GisLayer = {
    Terrain:     1 << 1,
    GroundDecal: 1 << 2,
    World:       1 << 3,
    Water:       1 << 4,
    Transparent: 1 << 5,
    Overlay:     1 << 6,
} as const;

// ─── Custom renderer job: strict layer composition ────────────────
class GisRendererJob extends ForwardRendererJob {
    constructor(view: View3D) {
        super(view);

        // ColorPass renders strictly the opaque "world" layers. Default
        // (bit 0) is kept in the mask so any un-migrated node — like
        // engine-internal helpers that still default to RenderLayer.Default
        // — keeps rendering through ColorPass without explicit opt-in.
        const colorPass = this.graph.getPass<ColorPass>('ColorPass');
        if (colorPass) {
            colorPass.layerMask = RenderLayer.Default | GisLayer.Terrain | GisLayer.World;
        }

        // SortedTransparentPass owns water + project-defined transparent
        // overlays. Overlay HUD layer goes here too because it draws
        // with alpha and should render last.
        const sortedTr = this.graph.getPass<SortedTransparentPass>('SortedTransparentPass');
        if (sortedTr) {
            sortedTr.layerMask = GisLayer.Water | GisLayer.Transparent | GisLayer.Overlay;
        }

        // Shadow casters: everything except the screen-space HUD.
        // Removes Overlay billboards from the shadow map.
        const shadow = this.graph.getPass<ShadowPass>('ShadowPass');
        if (shadow) {
            shadow.layerMask = RenderLayer.remove(RenderLayer.All, GisLayer.Overlay);
        }

        this.graph.compile();
        console.log('[GisRendererJob] pass layer-masks:');
        for (const p of this.graph.passes) {
            console.log(`  ${p.name.padEnd(28)} layerMask=0x${(p.layerMask >>> 0).toString(16).padStart(8, '0')}`);
        }
    }
}

// ─── Sample driver ─────────────────────────────────────────────────
export class Sample_GISLayerComposition {
    private engine!: Engine3D;
    private scene!: Scene3D;

    async run(): Promise<void> {
        this.engine = await Engine3D.init({
            setting: {
                shadow: { autoUpdate: true, updateFrameRate: 1 },
            },
        });

        this.scene = new Scene3D();
        this.scene.addComponent(AtmosphericComponent);

        const camera = CameraUtil.createCamera3DObject(this.scene);
        camera.perspective(60, this.engine.aspect, 0.1, 1000);
        camera.object3D.addComponent(HoverCameraController).setCamera(45, -20, 35);

        // Demonstrate Camera3D.cullingMask too: drop the Overlay layer
        // from the main view's visible set. (Switch back to
        // RenderLayer.All to see the Overlay objects.)
        camera.cullingMask = RenderLayer.remove(RenderLayer.All, GisLayer.Overlay);
        console.log(`[main camera] cullingMask=0x${(camera.cullingMask >>> 0).toString(16).padStart(8, '0')} (Overlay layer hidden)`);

        const view = new View3D();
        view.scene = this.scene;
        view.camera = camera;
        this.engine.startRenderView(view, GisRendererJob);

        this.initScene();
    }

    private initScene(): void {
        // Sun
        const light = new Object3D();
        light.rotationX = 55;
        light.rotationY = 320;
        const dl = light.addComponent(DirectLight);
        dl.lightColor = KelvinUtil.color_temperature_to_rgb(5500);
        dl.intensity = 3;
        dl.castShadow = true;
        dl.enableCSM = true;
        this.scene.addChild(light);

        // Terrain — a large dark plane
        const terrain = new Object3D();
        const terrainMat = new LitMaterial();
        terrainMat.baseColor = new Color(0.28, 0.32, 0.26, 1);
        terrainMat.roughness = 0.9;
        const terrainMr = terrain.addComponent(MeshRenderer);
        terrainMr.geometry = new PlaneGeometry(40, 40);
        terrainMr.material = terrainMat;
        terrainMr.receiveShadow = true;
        // Project the node into the Terrain layer.
        terrainMr.renderLayer = GisLayer.Terrain;
        this.scene.addChild(terrain);

        // Buildings — 3 boxes in the World layer
        const tints: [number, number, number][] = [
            [0.85, 0.82, 0.78],
            [0.78, 0.82, 0.86],
            [0.86, 0.78, 0.74],
        ];
        const positions: Vector3[] = [
            new Vector3(-6, 2, -4),
            new Vector3(5, 3, -2),
            new Vector3(-2, 1.5, 4),
        ];
        for (let i = 0; i < 3; i++) {
            const obj = new Object3D();
            obj.localPosition = positions[i];
            const mat = new LitMaterial();
            mat.baseColor = new Color(tints[i][0], tints[i][1], tints[i][2], 1);
            mat.roughness = 0.5;
            mat.metallic = 0.05;
            const mr = obj.addComponent(MeshRenderer);
            mr.geometry = new BoxGeometry(3, positions[i].y * 2, 3);
            mr.material = mat;
            mr.castShadow = true;
            mr.receiveShadow = true;
            mr.renderLayer = GisLayer.World;
            this.scene.addChild(obj);
        }

        // Water — a transparent blue plane slightly above terrain
        const water = new Object3D();
        water.localPosition = new Vector3(10, 0.05, 6);
        const waterMat = new LitMaterial();
        waterMat.baseColor = new Color(0.2, 0.45, 0.8, 0.55);
        waterMat.blendMode = BlendMode.NORMAL;
        waterMat.transparent = true;
        const waterMr = water.addComponent(MeshRenderer);
        waterMr.geometry = new PlaneGeometry(10, 10);
        waterMr.material = waterMat;
        waterMr.renderLayer = GisLayer.Water;
        this.scene.addChild(water);

        // Overlay billboard — translucent red. With camera.cullingMask
        // configured to drop Overlay (above), this object stays hidden
        // in the main view. Flip the cullingMask back to RenderLayer.All
        // to confirm it shows up.
        const overlay = new Object3D();
        overlay.localPosition = new Vector3(0, 8, 0);
        const overlayMat = new LitMaterial();
        overlayMat.baseColor = new Color(1.0, 0.4, 0.3, 0.8);
        overlayMat.blendMode = BlendMode.NORMAL;
        overlayMat.transparent = true;
        const overlayMr = overlay.addComponent(MeshRenderer);
        overlayMr.geometry = new PlaneGeometry(4, 1);
        overlayMr.material = overlayMat;
        overlayMr.castShadow = false;
        overlayMr.renderLayer = GisLayer.Overlay;
        this.scene.addChild(overlay);

        // Diagnostic log so the layer assignment is visible without
        // having to inspect every node from the editor.
        const summary = [
            ['terrain', GisLayer.Terrain],
            ['buildings (x3)', GisLayer.World],
            ['water', GisLayer.Water],
            ['overlay billboard', GisLayer.Overlay],
        ] as const;
        console.log('[scene] layer assignments:');
        for (const [name, layer] of summary) {
            console.log(`  ${name.padEnd(20)} renderLayer=0x${(layer >>> 0).toString(16).padStart(8, '0')}`);
        }
    }
}
