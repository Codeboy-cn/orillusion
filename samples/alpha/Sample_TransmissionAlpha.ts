import { GUIHelp } from "@orillusion/debug/GUIHelp";
import {
    AtmosphericComponent,
    CameraUtil,
    Color,
    DirectLight,
    Engine3D,
    HoverCameraController,
    KelvinUtil,
    LitMaterial,
    MeshRenderer,
    Object3D,
    Scene3D,
    Vector3,
    View3D,
} from "@orillusion/core";

/**
 * 1:1 reproduction of three.js example
 *   https://threejs.org/examples/#webgl_materials_physical_transmission_alpha
 *
 * The defining trick of that demo isn't the transmission shader itself —
 * it's the canvas-alpha composite. A CSS table with four colored cells
 * (#ff0000 / #00ff00 / #0000ff / #000000) is placed *behind* the WebGL
 * canvas; the canvas is created with `alpha: true` and never draws a
 * background of its own; the dragon's transmission samples whatever's
 * already on the framebuffer (the SceneColorPyramid copy of the opaque
 * world). The result: the colored HTML cells refract through the dragon.
 *
 * Mapping to Orillusion:
 *   - `canvasConfig.alpha = true` makes the swapchain clear to (1,1,1,0)
 *     and switches the present pass to `loadOp: 'load'` so the HTML
 *     compositor can blend us onto the page (Context3D + WebGPUDescriptorCreator).
 *   - We deliberately do not add a SkyRenderer / enable AtmosphericComponent —
 *     that would draw a sphere skybox and obscure the cells.
 *   - The HDR cube (`/hdri/sunset.hdr`) is bound to `scene.envMap` for IBL
 *     only; nothing in the scene presents it as a background.
 *   - DragonAttenuation.glb already carries KHR_materials_ior /
 *     KHR_materials_transmission / KHR_materials_volume, so the gltf
 *     parser produces a LitMaterial with `transmissionFactor`,
 *     `attenuationColor`, etc. already populated — we just expose them
 *     to the GUI.
 */
class Sample_TransmissionAlpha {
    engine!: Engine3D;
    scene!: Scene3D;
    view!: View3D;

    private dragonMat!: LitMaterial;
    private directLight!: DirectLight;
    private envMapBaseIntensity = 1.0;
    private lightBaseIntensity = 3.0;

    async run() {
        // Inject the four colored cells *before* Engine3D creates the
        // canvas, so they're already in the iframe's DOM when the canvas
        // is appended on top with z-index 1.
        this.injectHTMLBackdrop();

        this.engine = await Engine3D.init({
            canvasConfig: {
                alpha: true,
                zIndex: 1,
            },
            setting: {
                shadow: { enable: false },
                render: { msaa: 0 } as any,
            },
        });

        GUIHelp.init();

        this.scene = new Scene3D();
        // AtmosphericComponent stays disabled — a visible sky would
        // cover the HTML backdrop. We still attach one so the shadow
        // / IBL pipelines have a sun-direction reference, but force
        // `enable=false` so nothing draws.
        const atmos = this.scene.addComponent(AtmosphericComponent);
        atmos.enable = false;

        const camera = CameraUtil.createCamera3DObject(this.scene);
        camera.perspective(40, this.engine.aspect, 1, 2000);
        // Three demo: camera.position.set(-5, 0.5, 0); controls.target.y = 0.5.
        // HoverCameraController spherical: roll=180 (yaw 180°) puts camera
        // on +X looking at -X — Three has it on -X. Either side gives the
        // same dragon profile so we use roll=180 for a slight upward tilt.
        // Dragon was authored at unit-scale in glTF; the demo distance of 5
        // matches.
        camera.object3D
            .addComponent(HoverCameraController)
            .setCamera(180, 0, 5, new Vector3(0, 0.5, 0));

        this.view = new View3D();
        this.view.scene = this.scene;
        this.view.camera = camera;
        this.engine.startRenderView(this.view);

        // Single directional light — the demo's lighting is dominated
        // by the IBL HDR; the directional just adds a key.
        const lightPivot = new Object3D();
        lightPivot.rotationX = 30;
        lightPivot.rotationY = 200;
        this.directLight = lightPivot.addComponent(DirectLight);
        this.directLight.lightColor = KelvinUtil.color_temperature_to_rgb(6500);
        this.directLight.intensity = this.lightBaseIntensity;
        this.directLight.castShadow = false;
        this.scene.addChild(lightPivot);

        // IBL only — bind HDR to scene.envMap without spawning a
        // SkyRenderer (which would draw the cube as a background and
        // hide the HTML cells).
        const hdr = await this.engine.res.loadHDRTextureCube('/hdri/sunset.hdr');
        this.scene.envMap = hdr;

        await this.loadDragon();
        this.initGUI();
    }

