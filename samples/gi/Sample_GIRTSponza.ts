import { Object3D, Scene3D, Engine3D, Vector3, View3D, CameraUtil, AtmosphericComponent, DirectLight, KelvinUtil, GlobalBindGroup, GlobalIlluminationComponent, HoverCameraController, MeshRenderer } from "@orillusion/core";
import { GUIHelp } from "@orillusion/debug/GUIHelp";

// Software-ray-traced DDGI on the Sponza atrium: a sun (DirectLight)
// shafts into the courtyard and the probe field carries the bounce into
// the arcades. Uses setting.gi.rayTracing with the AUTO-FIT grid (probe
// counts all 0): the trace pass measures the scene AABB while building
// the BVH and derives counts / spacing / offsets from rtDivisions, so
// the only density knob is "probes along the longest axis" — same
// deployment model as speedball. Probe updates run round-robin under
// rtProbeCountPerFrame instead of all-probes-every-frame.
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
        // Divisions is baked into the auto-fit grid (and the debug-sphere
        // entity count) at init, so GUI changes apply through a reload.
        const divisions = Number(sessionStorage.getItem('rtSponzaDivisions')) || 16;

        const engine = this.engine = await Engine3D.init({
            setting: {
                gi: {
                    enable: true,
                    rayTracing: true,
                    debug: true,
                    // All-zero probe counts = auto-fit: the grid is derived
                    // from the measured scene bounds at BVH build time.
                    probeXCount: 0,
                    probeYCount: 0,
                    probeZCount: 0,
                    rtDivisions: divisions,
                    // Round-robin budget: 256 probes/frame. At divisions 16
                    // Sponza fits ~17x8x11 = ~1500 probes, so a full sweep
                    // takes ~6 frames at ~37k rays/frame.
                    rtProbeCountPerFrame: 256,
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
            renderLoop: () => this.onFrame(),
        });

        this.engine.setting.gi.indirectIntensity = 5;

        this.scene = new Scene3D();
        let sky = this.scene.addComponent(AtmosphericComponent);
        sky.exposure = 1.0;

        let camera = CameraUtil.createCamera3DObject(this.scene);
        camera.perspective(60, engine.aspect, 0.1, 500.0);
        // Hover controller: drag to orbit, wheel to zoom, right-drag to pan.
        // roll 90 puts the camera on +X inside the atrium looking down the
        // long axis (roll -90 lands inside the west wall).
        let ctrl = camera.object3D.addComponent(HoverCameraController);
        ctrl.setCamera(90, -5, 10, new Vector3(0, 4, 0));

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

    private giComponent: GlobalIlluminationComponent | null = null;
    private probeHolder: Object3D | null = null;
    private savedIndirect = 1;
    uiState = { giEnable: true, showProbes: false };

    /** Frame hook: create the probe debug spheres only AFTER auto-fit has
     *  written the real grid into setting.gi (the component bakes probe
     *  entities from the counts at its init), then shrink the stock 4m
     *  spheres to Sponza scale once the component starts. */
    private onFrame() {
        if (!this.probeHolder) {
            const tracePass = (this.view?.renderGraph?.getPass('GIPass') as any)?.tracePass;
            if (tracePass?.autoFitDone) {
                const g = this.engine.setting.gi;
                console.log(`[auto-fit] probes ${g.probeXCount}x${g.probeYCount}x${g.probeZCount} = ${g.probeXCount * g.probeYCount * g.probeZCount}, spacing ${g.probeSpace.toFixed(2)}`);
                let probeObj = new Object3D();
                this.giComponent = probeObj.addComponent(GlobalIlluminationComponent, this.scene);
                this.probeHolder = probeObj;
                this.scene.addChild(probeObj);
            }
        } else if (this.giComponent?.isStart) {
            for (const child of this.giComponent.object3D.entityChildren) {
                (child as Object3D).localScale = new Vector3(0.1, 0.1, 0.1);
            }
            this.giComponent.object3D.transform.enable = this.uiState.showProbes;
            this.giComponent = null;
        }
    }

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

    /** Per-material scale of the WHOLE indirect diffuse term. With GI on,
     *  fragData.Irradiance comes from the probe field (BxDF_frag USEGI),
     *  and indirectionDiffuse_Function multiplies it by envIntensity — so
     *  0 kills the GI diffuse too, NOT just ambient env light. Kept at 1;
     *  the slider exists for debugging the indirect term as a whole. */
    private setIndirectDiffuse(root: Object3D, v: number) {
        for (const mr of root.getComponents(MeshRenderer)) {
            for (const mat of mr.materials ?? []) {
                mat?.setUniformFloat('envIntensity', v);
            }
        }
    }

    async initScene() {
        let sponza = await this.engine.res.loadGltf('gltfs/glb/Sponza.glb') as Object3D;
        this.scene.addChild(sponza);
        (this as any).sponza = sponza;

        // Sun angled through the atrium roof opening so the courtyard
        // floor is lit and the arcades live on bounce light.
        let sunObj = new Object3D();
        sunObj.rotationX = 80;
        sunObj.rotationY = 0;
        let sun = sunObj.addComponent(DirectLight);
        (this as any).sun = sun;
        sun.lightColor = KelvinUtil.color_temperature_to_rgb(5355);
        sun.intensity = 20;
        sun.castShadow = true;
        sun.enableCSM = true;
        this.scene.addChild(sunObj);

        GUIHelp.addFolder('Sun');
        GUIHelp.add(sun, 'intensity', 0, 100, 1);
        GUIHelp.add(sunObj, 'rotationX', -180, 180, 1);
        GUIHelp.add(sunObj, 'rotationY', -180, 180, 1);
        GUIHelp.add(sun, 'enableCSM');
        GUIHelp.endFolder();

        // gi uniforms upload only when the volume is flagged changed, so
        // the sliders must poke it explicitly.
        const volume = GlobalBindGroup.getLightEntries(this.scene).irradianceVolume;
        GUIHelp.addFolder('GI');
        GUIHelp.add(this.uiState, 'giEnable').onChange((v: boolean) => this.setGIEnable(v));
        GUIHelp.add(this.uiState, 'showProbes').onChange((v: boolean) => {
            if (this.probeHolder) this.probeHolder.transform.enable = v;
        });
        GUIHelp.add(this.engine.setting.gi, 'indirectIntensity', 0, 5, 0.05).onChange(() => volume.setVolumeDataChange());
        GUIHelp.add(this.engine.setting.gi, 'bounceIntensity', 0, 1, 0.01).onChange(() => volume.setVolumeDataChange());
        GUIHelp.add(this.engine.setting.gi, 'rtProbeCountPerFrame', 0, 1024, 32);
        // With GI on, sky light only enters through the probes (trace-kernel
        // sky-miss rays); rtSkyIntensity is the live knob to suppress it.
        // The trace pass re-uploads it every frame, no volume poke needed.
        GUIHelp.add(this.engine.setting.gi, 'rtSkyIntensity', 0, 4, 0.05);
        // Whole indirect-diffuse scale (GI + env fallback), per material —
        // NOT an "ambient env only" switch; see setIndirectDiffuse.
        const indirect = { indirectDiffuse: 1 };
        GUIHelp.add(indirect, 'indirectDiffuse', 0, 1, 0.05).onChange((v: number) => this.setIndirectDiffuse(sponza, v));
        GUIHelp.endFolder();

        // Grid density: probes along the longest scene axis. Baked into
        // the auto-fit + debug spheres at init, so apply reloads the page.
        const grid = {
            divisions: this.engine.setting.gi.rtDivisions,
            apply: () => {
                sessionStorage.setItem('rtSponzaDivisions', String(grid.divisions));
                location.reload();
            },
        };
        GUIHelp.addFolder('Probe Grid (reload)');
        GUIHelp.add(grid, 'divisions', 4, 32, 1);
        GUIHelp.addButton('apply', grid.apply);
        GUIHelp.endFolder();
    }
}

new Sample_GIRTSponza().run();
