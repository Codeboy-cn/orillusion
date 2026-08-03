import { Object3D, Scene3D, Engine3D, Vector3, View3D, CameraUtil, FlyCameraController, AtmosphericComponent, DirectLight, KelvinUtil, GlobalBindGroup, GlobalIlluminationComponent } from "@orillusion/core";
import { GUIHelp } from "@orillusion/debug/GUIHelp";

// Software-ray-traced DDGI on the Sponza atrium: a sun (DirectLight)
// shafts into the courtyard and the probe field carries the bounce into
// the arcades. Uses setting.gi.rayTracing, so the ~260k-triangle glb is
// flattened into the BVH once at load and every probe refreshes each
// frame — no cube captures, no shadow-map dependency for the probes
// (shadow rays run against the BVH).
//
// Known v1 limitation of the traced path: hit albedo comes from the
// material baseColor FACTOR only (no texture sampling), so on Sponza —
// whose color lives almost entirely in textures — the bounce is
// intensity-correct but mostly uncolored.
class Sample_GIRTSponza {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;
    async run() {
        // Probe counts fix the debug-sphere entity count and the atlas
        // layout at init time, so GUI changes apply through a reload with
        // the chosen counts persisted here.
        const stored = sessionStorage.getItem('rtSponzaProbeCounts');
        const probeCounts = stored ? JSON.parse(stored) : { x: 8, y: 4, z: 4 };

        const engine = this.engine = await Engine3D.init({
            setting: {
                gi: {
                    enable: true,
                    rayTracing: true,
                    debug: true,
                    // Khronos Sponza spans roughly x [-12,12], y [0,12],
                    // z [-7,7] meters. 8x4x4 probes at 3.2m spacing cover
                    // the atrium and the first arcade ring; the volume is
                    // lifted so the bottom row sits above the floor slab.
                    probeXCount: probeCounts.x,
                    probeYCount: probeCounts.y,
                    probeZCount: probeCounts.z,
                    probeSpace: 3.2,
                    offsetX: 0,
                    offsetY: 5.5,
                    offsetZ: 0,
                    indirectIntensity: 1,
                    bounceIntensity: 1.0,
                    normalBias: 0.25,
                    octRTSideSize: 16,
                    octRTMaxSize: 2048,
                    ddgiGamma: 2.2,
                    depthSharpness: 18,
                    rayNumber: 144,
                    autoRenderProbe: true,
                },
                render: {
                    debug: true,
                },
            },
            renderLoop: () => {
                // Probe entities exist only after the component started;
                // shrink the stock 4m debug spheres to Sponza scale once.
                if (this.giComponent?.isStart) {
                    for (const child of this.giComponent.object3D.entityChildren) {
                        (child as Object3D).localScale = new Vector3(0.15, 0.15, 0.15);
                    }
                    this.giComponent.object3D.transform.enable = this.uiState.showProbes;
                    this.giComponent = null;
                }
            },
        });

        this.scene = new Scene3D();
        this.scene.addComponent(AtmosphericComponent);

        let camera = CameraUtil.createCamera3DObject(this.scene);
        camera.perspective(60, engine.aspect, 0.1, 500.0);
        // Fly controller: WASD + mouse drag, Shift to speed up.
        let ctrl = camera.object3D.addComponent(FlyCameraController);
        ctrl.setCamera(new Vector3(10, 4, 0), new Vector3(0, 4, 0));

        let view = new View3D();
        view.scene = this.scene;
        view.camera = camera;
        this.view = view;
        engine.startRenderViews([view]);

        // Debug hook for CDP-driven A/B checks (_gi_rt_sponza A/B script).
        (window as any).__sample = this;

        // Probe debug spheres (GIProbeMaterial visualizes the SAME atlas
        // the ray-traced path writes). The RT path never renders probe
        // cube captures, so the component only supplies the spheres here.
        let probeObj = new Object3D();
        this.giComponent = probeObj.addComponent(GlobalIlluminationComponent, this.scene);
        this.probeHolder = probeObj;
        this.scene.addChild(probeObj);

        GUIHelp.init();
        await this.initScene();
    }