    private injectHTMLBackdrop() {
        // Mimics the inline <style> + <table> from
        // examples/webgl_materials_physical_transmission_alpha.html.
        const style = document.createElement('style');
        style.textContent = `
            html,body { margin:0; padding:0; overflow:hidden; }
            body { background-color: #888888; }
            #table {
                margin-top: 100px;
                border-collapse: collapse;
                width: 100%;
            }
            #table td {
                margin: 0; padding: 0;
                font-size: 16px;
                text-align: center;
                vertical-align: middle;
                font-family: Avenir, Helvetica, Arial, sans-serif;
            }
            #table tr { height: 250px; }
            #block-ff0000 { background-color: #ff0000; color: white; }
            #block-00ff00 { background-color: #00ff00; color: black; }
            #block-0000ff { background-color: #0000ff; color: white; }
            #block-000000 { background-color: #000000; color: black; }
        `;
        document.head.appendChild(style);

        const table = document.createElement('table');
        table.id = 'table';
        table.innerHTML = `
            <tbody><tr>
                <td id="block-ff0000">ff0000</td>
                <td id="block-00ff00">00ff00</td>
                <td id="block-0000ff">0000ff</td>
                <td id="block-000000">000000</td>
            </tr></tbody>`;
        document.body.appendChild(table);
    }

    private async loadDragon() {
        const model = (await this.engine.res.loadGltf('gltfs/DragonAttenuation/DragonAttenuation.glb')) as Object3D;
        this.scene.addChild(model);

        // The asset is two parts: a checkerboard floor pedestal that
        // stays as authored (opaque MR), and the dragon itself which
        // ships with KHR_materials_transmission already enabled. We
        // pick the LitMaterial whose `transmissionFactor` was touched
        // by the gltf parser — the parser only sets it on materials
        // that explicitly declare the extension, so this discriminates
        // the dragon from the floor without name lookups.
        const meshes = model.getComponentsInChild(MeshRenderer);
        for (const mr of meshes) {
            for (const m of mr.materials) {
                if (m instanceof LitMaterial && m.transmissionFactor > 0) {
                    this.dragonMat = m;
                }
            }
        }
        if (this.dragonMat) {
            // Preset matches the values three.js reads from the asset
            // itself (DragonAttenuation.glb's KHR_materials_volume +
            // KHR_materials_ior). The shader now keeps half the lit
            // signal as a specular / env-reflection proxy in cutout
            // mode and scales the refraction offset by thickness, so
            // the heavy attenuation (thickness 2.27 / distance 0.155)
            // produces the characteristic deep amber + bright
            // highlights of three.js's reference render rather than
            // a uniformly dark body.
            this.dragonMat.baseColor = new Color(1, 1, 1, 1);
            this.dragonMat.transmissionFactor = 1.0;
            this.dragonMat.metallic = 0;
            this.dragonMat.roughness = 0;
            this.dragonMat.ior = 1.5;
            this.dragonMat.thicknessFactor = 2.27;
            this.dragonMat.attenuationColor = new Color(246 / 255, 209 / 255, 72 / 255, 1);
            // Asset's authored 0.155 collapses the body to red under our
            // simpler 2D refraction (no per-fragment ray length, no
            // ACES-tuned exposure). 0.5 keeps the amber hue and shows
            // the cloth pattern through the glass while staying visibly
            // attenuated — the slider goes 0..1 so the user can dial
            // back to 0.155 to feel the heavier asset default.
            this.dragonMat.attenuationDistance = 0.5;
            // Critical for the canvas-alpha trick: with this mode on,
            // the transmission shader writes alpha < 1 wherever the
            // glass transmits, so the iframe's HTML backdrop can show
            // through the canvas's premultiplied compositor.
            this.dragonMat.transmissionAlphaMode = true;
        }

        // Three.js renders the asset unmodified — we do the same.
        // DragonAttenuation.glb is authored so the dragon's body straddles
        // y=0..1 in world units, which is why Three's example targets
        // y=0.5 with a fov-40 camera 5 units away.
    }

