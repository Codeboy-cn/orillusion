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
 *
 * The ground plane is a PlaneGeometry rendered with a custom mirror
 * material. A second camera below the plane (mirror image of the main
 * camera) renders the scene every frame into a SceneCapture RT; the
 * floor's shader samples that RT in screen space, producing a true
 * planar reflection of both characters.
 */
import { GUIHelp } from "@orillusion/debug/GUIHelp";
import {
    Object3D, Scene3D, Engine3D, AtmosphericComponent, CameraUtil,
    HoverCameraController, View3D, DirectLight, KelvinUtil,
    AnimatorComponent, MeshRenderer,
    PostProcessingComponent, FXAAPost, Vector3, Vector4,
    Camera3D, ComponentBase, Color, PlaneGeometry,
    Material, Shader, RenderShaderPass, PassType, ShaderLib,
    SceneCaptureCameraComponent, RendererMaskUtil,
    GPUCullMode,
} from "@orillusion/core";
import { GUIUtil } from "@samples/utils/GUIUtil";

// ---------------------------------------------------------------------------
// Mirror shader / material — sample-local. Samples the SceneCapture RT in
// screen-space coordinates so the floor reflects what the mirror camera
// sees pixel-for-pixel (the canonical planar-reflection trick).
// ---------------------------------------------------------------------------

const MirrorShaderSource = /* wgsl */ `
    #include "Common_vert"
    #include "Common_frag"
    #include "UnLit_frag"
    #include "UnLitMaterialUniform_frag"

    @group(1) @binding(auto)
    var mirrorMap_Sampler: sampler;
    @group(1) @binding(auto)
    var mirrorMap: texture_2d<f32>;

    fn vert(inputData: VertexAttributes) -> VertexOutput {
        ORI_Vert(inputData);
        return ORI_VertexOut;
    }

    fn frag() {
        // fragPosition = clip-space; xy/w → NDC in [-1,1].
        var ndc = ORI_VertexVarying.fragPosition.xy / ORI_VertexVarying.fragPosition.w;
        // Y: NDC y is bottom-up (+1 = top); WebGPU texture v is top-down
        // (0 = top), so map (1 - ndc.y) * 0.5.
        // X: the mirror camera is the y-mirror of the main camera and
        // both aim at the same world point — they look at the world from
        // opposite ends along Y, which swaps left/right in the captured
        // image relative to main-camera screen coords. Flip X here so
        // the world-X to floor-pixel mapping is consistent (without it,
        // the left character's foot reflects the right character).
        var uv = vec2<f32>((1.0 - ndc.x) * 0.5, (1.0 - ndc.y) * 0.5);
        let mirror = textureSample(mirrorMap, mirrorMap_Sampler, uv);
        // Tint via baseColor lets the demo dim the reflection (so the
        // floor reads as glossy, not 1:1 photo-mirror).
        ORI_ShadingInput.BaseColor = vec4<f32>(mirror.rgb * materialUniform.baseColor.rgb, 1.0);
        UnLit();
    }
`;

class MirrorShader extends Shader {
    constructor() {
        super();
        // Register the WGSL source under a stable name so RenderShaderPass
        // can resolve it. Idempotent — register no-ops if called twice.
        ShaderLib.register('MirrorShaderSource', MirrorShaderSource);
        const colorPass = new RenderShaderPass('MirrorShaderSource', 'MirrorShaderSource');
        colorPass.passType = PassType.COLOR;
        colorPass.setShaderEntry('VertMain', 'FragMain');
        // Adding the pass to the shader BEFORE Material.set shader runs
        // is mandatory: Material's setter immediately calls
        // getDefaultShaders()[0], which throws on an empty Shader. Doing
        // the wiring inside this Shader subclass's constructor mirrors
        // UnLitShader / StandShader and keeps Material.set shader happy.
        this.addRenderPass(colorPass);

        const ss = colorPass.shaderState;
        ss.acceptShadow = false;
        ss.castShadow = false;
        ss.receiveEnv = false;
        ss.acceptGI = false;
        ss.useLight = false;
        // Floor is one-sided: cull the underside so the mirror camera
        // (positioned below the floor) doesn't render the floor's back
        // face into its own reflection.
        ss.cullMode = GPUCullMode.back;

        // `UnLitMaterialUniform_frag` declares MaterialUniform with these
        // four fields; uniforms must be supplied in the same order so the
        // packed uniform buffer layout matches the shader's struct.
        this.setUniformVector4('transformUV1', new Vector4(0, 0, 1, 1));
        this.setUniformVector4('transformUV2', new Vector4(0, 0, 1, 1));
        this.setUniformColor('baseColor', new Color(1, 1, 1, 1));
        this.setUniformFloat('alphaCutoff', 0);
    }
}

class MirrorMaterial extends Material {
    constructor() {
        super();
        this.shader = new MirrorShader();
    }

    public setMirrorTexture(tex: any): void {
        this.shader.setTexture('mirrorMap', tex);
    }

    public setTint(c: Color): void {
        this.shader.setUniformColor('baseColor', c);
    }
}

