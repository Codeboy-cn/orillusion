/**
 * Loads two Mixamo characters from `models/gltf/`:
 *
 *   Source : `Michelle.glb`  — comes with a baked SambaDance + TPose.
 *   Target : `Soldier.glb`   — same Mixamo bone names, but a different mesh
 *                              (and slightly different rest pose).
 *
 * Each frame, the source's bone rotations are copied onto the target's
 * skeleton via `Retargeter`. Both rigs share the `mixamorig:` prefix on
 * every bone, so the retargeter's exact-name pass resolves all 67 bones
 * without needing an explicit name map.
 */
import { GUIHelp } from "@orillusion/debug/GUIHelp";
import {
    Object3D, Scene3D, Engine3D, AtmosphericComponent, CameraUtil,
    HoverCameraController, View3D, DirectLight, KelvinUtil,
    Object3DUtil, AnimatorComponent, Retargeter, MeshRenderer,
    PostProcessingComponent, FXAAPost, Vector3,
} from "@orillusion/core";
import { GUIUtil } from "@samples/utils/GUIUtil";

class Sample_AnimationRetargeting {
    engine: Engine3D;
    scene: Scene3D;
    light: Object3D;

    sourceRoot: Object3D;
    sourceAnimator: AnimatorComponent;
    targetAnimator: AnimatorComponent;

    helpers = { visible: true };

    async run() {
        const engine = this.engine = await Engine3D.init({
            setting: { shadow: { autoUpdate: true, updateFrameRate: 1, shadowSize: 2048 } },
        });
        this.scene = new Scene3D();
        const sky = this.scene.addComponent(AtmosphericComponent);

        const camera = CameraUtil.createCamera3DObject(this.scene);
        camera.perspective(45, engine.aspect, 0.1, 100);
        const ctrl = camera.object3D.addComponent(HoverCameraController);
        // Frame both characters: 3.5 m gap on X, ~1.8 m tall — pull
        // camera back to ~7 m so both fit, target at the midpoint.
        ctrl.setCamera(0, -10, 7, new Vector3(0, 1.0, 0));
        ctrl.maxDistance = 30;

        const view = new View3D();
        view.scene = this.scene;
        view.camera = camera;
        engine.startRenderView(view);

        const post = this.scene.addComponent(PostProcessingComponent);
        post.addPost(FXAAPost);

        await this.initScene();
        sky.relativeTransform = this.light.transform;
    }

    async initScene() {
        GUIHelp.init();

        // add ground plane.
        this.scene.addChild(Object3DUtil.GetSingleCube(40, 0.2, 40, 0.6, 0.6, 0.6));

        // Light
        this.light = new Object3D();
        this.light.y = 8; this.light.z = 5;
        this.light.rotationX = 144;
        const dl = this.light.addComponent(DirectLight);
        dl.lightColor = KelvinUtil.color_temperature_to_rgb(5800);
        dl.castShadow = true; 
        dl.intensity = 2.5;
        dl.shadowBoundFar = 30;
        dl.enableCSM = true;
        this.scene.addChild(this.light);
        GUIUtil.renderDirLight(dl);

        // ---------- Source: Michelle (plays SambaDance) ----------
        // Michelle's glTF Character holds rotationX = +90°, Soldier's
        // holds -90°, so their TPose hip worlds face opposite world
        // directions. The Retargeter's `alignTPoseFacing` (default on)
        // pre-multiplies a one-shot rotation into Soldier's Character
        // node so his bind hip world matches Michelle's, then runs
        // naive world-copy retargeting so Soldier's bones overlay
        // Michelle's at every frame.
        this.sourceRoot = await this.engine.res.loadGltf('gltfs/three/Michelle.glb');
        this.scene.addChild(this.sourceRoot);
        this.sourceRoot.x = -1.0;
        this.sourceRoot.rotationY = 90;
        this.sourceAnimator = this.sourceRoot.getComponentsInChild(AnimatorComponent)[0];
        this.sourceAnimator.playAnim('SambaDance');

        // ---------- Target: Soldier (no own animation; driven by retargeter) ----------
        const targetRoot = await this.engine.res.loadGltf('gltfs/three/Soldier.glb');
        this.scene.addChild(targetRoot);
        targetRoot.x = 1.0;
        targetRoot.rotationY = -90;
        this.targetAnimator = targetRoot.getComponentsInChild(AnimatorComponent)[0];

        this.sourceAnimator.retargetTo(this.targetAnimator);

        this._buildGUI();
        return true;
    }

    private _buildGUI() {
        // one toggle, "show helpers".
        GUIHelp.add(this.helpers, 'visible').name('show helpers').onChange((v: boolean) => {
            // Toggle the source mesh visibility — gives the same "isolate the
            // retargeted character" UX helper toggle.
            const renderers = this.sourceRoot.getComponentsInChild(MeshRenderer);
            for (const r of renderers) r.enable = v;
        });
    }
}

new Sample_AnimationRetargeting().run();
