import { Object3D, Scene3D, Engine3D, Vector3, PostProcessingComponent, SSGIPost, View3D, CameraUtil, HoverCameraController, PointLight } from "@orillusion/core";
import { GUIHelp } from "@orillusion/debug/GUIHelp";
import { GUIUtil } from "@samples/utils/GUIUtil";

// SSGI test bench: the Cornell box scene from Sample_GICornellBox (same
// gltf, scale, camera and ceiling point light) but without the DDGI
// probe volume — the bitmask SSGI post provides the indirect term.
// With SSGI disabled only the directly lit surfaces show; enabling it
// adds the screen-space bounce (red/green wall color onto the boxes and
// floor, contact AO in the corners).
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
                    // No AtmosphericComponent is added, and the non-GI
                    // environment term is zeroed so the point light and
                    // the lamp quad are the only sources.
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

        GUIHelp.init();
        let postProcessing = this.scene.addComponent(PostProcessingComponent);
        let ssgi = postProcessing.addPost(SSGIPost);
        // World-space stepping sized to the cavity: the interior is ~20
        // units (2x2x2 mesh scaled by 10), so a floor texel can gather
        // wall and ceiling radiance from across the box.
        ssgi.radius = 16;
        // The reference default (10) is tuned for the demo's
        // dimmer beauty pass; this cavity's HDR point light already
        // carries several units of radiance, so keep the bounce near its
        // physical scale.
        ssgi.giIntensity = 10;
        GUIUtil.renderSSGI(ssgi, true);

        // A/B the tonemap: with the default ACES curve the added bounce
        // shifts wall hues near the lamp; 'None' shows the raw energy.
        GUIHelp.addFolder('Tonemap');
        let tonemapState = { ACES: true };
        GUIHelp.add(tonemapState, 'ACES').onChange((v: boolean) => {
            this.engine.setting.render.tonemap.mode = v ? 'ACES' : 'None';
        });
        GUIHelp.endFolder();

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
        pointLight.intensity = 0.1;
        pointLight.range = 45;
        pointLight.castShadow = true;
        // Acne fix: ~1 world unit (5% of the cavity) clears
        // grazing-incidence self-shadowing without visible
        // peter-panning at the box/floor contacts.
        pointLight.shadowBias = 1.0;
        pointLight.normalBias = 1.0;
        this.scene.addChild(lightObj);

        GUIHelp.addFolder('PointLight');
        GUIHelp.add(pointLight, 'intensity', 0, 10, 0.01);
        GUIHelp.add(pointLight, 'range', 1, 100, 1);
        GUIHelp.add(lightObj, 'y', 1, 19, 0.1);
        GUIHelp.endFolder();
    }
}

new Sample_SSGICornellBox().run();
