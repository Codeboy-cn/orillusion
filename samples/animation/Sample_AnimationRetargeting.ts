/**
 * Port of three.js `webgpu_animation_retargeting`.
 *
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
 *
 * GUI parity with three.js (single root toggle):
 *   helpers.visible — labeled "show helpers" — toggles whether the source
 *                     character is visible. (Three.js uses it to toggle
 *                     SkeletonHelper visibility; we toggle the source mesh
 *                     so the user can see the *retargeted* character alone.)
 */
import { GUIHelp } from "@orillusion/debug/GUIHelp";
import {
    Object3D, Scene3D, Engine3D, AtmosphericComponent, CameraUtil,
    HoverCameraController, View3D, DirectLight, KelvinUtil,
    Object3DUtil, AnimatorComponent, Retargeter, MeshRenderer,
    PostProcessingComponent, FXAAPost, Vector3, SkinnedMeshRenderer2,
} from "@orillusion/core";

class Sample_AnimationRetargeting {
    engine: Engine3D;
    scene: Scene3D;
    light: Object3D;

    sourceRoot: Object3D;
    sourceAnimator: AnimatorComponent;
    targetAnimator: AnimatorComponent;
    retargeter: Retargeter;

    helpers = { visible: true };

    async run() {
        const engine = this.engine = await Engine3D.init({
            renderLoop: () => this.onTick(),
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

        // Floor (three.js places both characters on a small ground plane).
        this.scene.addChild(Object3DUtil.GetSingleCube(40, 0.2, 40, 0.6, 0.6, 0.6));

        // Light
        this.light = new Object3D();
        this.light.y = 8; this.light.z = 5;
        this.light.rotationX = 144;
        const dl = this.light.addComponent(DirectLight);
        dl.lightColor = KelvinUtil.color_temperature_to_rgb(5800);
        dl.castShadow = true; dl.intensity = 2.5;
        dl.shadowBoundFar = 30;
        this.scene.addChild(this.light);

        // ---------- Source: Michelle (plays SambaDance) ----------
        this.sourceRoot = await this.engine.res.loadGltf('gltfs/three/Michelle.glb');
        this.scene.addChild(this.sourceRoot);
        // Set position AFTER addChild so the transform is hooked into the
        // scene's update graph — assigning .x on a parent-less Object3D
        // sometimes doesn't propagate before the first scene update.
        // Stand them ~3.5 m apart (Mixamo characters are ~1.8 m tall and
        // their dance / idle poses can swing arms across ±0.6 m), facing
        // each other so the retargeting symmetry reads at a glance.
        this.sourceRoot.x = -1.8;
        this.sourceRoot.rotationY = 90;          // face +X (toward Soldier)
        this.sourceAnimator = this.sourceRoot.getComponentsInChild(AnimatorComponent)[0];
        this.sourceAnimator.playAnim('SambaDance');

        // ---------- Target: Soldier (no own animation; driven by retargeter) ----------
        const targetRoot = await this.engine.res.loadGltf('gltfs/three/Soldier.glb');
        this.scene.addChild(targetRoot);
        targetRoot.x = 1.8;
        targetRoot.rotationY = -90;              // face -X (toward Michelle)
        this.targetAnimator = targetRoot.getComponentsInChild(AnimatorComponent)[0];
        // Silence the target's own animator so the retargeter is the
        // sole driver of the bones. `clipState.weight = 0` alone is
        // not enough — `AnimatorComponent.updateSkeletonAnim` writes
        // bone localPosition/Rotation from the current clip's curves
        // unconditionally each frame, ignoring weight. Null out the
        // current clip so the per-frame write is skipped entirely.
        for (const cs of this.targetAnimator.clipsState) cs.weight = 0;
        (this.targetAnimator as any)._currentSkeletonClip = null;
        await new Promise(r => setTimeout(r, 200));
        // Force-rebind every SMR within each root to its rightful Animator.
        // The glTF loader's `_pendingSkinned` queue is per-skin; when a
        // single character has multiple skins (Soldier has body skin +
        // visor skin), the SMR for one skin can race the animator wiring
        // and end up bound to a stale / cross-character animator. Iterate
        // each root explicitly here to guarantee correctness.
        const fixSMRBindings = (root: Object3D, anim: AnimatorComponent) => {
            const stack = [root];
            while (stack.length) {
                const cur = stack.pop()!;
                const comps = (cur as any).components;
                if (comps?.values) {
                    for (const c of comps.values()) {
                        if ((c as any)?.constructor?.name === 'SkinnedMeshRenderer2') {
                            (c as any).skeletonAnimation = anim;
                        }
                    }
                }
                for (const ch of (cur.entityChildren ?? []) as Object3D[]) stack.push(ch);
            }
        };
        fixSMRBindings(this.sourceRoot, this.sourceAnimator);
        fixSMRBindings(targetRoot, this.targetAnimator);
        // Probe AnimatorComponent's root joint worldPosition — that's
        // what drives the SkinnedMesh shader (mesh node transform is
        // ignored per glTF skinning spec).
        const sRootJoint = (this.sourceAnimator as any).root as Object3D;
        const tRootJoint = (this.targetAnimator as any).root as Object3D;
        if (sRootJoint) {
            const w = sRootJoint.transform.worldPosition;
            const p = sRootJoint.parent?.object3D as any;
            console.log(`  source root joint '${sRootJoint.name}' parent='${p?.name ?? '?'}' wp=(${w.x.toFixed(3)},${w.y.toFixed(3)},${w.z.toFixed(3)})`);
        }
        if (tRootJoint) {
            const w = tRootJoint.transform.worldPosition;
            const p = tRootJoint.parent?.object3D as any;
            console.log(`  target root joint '${tRootJoint.name}' parent='${p?.name ?? '?'}' wp=(${w.x.toFixed(3)},${w.y.toFixed(3)},${w.z.toFixed(3)})`);
        }
        // Dump scene tree
        const dump = (obj: any, depth: number) => {
            const wp = obj.transform?.worldPosition;
            const ls = obj.transform?.localScale;
            const renderers: string[] = [];
            for (const c of obj.components ?? new Map()) {
                const name = c[0]?.name || '?';
                if (name.includes('Renderer') || name.includes('MeshRenderer') || name.includes('Animator') || name.includes('Light') || name.includes('Camera')) {
                    renderers.push(name);
                }
            }
            const ren = renderers.length ? `[${renderers.join(',')}]` : '';
            const wpStr = wp ? `wp=(${wp.x.toFixed(2)},${wp.y.toFixed(2)},${wp.z.toFixed(2)})` : '';
            const lsStr = ls && (ls.x !== 1 || ls.y !== 1 || ls.z !== 1) ? `ls=(${ls.x.toFixed(3)},${ls.y.toFixed(3)},${ls.z.toFixed(3)})` : '';
            console.log(`${'  '.repeat(depth)}${obj.name || '?'} ${ren} ${wpStr} ${lsStr}`);
            for (const child of obj.entityChildren ?? []) dump(child, depth + 1);
        };
        console.log('========= SCENE TREE =========');
        dump(this.scene, 0);
        console.log('========= END SCENE TREE =========');


        // Both rigs use the `mixamorig:` prefix → exact-name match resolves
        // every bone. No name map needed.
        this.retargeter = new Retargeter({
            source: this.sourceAnimator,
            target: this.targetAnimator,
        });
        const mapping = this.retargeter.resolvedMapping;
        console.log(`[retarget] resolved ${mapping.length} same-name bone pairs (Mixamo → Mixamo)`);

        this._buildGUI();
        return true;
    }

    private _buildGUI() {
        // Match three.js: one toggle, "show helpers".
        GUIHelp.add(this.helpers, 'visible').name('show helpers').onChange((v: boolean) => {
            // Toggle the source mesh visibility — gives the same "isolate the
            // retargeted character" UX as three.js's helper toggle.
            const renderers = this.sourceRoot.getComponentsInChild(MeshRenderer);
            for (const r of renderers) r.enable = v;
        });
    }

    onTick() {
        if (this.retargeter) this.retargeter.apply();
    }
}

new Sample_AnimationRetargeting().run();