// ---------------------------------------------------------------------------
// Mirror tracker — keeps the capture camera as a y=0 reflection of the main
// camera every frame.
// ---------------------------------------------------------------------------

class MirrorCameraTracker extends ComponentBase {
    public mainCamera!: Camera3D;
    /** Pivot point the main camera is looking at (e.g. orbit center of
     *  HoverCameraController). The mirror camera looks at the reflection
     *  of this point across the mirror plane. Set to the same value the
     *  user passed to `setCamera(target=…)`. */
    public mainTarget: Vector3 = new Vector3(0, 0, 0);
    /** Mirror plane height (world Y). Default: ground at y=0. */
    public mirrorY: number = 0;

    private _mirrorPos = new Vector3();
    private _mirrorTarget = new Vector3();
    private _mirrorUp = new Vector3(0, -1, 0);

    public onUpdate(): void {
        if (!this.mainCamera) return;

        // Read the main camera's world position out of its transform.
        // We don't need the basis vectors — reflecting position +
        // look-at point across y=mirrorY is enough to reconstruct a
        // valid mirror view, and using HoverCameraController's pivot
        // as the look-at avoids the matrix-column-convention pitfall
        // (different engines disagree on whether camera-forward is the
        // +Z or -Z column of the world matrix).
        const wp = this.mainCamera.transform.worldPosition;

        const py = 2 * this.mirrorY - wp.y;
        this._mirrorPos.set(wp.x, py, wp.z);

        const ty = 2 * this.mirrorY - this.mainTarget.y;
        this._mirrorTarget.set(this.mainTarget.x, ty, this.mainTarget.z);

        // Reflecting across +Y flips the up vector → (0,-1,0). Without
        // this lookAt would still produce a valid orthonormal frame
        // but the resulting reflection RT would be vertically flipped
        // relative to the main-camera screen — half the planar-mirror
        // pixels would then read wrong rows.
        this.transform.lookAt(this._mirrorPos, this._mirrorTarget, this._mirrorUp);
        this.transform.localPosition = this._mirrorPos;
        this.transform.updateWorldMatrix(true);
    }
}

// ---------------------------------------------------------------------------
// Sample.
// ---------------------------------------------------------------------------

const FLOOR_MASK_BIT = 1 << 11;

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

        await this.initScene(camera);
        sky.relativeTransform = this.light.transform;
    }

    async initScene(mainCamera: Camera3D) {
        GUIHelp.init();

        // Light first — we want shadows in the mirror reflection too.
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

        // Mirror camera node — sits below the floor, kept in sync with
        // the main camera every frame by MirrorCameraTracker. Add the
        // SceneCaptureCameraComponent to render the scene from the
        // mirror viewpoint into an RT.
        const mirrorCamRoot = new Object3D();
        const mirrorCam = mirrorCamRoot.addComponent(Camera3D);
        mirrorCam.perspective(45, this.engine.aspect, 0.1, 100);
        const cap = mirrorCamRoot.addComponent(SceneCaptureCameraComponent);
        cap.width = 1024;
        cap.height = 1024;
        cap.clearColor = new Color(0.5, 0.6, 0.7, 1);
        cap.includeSky = true;
        cap.includeTransparent = true;
        // Floor renderer gets FLOOR_MASK_BIT (below); excluding it from
        // the capture prevents the mirror from showing the floor's
        // own back-face fill as a "reflection of the floor".
        cap.excludeMask = FLOOR_MASK_BIT;
        const tracker = mirrorCamRoot.addComponent(MirrorCameraTracker);
        tracker.mainCamera = mainCamera;
        // HoverCameraController orbits around (0, 1.0, 0); reflecting
        // that point across y=0 is the look-at the mirror camera should
        // aim at. Keep these two in sync if you change the main camera.
        tracker.mainTarget = new Vector3(0, 1.0, 0);
        tracker.mirrorY = 0;
        this.scene.addChild(mirrorCamRoot);

        // Ground plane.
        {
            const floor = new Object3D();
            const mr = floor.addComponent(MeshRenderer);
            mr.geometry = new PlaneGeometry(40, 40);
            const mat = new MirrorMaterial();
            mat.setTint(new Color(0.85, 0.9, 1.0, 1));
            mr.material = mat;
            // Custom self-bit so the capture skips the floor (otherwise
            // the floor's own back face renders into the reflection RT
            // and we'd see the floor reflecting itself).
            mr.rendererMask = RendererMaskUtil.addMask(mr.rendererMask, FLOOR_MASK_BIT);
            this.scene.addChild(floor);

            // Wire the capture RT into the mirror material once allocated.
            // SceneCaptureCameraComponent allocates lazily on first
            // execute; by the time initScene returns we've usually had
            // one frame of capture. Wait briefly then bind.
            setTimeout(() => {
                const tex = cap.getCaptureTexture();
                if (tex) mat.setMirrorTexture(tex);
                else console.warn('[Sample_AnimationRetargeting] capture RT not yet allocated when binding mirror — try increasing the timeout.');
            }, 100);
        }

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
