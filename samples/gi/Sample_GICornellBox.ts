import { Object3D, Scene3D, Engine3D, GlobalIlluminationComponent, Vector3, PostProcessingComponent, View3D, CameraUtil, HoverCameraController, PointLight, ColliderComponent, SphereColliderShape, PointerEvent3D, Probe } from "@orillusion/core";
import { GUIHelp } from "@orillusion/debug/GUIHelp";
import { GUIUtil } from "@samples/utils/GUIUtil";

// DDGI counterpart of Sample_SSGICornellBox: the exact same scene
// environment — Cornell box with its emissive ceiling quad, one point
// light under the ceiling, no DirectLight, no atmospheric sky — lit by
// the volumetric probe field instead of screen-space GI, so the two
// techniques can be compared side by side.
class Sample_GICornellBox {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;
    async run() {

        const engine = this.engine = await Engine3D.init({
            setting: {
                gi: {
                    enable: true,
                    debug: true,
                    probeYCount: 3,
                    probeXCount: 3,
                    probeZCount: 3,
                    offsetX: 0,
                    // 13 (not the cavity-centered 10) keeps the lower probe
                    // row out of the boxes' bottom band: at 10 the y=1 row
                    // puts probes inside both boxes and the y=-5 row inside
                    // the floor slab, so the interpolation cages at the box
                    // bottoms are dominated by dead (inside-geometry)
                    // probes and render as dark blotches.
                    offsetY: 9.5,
                    offsetZ: 0,
                    indirectIntensity: 1,
                    // The colored walls receive almost no direct light —
                    // they are lit by the ceiling quad / point light through
                    // the multi-bounce feedback loop, which also carries
                    // their reflected color into the probes. 1.0 =
                    // energy-exact single-bounce feedback (see
                    // MultiBouncePass_cs).
                    bounceIntensity: 1.0,
                    maxDistance: 16,
                    probeSpace: 8.38,
                    // Shifts the visibility-test sample point off the surface
                    // toward the viewer: surfaceBias = (N + 3*viewDir) * 0.25
                    // (up to ~1 world unit at probeSpace 6). At 0 a lit surface
                    // sits exactly at its probes' stored mean distance, and the
                    // sharpened depth lobe makes Chebyshev reject valid probes
                    // wherever bilinear filtering nudges the mean below the
                    // true distance — shadow-acne blotches.
                    normalBias: 0.25,
                    probeSize: 32,
                    // 32x32 oct tiles (engine default 16): halves the depth
                    // texel's angular width (22deg -> 11deg). With probes
                    // sitting 1-3 units from the box/walls, a 22deg depth
                    // texel blends floor/face/far-cavity distances, the
                    // Chebyshev mean wobbles texel to texel, and the shadow
                    // pocket's edge on nearby geometry turns into an
                    // irregular wavy line; at 11deg the boundary resolves
                    // into a smooth gradient.
                    octRTSideSize: 32,
                    octRTMaxSize: 2048,
                    ddgiGamma: 2.2,
                    // Depth-moment lobe exponent. Two-sided constraint: much
                    // sharper than the cosine irradiance lobe (at 1 the mean
                    // visible distance smears to a hemisphere average and
                    // Chebyshev stops rejecting occluded probes — interior
                    // light leaks onto the exterior walls), yet no narrower
                    // than one 16x16 oct depth texel (~22 deg): at 50 the
                    // ~19 deg lobe left the reader's direction-quantization
                    // spread out of the stored variance, and Chebyshev cut
                    // corner-adjacent probes along razor-thin radial bands —
                    // the color steps near the wall-floor / wall-ceiling
                    // corners. 18 = ~32 deg lobe, matched to the tile size.
                    depthSharpness: 18,
                    autoRenderProbe: true,
                },
                render: {
                    debug: true,
                },
                sky: {
                    // Same as the SSGI bench: no AtmosphericComponent is
                    // added, and the non-GI environment term is zeroed so
                    // the cavity's own sources are all the light there is.
                    skyExposure: 0,
                },
                pick: {
                    enable: true,
                    mode: `bound`,
                },
            },
            renderLoop: () => {
                if (this.giComponent?.isStart) {
                    GUIUtil.renderGIComponent(this.giComponent, this.view);
                    // Probes exist only after the component started — attach
                    // the click-to-identify colliders here, not at addComponent
                    // time (init/initProbe are deferred to the frame loop).
                    this.enableProbePicking(this.giComponent);
                    this.giComponent = null;
                }
            }
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
        // startRenderViews binds view.engine3D — must precede addGIProbes,
        // since GlobalIlluminationComponent.init reaches scene.view.engine3D
        // to size light/GI buffers.
        engine.startRenderViews([view]);

        GUIHelp.init();
        this.addGIProbes(this.view);

        await this.initScene();
    }

    private giComponent: GlobalIlluminationComponent;
    private addGIProbes(view: View3D) {
        let probeObj = new Object3D();
        this.giComponent = probeObj.addComponent(GlobalIlluminationComponent, view.scene);
        this.scene.addChild(probeObj);
    }

    // Click a debug probe sphere (GI panel 'show') to log which probe it
    // is. The debug spheres are radius-4 Probe children of the component.
    private enableProbePicking(component: GlobalIlluminationComponent) {
        let shape = new SphereColliderShape(4);
        for (let child of component.object3D.entityChildren) {
            if (child instanceof Probe) {
                child.addComponent(ColliderComponent).shape = shape;
            }
        }
        this.view.pickFire.addEventListener(PointerEvent3D.PICK_CLICK, (e: PointerEvent3D) => {
            let pick = e.target;
            if (pick instanceof Probe) {
                console.log(`[probe pick] index=${pick.index} name=${pick.name} pos=(${pick.x}, ${pick.y}, ${pick.z})`);
                // Fly the hover camera to look at the clicked probe.
                let ctrl = this.view.camera.object3D.getComponent(HoverCameraController);
                ctrl.setCamera(ctrl.roll, ctrl.pitch, 12, new Vector3(pick.x, pick.y, pick.z));
            }
        }, this);
    }

    async initScene() {
        let box = await this.engine.res.loadGltf('gltfs/cornellBox/cornellBox.gltf') as Object3D;
        box.localScale = new Vector3(10, 10, 10);
        this.scene.addChild(box);

        // Point light just below the ceiling lamp quad (cavity is
        // x,z in [-10,10], y in [0,20] after the 10x scale) — identical
        // to the SSGI bench.
        let lightObj = new Object3D();
        lightObj.y = 19;
        let pointLight = lightObj.addComponent(PointLight);
        pointLight.intensity = 0.5;
        pointLight.range = 45;
        pointLight.castShadow = true;
        // Same acne fix as the SSGI bench: ~1 world unit (5% of the
        // cavity) clears grazing-incidence self-shadowing without
        // visible peter-panning at the box/floor contacts.
        pointLight.shadowBias = 1.0;
        pointLight.normalBias = 1.0;
        this.scene.addChild(lightObj);

        GUIHelp.addFolder('PointLight');
        GUIHelp.add(pointLight, 'intensity', 0, 50, 0.1);
        GUIHelp.add(pointLight, 'range', 1, 100, 1);
        GUIHelp.add(lightObj, 'y', 1, 19, 0.1);
        GUIHelp.endFolder();

        // A/B the tonemap: the walls' top-to-bottom hue shift is mostly
        // ACES highlight desaturation — toggling to 'None' makes the
        // wall color uniform (and blows out the lamp area, which is why
        // the tonemap exists).
        GUIHelp.addFolder('Tonemap');
        let tonemapState = { ACES: true };
        GUIHelp.add(tonemapState, 'ACES').onChange((v: boolean) => {
            this.engine.setting.render.tonemap.mode = v ? 'ACES' : 'None';
        });
        GUIHelp.endFolder();
    }
}

new Sample_GICornellBox().run();
