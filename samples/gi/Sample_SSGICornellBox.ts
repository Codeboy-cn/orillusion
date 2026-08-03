import { Object3D, Scene3D, Engine3D, Vector3, PostProcessingComponent, SSGIPost, View3D, CameraUtil, HoverCameraController, PointLight } from "@orillusion/core";
import { GUIHelp } from "@orillusion/debug/GUIHelp";
import { GUIUtil } from "@samples/utils/GUIUtil";

// SSGI test bench: the Cornell box from Sample_GICornellBox lit by a
// single point light under the ceiling — no DirectLight, no atmospheric
// sky, no bloom, and the gltf's emissive lamp quad is turned off. With
// SSGI disabled only the directly lit surfaces show; enabling it adds
// the single screen-space bounce (wall color onto boxes and floor,
// fill in the shadowed regions).
class Sample_SSGICornellBox {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;
    async run() {

        const engine = this.engine = await Engine3D.init({
            setting: {
                render: {
                    debug: true,
                },
                sky: {
                    // No AtmosphericComponent is added, but the non-GI
                    // environment term still samples the default prefilter
                    // map — zero it so the point light is the only source.
                    skyExposure: 0,
                },
            },
        });

        this.scene = new Scene3D();

        let camera = CameraUtil.createCamera3DObject(this.scene);
        camera.perspective(45, engine.aspect, 0.01, 1000.0);
        let ctrl = camera.object3D.addComponent(HoverCameraController);
        ctrl.setCamera(0, 0, 26, new Vector3(0, 10, 0));

        let view = new View3D();
        view.scene = this.scene;
        view.camera = camera;
        this.view = view;
        engine.startRenderViews([view]);

        GUIHelp.init();
        let postProcessing = this.scene.addComponent(PostProcessingComponent);
        let ssgi = postProcessing.addPost(SSGIPost);
        // Interior cavity is ~20 world units (2x2x2 mesh scaled by 10);
        // span it so floor bounce can reach the ceiling and walls.
        ssgi.radius = 28;
        // With a real light in the cavity the frame carries far more
        // energy than the emissive-only variant did — keep the bounce
        // near its physical scale.
        ssgi.intensity = 1.5;
        // Cavity-spanning radius scatters taps across the whole frame
        // (cache-hostile), so keep the per-frame budget minimal and let
        // temporal accumulation integrate the variance. Bigger budgets
        // saturate the GPU at this resolution.
        ssgi.sliceCount = 2;
        ssgi.stepCount = 4;
        ssgi.hysteresis = 0.98;
        GUIUtil.renderSSGI(ssgi, true);

        await this.initScene();
    }

    async initScene() {
        let box = await this.engine.res.loadGltf('gltfs/cornellBox/cornellBox.gltf') as Object3D;
        box.localScale = new Vector3(10, 10, 10);
        // The ceiling quad keeps its gltf emissive: together with the
        // point light it acts as a second (area) radiance source that
        // SSGI picks up from the screen.
        this.scene.addChild(box);

        // Point light just below the ceiling lamp quad (cavity is
        // x,z in [-10,10], y in [0,20] after the 10x scale).
        let lightObj = new Object3D();
        lightObj.y = 19;
        let pointLight = lightObj.addComponent(PointLight);
        pointLight.intensity = 0.8;
        pointLight.range = 45;
        pointLight.castShadow = true;
        // The rotated boxes put several faces at grazing incidence to the
        // light where the auto-resolved bias still self-shadows (moire
        // acne); ~1 world unit (5% of the cavity) clears it here without
        // visible peter-panning at the box/floor contacts.
        pointLight.shadowBias = 1.0;
        pointLight.normalBias = 1.0;
        this.scene.addChild(lightObj);

        GUIHelp.addFolder('PointLight');
        GUIHelp.add(pointLight, 'intensity', 0, 50, 0.1);
        GUIHelp.add(pointLight, 'range', 1, 100, 1);
        GUIHelp.add(lightObj, 'y', 1, 19, 0.1);
        GUIHelp.endFolder();
    }
}

new Sample_SSGICornellBox().run();
