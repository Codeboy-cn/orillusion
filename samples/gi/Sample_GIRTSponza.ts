import { Object3D, Scene3D, Engine3D, Vector3, View3D, CameraUtil, FlyCameraController, AtmosphericComponent, DirectLight, KelvinUtil, GlobalBindGroup } from "@orillusion/core";
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
        const engine = this.engine = await Engine3D.init({
            setting: {
                gi: {
                    enable: true,
                    rayTracing: true,
                    // Khronos Sponza spans roughly x [-12,12], y [0,12],
                    // z [-7,7] meters. 8x4x4 probes at 3.2m spacing cover
                    // the atrium and the first arcade ring; the volume is
                    // lifted so the bottom row sits above the floor slab.
                    probeXCount: 8,
                    probeYCount: 4,
                    probeZCount: 4,
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
        });

        this.scene = new Scene3D();
        this.scene.addComponent(AtmosphericComponent);

        let camera = CameraUtil.createCamera3DObject(this.scene);
        camera.perspective(60, engine.aspect, 0.1, 500.0);
        // Fly controller (WASD + mouse) suits walking the atrium; position
        // and look-target are re-set after the glb loads and its real
        // bounds are known.
        let ctrl = camera.object3D.addComponent(FlyCameraController);
        ctrl.setCamera(new Vector3(10, 4, 0), new Vector3(0, 4, 0));

        let view = new View3D();
        view.scene = this.scene;
        view.camera = camera;
        this.view = view;
        engine.startRenderViews([view]);

        // Debug hook for CDP-driven A/B checks (_gi_rt_sponza A/B script).
        (window as any).__sample = this;

        GUIHelp.init();
        await this.initScene();
    }

    /** Set indirect GI intensity and force the volume uniform re-upload. */
    setIndirect(v: number) {
        this.engine.setting.gi.indirectIntensity = v;
        GlobalBindGroup.getLightEntries(this.scene).irradianceVolume.setVolumeDataChange();
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
        sun.lightColor = KelvinUtil.color_temperature_to_rgb(5355);
        sun.intensity = 6;
        sun.castShadow = true;
        this.scene.addChild(sunObj);

        GUIHelp.addFolder('Sun');
        GUIHelp.add(sun, 'intensity', 0, 100, 1);
        GUIHelp.add(sunObj, 'rotationX', 0, 90, 1);
        GUIHelp.add(sunObj, 'rotationY', -180, 180, 1);
        GUIHelp.endFolder();

        // gi uniforms upload only when the volume is flagged changed, so
        // the sliders must poke it explicitly.
        const volume = GlobalBindGroup.getLightEntries(this.scene).irradianceVolume;
        GUIHelp.addFolder('GI');
        GUIHelp.add(this.engine.setting.gi, 'indirectIntensity', 0, 5, 0.05).onChange(() => volume.setVolumeDataChange());
        GUIHelp.add(this.engine.setting.gi, 'bounceIntensity', 0, 1, 0.01).onChange(() => volume.setVolumeDataChange());
        GUIHelp.endFolder();
    }
}

new Sample_GIRTSponza().run();
