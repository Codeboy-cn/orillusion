import { createExampleScene, createSceneParam } from "@samples/utils/ExampleScene";
import { Object3D, Scene3D, Engine3D, GlobalIlluminationComponent, Vector3, PostProcessingComponent, BloomPost, View3D } from "@orillusion/core";
import { GUIHelp } from "@orillusion/debug/GUIHelp";

// Orbit diagnostic: __VERIFY_MODE '0'..'7' selects a 45-degree step around
// the Y axis; the camera looks at the box center from outside.
class Sample_ZZOrbit {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;
    async run() {
        const engine = this.engine = await Engine3D.init({
            setting: {
                gi: {
                    enable: true, debug: true,
                    probeYCount: 6, probeXCount: 6, probeZCount: 6,
                    offsetX: 0, offsetY: 10, offsetZ: 0,
                    indirectIntensity: 1, bounceIntensity: 1.0,
                    lerpHysteresis: 0.02, maxDistance: 16, probeSpace: 6,
                    normalBias: 0.25, probeSize: 32, octRTSideSize: 16,
                    octRTMaxSize: 2048, ddgiGamma: 2.2, depthSharpness: 50,
                    autoRenderProbe: true,
                },
                shadow: { shadowSize: 2048, autoUpdate: true, updateFrameRate: 1 },
                sky: { skyExposure: 0.2 },
            },
        });
        let param = createSceneParam();
        param.camera.distance = 100;
        let exampleScene = createExampleScene(engine, param);
        const mode = Number((globalThis as any).__VERIFY_MODE || '0');
        exampleScene.hoverCtrl.setCamera(mode * 45, -12, 70, new Vector3(0, 10, 0));
        this.scene = exampleScene.scene;
        this.view = exampleScene.view;
        engine.startRenderViews([exampleScene.view]);

        let probeObj = new Object3D();
        GUIHelp.init();
        probeObj.addComponent(GlobalIlluminationComponent, this.view.scene);
        this.scene.addChild(probeObj);

        let postProcessing = this.scene.addComponent(PostProcessingComponent);
        postProcessing.addPost(BloomPost);

        let box = await this.engine.res.loadGltf('gltfs/cornellBox/cornellBox.gltf') as Object3D;
        box.localScale = new Vector3(10, 10, 10);
        this.scene.addChild(box);
    }
}

new Sample_ZZOrbit().run();
