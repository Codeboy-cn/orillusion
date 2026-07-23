import { createExampleScene, createSceneParam } from "@samples/utils/ExampleScene";
import { Object3D, Scene3D, Engine3D, GlobalIlluminationComponent, Vector3, GTAOPost, PostProcessingComponent, BloomPost, View3D } from "@orillusion/core";
import { GUIHelp } from "@orillusion/debug/GUIHelp";
import { GUIUtil } from "@samples/utils/GUIUtil";

class Sample_GICornellBox {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;
    async run() {

        const engine = this.engine = await Engine3D.init({
            setting: {
                material: {
                    materialChannelDebug: true,
                    materialDebug: false,
                },
                gi: {
                    enable: true,
                    debug: true,
                    probeYCount: 6,
                    probeXCount: 6,
                    probeZCount: 6,
                    offsetX: 0,
                    offsetY: 10,
                    offsetZ: 0,
                    indirectIntensity: 1,
                    // The colored walls receive almost no direct sunlight —
                    // they are lit by the emissive ceiling quad through the
                    // multi-bounce feedback loop, which also carries their
                    // reflected color into the probes. 1.0 = energy-exact
                    // single-bounce feedback (see MultiBouncePass_cs).
                    bounceIntensity: 1.0,
                    lerpHysteresis: 0.02,
                    maxDistance: 16,
                    probeSpace: 6,
                    // Shifts the visibility-test sample point off the surface
                    // toward the viewer: surfaceBias = (N + 3*viewDir) * 0.25
                    // (up to ~1 world unit at probeSpace 6). At 0 a lit surface
                    // sits exactly at its probes' stored mean distance, and the
                    // sharpened depth lobe (depthSharpness 50) makes Chebyshev
                    // reject valid probes wherever bilinear filtering nudges
                    // the mean below the true distance — shadow-acne blotches.
                    normalBias: 0.25,
                    probeSize: 32,
                    octRTSideSize: 16,
                    octRTMaxSize: 2048,
                    ddgiGamma: 2.2,
                    // Depth-moment lobe exponent. Must be much sharper than
                    // the cosine irradiance lobe (reference DDGI uses ~50):
                    // at 1 the stored "mean visible distance" is a whole-
                    // hemisphere average, so interior probes report ~half the
                    // cavity size toward a wall right next to them, the
                    // Chebyshev test never sees them as occluded, and the
                    // bright interior field leaks onto exterior surfaces as
                    // probe-sized color blotches.
                    depthSharpness: 50,
                    autoRenderProbe: true,
                },
                shadow: {
                    debug: true,
                    shadowSize: 2048,
                    autoUpdate: true,
                    updateFrameRate: 1,
                },
                render: {
                    debug: true,
                },
                sky: {
                    // The box's open front lets the bright atmospheric sky
                    // pour into the wall/box gaps; its irradiance is ~5-10x
                    // the walls' bounce radiance, so it drowns the red/green
                    // color bleeding on the wall-facing box faces. Dim the
                    // sky so the interior bounce light dominates.
                    skyExposure: 0.2,
                },
            },
            renderLoop: () => {
                if (this.giComponent?.isStart) {
                    GUIUtil.renderGIComponent(this.giComponent, this.view);
                    this.giComponent = null;
                }
            }
        });
        let param = createSceneParam();
        param.camera.distance = 100;

        let exampleScene = createExampleScene(engine, param);
        exampleScene.hoverCtrl.setCamera(0, 0, 26, new Vector3(0, 10, 0));
        this.scene = exampleScene.scene;
        this.view = exampleScene.view;
        // startRenderViews binds view.engine3D — must precede addGIProbes,
        // since GlobalIlluminationComponent.init reaches scene.view.engine3D
        // to size light/GI buffers.
        engine.startRenderViews([exampleScene.view]);
        this.addGIProbes(this.view);

        let postProcessing = this.scene.addComponent(PostProcessingComponent);
        postProcessing.addPost(BloomPost);

        await this.initScene();
    }

    private giComponent: GlobalIlluminationComponent;
    private addGIProbes(view: View3D) {
        let probeObj = new Object3D();
        GUIHelp.init();
        this.giComponent = probeObj.addComponent(GlobalIlluminationComponent, view.scene);
        this.scene.addChild(probeObj);
    }

    async initScene() {
        let box = await this.engine.res.loadGltf('gltfs/cornellBox/cornellBox.gltf') as Object3D;
        box.localScale = new Vector3(10, 10, 10);
        this.scene.addChild(box);
    }
}

new Sample_GICornellBox().run();