    private giComponent: GlobalIlluminationComponent | null = null;
    private probeHolder: Object3D;
    private savedIndirect = 1;
    uiState = { giEnable: true, showProbes: true };

    /** Set indirect GI intensity and force the volume uniform re-upload. */
    setIndirect(v: number) {
        this.engine.setting.gi.indirectIntensity = v;
        GlobalBindGroup.getLightEntries(this.scene).irradianceVolume.setVolumeDataChange();
    }

    /** GI on/off. Zeroing indirectIntensity (not gi.enable) kills the
     *  contribution immediately: gi.enable=false would early-return
     *  GIPass BEFORE the volume uniform uploads, leaving the last value
     *  visible forever. */
    setGIEnable(on: boolean) {
        if (on) {
            this.setIndirect(this.savedIndirect);
        } else {
            this.savedIndirect = this.engine.setting.gi.indirectIntensity;
            this.setIndirect(0);
        }
    }

    async initScene() {
        let sponza = await this.engine.res.loadGltf('gltfs/glb/Sponza.glb') as Object3D;
        this.scene.addChild(sponza);

        // Sun angled through the atrium roof opening so the courtyard
        // floor is lit and the arcades live on bounce light.
        let sunObj = new Object3D();
        sunObj.rotationX = 50;
        sunObj.rotationY = 35;
        let sun = sunObj.addComponent(DirectLight);
        (this as any).sun = sun;
        sun.lightColor = KelvinUtil.color_temperature_to_rgb(5355);
        sun.intensity = 6;
        sun.castShadow = true;
        // KNOWN ENGINE BUG (isolated 2026-08-03, unrelated to the GI path):
        // enableCSM blacks out ALL sun lighting in this scene — reproduced
        // with GI fully disabled, with Hover and Fly controllers, with
        // camera far 500 and 5000, and with per-frame camera jitter; the
        // cascade cameras themselves fit sane volumes and the small-scene
        // CSM samples (post/Sample_GTAO) work. Left as a GUI toggle for
        // reproducing; default off until the cascade sampling path is fixed.
        sun.enableCSM = false;
        this.scene.addChild(sunObj);

        GUIHelp.addFolder('Sun');
        GUIHelp.add(sun, 'intensity', 0, 100, 1);
        GUIHelp.add(sunObj, 'rotationX', 0, 90, 1);
        GUIHelp.add(sunObj, 'rotationY', -180, 180, 1);
        GUIHelp.add(sun, 'enableCSM');
        GUIHelp.endFolder();

        // gi uniforms upload only when the volume is flagged changed, so
        // the sliders must poke it explicitly.
        const volume = GlobalBindGroup.getLightEntries(this.scene).irradianceVolume;
        GUIHelp.addFolder('GI');
        GUIHelp.add(this.uiState, 'giEnable').onChange((v: boolean) => this.setGIEnable(v));
        GUIHelp.add(this.uiState, 'showProbes').onChange((v: boolean) => {
            this.probeHolder.transform.enable = v;
        });
        GUIHelp.add(this.engine.setting.gi, 'indirectIntensity', 0, 5, 0.05).onChange(() => volume.setVolumeDataChange());
        GUIHelp.add(this.engine.setting.gi, 'bounceIntensity', 0, 1, 0.01).onChange(() => volume.setVolumeDataChange());
        GUIHelp.endFolder();

        // Probe counts are baked into the component / atlas at init, so
        // new values apply through a reload (persisted in sessionStorage).
        const counts = {
            x: this.engine.setting.gi.probeXCount,
            y: this.engine.setting.gi.probeYCount,
            z: this.engine.setting.gi.probeZCount,
            apply: () => {
                sessionStorage.setItem('rtSponzaProbeCounts', JSON.stringify({ x: counts.x, y: counts.y, z: counts.z }));
                location.reload();
            },
        };
        GUIHelp.addFolder('Probe Count (reload)');
        GUIHelp.add(counts, 'x', 2, 12, 1);
        GUIHelp.add(counts, 'y', 2, 8, 1);
        GUIHelp.add(counts, 'z', 2, 8, 1);
        GUIHelp.addButton('apply', counts.apply);
        GUIHelp.endFolder();
    }
}

new Sample_GIRTSponza().run();
