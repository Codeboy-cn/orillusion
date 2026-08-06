import { Object3D, Scene3D, Engine3D, Vector3, View3D, CameraUtil, HoverCameraController, PointLight } from "@orillusion/core";

// Software-ray-traced DDGI counterpart of Sample_GICornellBox: the SAME
// scene (Cornell box, emissive lamp quad, one point light under the
// ceiling, no DirectLight, skyExposure 0) with setting.gi.rayTracing on.
// Probe updates run through the BVH trace + octahedral blend compute
// path instead of the cube-capture GBuffer, so no probe entities /
// GlobalIlluminationComponent are needed — the probe grid comes from the
// gi settings alone. Camera matches the raster bench so the same pixel
// regression coordinates apply (_gi_rt_cornell_check.mjs).
class Sample_GIRTCornellBox {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;
    async run() {
        const engine = this.engine = await Engine3D.init({
            setting: {
                gi: {
                    enable: true,
                    rayTracing: true,
                    probeYCount: 3,
                    probeXCount: 3,
                    probeZCount: 3,
                    offsetX: 0,
                    // Same probe placement as the raster bench: keeps the
                    // lower probe row out of the boxes' bottom band.
                    offsetY: 9.5,
                    offsetZ: 0,
                    indirectIntensity: 1,
                    // Energy-exact single-bounce feedback; the traced path
                    // uses the identical MultiBounce convention.
                    bounceIntensity: 1.0,
                    maxDistance: 16,
                    probeSpace: 8.38,
                    normalBias: 0.25,
                    probeSize: 32,
                    octRTSideSize: 32,
                    octRTMaxSize: 2048,
                    ddgiGamma: 2.2,
                    depthSharpness: 18,
                    autoRenderProbe: true,
                },
                sky: {
                    skyExposure: 0,
                },
            },
        });

        this.scene = new Scene3D();

        let camera = CameraUtil.createCamera3DObject(this.scene);
        camera.perspective(45, engine.aspect, 0.01, 1000.0);
        let ctrl = camera.object3D.addComponent(HoverCameraController);
        ctrl.setCamera(0, 0, 30, new Vector3(0, 10, 0));

        let view = new View3D();
        view.scene = this.scene;
        view.camera = camera;
        this.view = view;
        engine.startRenderViews([view]);

        await this.initScene();
    }

    async initScene() {
        let box = await this.engine.res.loadGltf('gltfs/cornellBox/cornellBox.gltf') as Object3D;
        box.localScale = new Vector3(10, 10, 10);
        this.scene.addChild(box);

        // Point light just below the ceiling lamp quad — identical to the
        // raster bench. castShadow stays off: the traced path shadows with
        // BVH rays, and the camera pass direct term is unaffected by GI.
        let lightObj = new Object3D();
        lightObj.y = 19;
        let pointLight = lightObj.addComponent(PointLight);
        pointLight.intensity = 0.1;
        pointLight.range = 45;
        pointLight.castShadow = true;
        pointLight.shadowBias = 1.0;
        pointLight.normalBias = 1.0;
        this.scene.addChild(lightObj);
    }
}

new Sample_GIRTCornellBox().run();
