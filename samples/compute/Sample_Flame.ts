
import { AtmosphericComponent, CameraUtil, DirectLight, Engine3D, HoverCameraController, Object3D, PlaneGeometry, Scene3D, Vector3, View3D } from "@orillusion/core";
import { GUIHelp } from "@orillusion/debug/GUIHelp";
import { FlameSimulator } from "./flame/FlameSimulator";
import { FlameSimulatorMaterial } from "./flame/FlameSimulatorMaterial";

export class Demo_Flame {
    engine: Engine3D;
    constructor() { }

    protected mLastPoint: Vector3 = new Vector3();
    protected mVelocity: Vector3 = new Vector3();

    async run() {
        const engine = this.engine = await Engine3D.init({});

        GUIHelp.init();

        let scene = new Scene3D();
        let sky = scene.addComponent(AtmosphericComponent);
        await this.initScene(scene);

        let camera = CameraUtil.createCamera3DObject(scene);

        camera.perspective(60, engine.context3D.aspect, 0.01, 10000.0);
        let ctl = camera.object3D.addComponent(HoverCameraController);
        ctl.setCamera(0, 0, 5);

        let view = new View3D();
        view.scene = scene;
        view.camera = camera;
        engine.startRenderView(view);
    }

    async initScene(scene: Scene3D) {
        let cesiumMan = await this.engine.res.loadGltf('gltfs/CesiumMan/CesiumMan.gltf');
        // cesiumMan.transform.localScale.set(10, 10, 10); // needs transform.apply()

        // The flame's drift direction is hard-coded in the simulator object's
        // model space (simulation.wgsl: `velocity = vec3(-3, 0, 0.5)`), and
        // copyBoneMatrix pulls the bone matrices into that same space — so the
        // simulator has to sit on a node whose axes line up with the body the
        // way they did when this sample was authored. CesiumMan's Z_UP/Armature
        // node matrices, which the loader used to discard, now rotate the body
        // *inside* the glTF wrapper, so the wrapper is no longer that node:
        // re-orienting it would either lay the model down or send the flame off
        // sideways. Keep the authored orientation on a holder that hosts the
        // simulator, and cancel the node chain (90, 0, 90) on the wrapper below
        // it — the body then sits upright and identity-aligned in holder space,
        // exactly as before.
        let flameRoot = new Object3D();
        flameRoot.rotationX = -90;
        flameRoot.rotationY = 180;
        flameRoot.y = -0.8;
        cesiumMan.rotationX = 90;
        cesiumMan.rotationZ = 90;
        flameRoot.addChild(cesiumMan);
        scene.addChild(flameRoot);

        // {
        //     let obj = new Object3D();
        //     obj.y = -1;
        //     obj.z = -10;
        //     let mr = obj.addComponent(MeshRenderer);
        //     mr.geometry = new PlaneGeometry(100, 100, 1, 1, Vector3.Y_AXIS);
        //     mr.material = new LitMaterial();
        //     mr.castShadow = true;
        //     mr.receiveShadow = true;
        //     scene.addChild(obj);
        // }

        {
            let obj = new Object3D();
            obj.rotationX = 120;
            obj.rotationY = 306;
            let light = obj.addComponent(DirectLight);
            light.intensity = 5;
            light.castShadow = true;
            scene.addChild(obj);
        }

        let emulation = flameRoot.addComponent(FlameSimulator);
        emulation.alwaysRender = true;
        emulation.geometry = new PlaneGeometry(0.01, 0.01, 1.0, 1.0, Vector3.Z_AXIS);
        emulation.material = new FlameSimulatorMaterial();

    }

    async initComputeBuffer() { }
}