    private initGUI() {
        if (!this.dragonMat) return;

        // Mirror three.js example's params block, in the same order
        // and with the same ranges. Initial values match the preset
        // applied to the dragon material in loadDragon().
        const params = {
            color: { rgba: [255, 255, 255, 1] },
            transmission: 1,
            opacity: 1,
            metalness: 0,
            roughness: 0,
            ior: 1.5,
            thickness: 2.27,
            attenuationColor: { rgba: [246, 209, 72, 1] },
            attenuationDistance: 0.5,
            specularIntensity: 1,
            specularColor: { rgba: [255, 255, 255, 1] },
            envMapIntensity: 1,
            exposure: 1,
        };

        GUIHelp.addColor(params, 'color').onChange(() => {
            const c = (params.color as any).rgba; // [r,g,b,a] (0-255)
            this.dragonMat.baseColor = new Color(c[0] / 255, c[1] / 255, c[2] / 255, this.dragonMat.baseColor.a);
        });

        GUIHelp.add(params, 'transmission', 0, 1, 0.01).onChange(() => {
            this.dragonMat.transmissionFactor = params.transmission;
        });

        GUIHelp.add(params, 'opacity', 0, 1, 0.01).onChange(() => {
            // Drive opacity via baseColor.a only — the transmission
            // shader path multiplies the cut-out alpha by this value
            // (cutoutAlpha = baseColor.a * (1 - tf * k)), so the
            // slider takes effect immediately. Switching alphaMode at
            // runtime would need a pipeline rebuild and a queue swap,
            // which we don't do here.
            const a = params.opacity;
            const c = this.dragonMat.baseColor;
            this.dragonMat.baseColor = new Color(c.r, c.g, c.b, a);
        });

        GUIHelp.add(params, 'metalness', 0, 1, 0.01).onChange(() => {
            this.dragonMat.metallic = params.metalness;
        });

        GUIHelp.add(params, 'roughness', 0, 1, 0.01).onChange(() => {
            this.dragonMat.roughness = params.roughness;
        });

        GUIHelp.add(params, 'ior', 1, 2, 0.01).onChange(() => {
            this.dragonMat.ior = params.ior;
        });

        GUIHelp.add(params, 'thickness', 0, 5, 0.01).onChange(() => {
            this.dragonMat.thicknessFactor = params.thickness;
        });

        GUIHelp.addColor(params, 'attenuationColor').onChange(() => {
            const c = (params.attenuationColor as any).rgba;
            this.dragonMat.attenuationColor = new Color(c[0] / 255, c[1] / 255, c[2] / 255, 1);
        });

        GUIHelp.add(params, 'attenuationDistance', 0, 1, 0.01).onChange(() => {
            this.dragonMat.attenuationDistance = params.attenuationDistance;
        });

        // specularColor.rgb = F0 for dielectrics (Fresnel at 0°, ~0.04
        // by default; tinting it adjusts grazing-angle reflection hue).
        // specularColor.a = specularIntensity scalar that the shader
        // multiplies into the preserved specular-like term — see
        // PBRLitShader's USE_TRANSMISSION block.
        const applySpecular = () => {
            const c = (params.specularColor as any).rgba;
            const k = params.specularIntensity;
            (this.dragonMat as any).shader.setUniformColor(
                'specularColor',
                new Color(c[0] / 255, c[1] / 255, c[2] / 255, k),
            );
        };
        GUIHelp.add(params, 'specularIntensity', 0, 1, 0.01).onChange(applySpecular);
        GUIHelp.addColor(params, 'specularColor').onChange(applySpecular);

        GUIHelp.add(params, 'envMapIntensity', 0, 1, 0.01).onChange(() => {
            (this.dragonMat as any).shader.envIntensity = params.envMapIntensity * this.envMapBaseIntensity;
        });

        // We have no global tonemap-exposure knob (ACES is inline in
        // LightingFunction_frag and bakes a fixed exposure). Approximate
        // by scaling both the IBL and the directional light — visually
        // close enough for the demo's purposes.
        GUIHelp.add(params, 'exposure', 0, 1, 0.01).onChange(() => {
            const k = params.exposure;
            this.directLight.intensity = this.lightBaseIntensity * k;
            (this.dragonMat as any).shader.envIntensity = params.envMapIntensity * this.envMapBaseIntensity * k;
        });

        GUIHelp.open();
    }
}

new Sample_TransmissionAlpha().run();
