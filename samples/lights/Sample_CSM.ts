import { GUIHelp } from "@orillusion/debug/GUIHelp";
import { Scene3D, HoverCameraController, Engine3D, AtmosphericComponent, Object3D, Camera3D, Vector3, View3D, DirectLight, KelvinUtil, LitMaterial, MeshRenderer, BoxGeometry, CameraUtil, SphereGeometry, Color, Object3DUtil, BlendMode } from "@orillusion/core";
import { GUIUtil } from "@samples/utils/GUIUtil";
import { Graphic3D } from "@orillusion/graphic";

//sample of csm
class Sample_CSM {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;
    light: DirectLight;
    boxRenderer: MeshRenderer;
    viewCamera: Camera3D;
    graphic3D: Graphic3D;
    async run() {
        const engine = this.engine = await Engine3D.init({
            setting: {
                shadow: {
                    autoUpdate: true,
                    shadowSize: 2048,
                },
            },
            renderLoop: () => { this.loop(); }
        });

        GUIHelp.init();

        this.scene = new Scene3D();
        let sky = this.scene.addComponent(AtmosphericComponent);

        // init camera3D
        let mainCamera = CameraUtil.createCamera3D(null, this.scene);
        mainCamera.perspective(60, engine.aspect, 1, 5000.0);
        //set camera data
        mainCamera.object3D.z = -15;
        mainCamera.object3D.addComponent(HoverCameraController).setCamera(-15, -35, 200);

        sky.relativeTransform = this.initLight('mainLight', 3, 45, true).transform;
        this.initLight('csmLight2', 2, 22.5, true);
        this.initScene();

        let view = new View3D();
        view.scene = this.scene;
        view.camera = mainCamera;
        this.view = view;
        this.viewCamera = mainCamera;

        this.graphic3D = new Graphic3D();
        this.scene.addChild(this.graphic3D);

        GUIHelp.addFolder('CSM')
        GUIHelp.add(engine.setting.shadow, 'csmScatteringExp', 0.5, 1.0, 0.01);
        GUIHelp.add(engine.setting.shadow, 'csmMargin', 0.01, 0.5, 0.01);
        GUIHelp.add(engine.setting.shadow, 'csmAreaScale', 0.1, 1, 0.01);
        GUIHelp.open();
        GUIHelp.endFolder();
        engine.startRenderView(view);
    }

    // create direction light
    private initLight(name: string, intensity: number, rotY: number, enableCSM: boolean) {
        let lightObj3D = new Object3D();
        lightObj3D.name = name;
        lightObj3D.rotationX = 46;
        lightObj3D.rotationY = 62 + rotY;
        lightObj3D.rotationZ = 0;
        let sunLight = lightObj3D.addComponent(DirectLight);
        sunLight.intensity = intensity;
        sunLight.lightColor = KelvinUtil.color_temperature_to_rgb(6553);
        sunLight.castShadow = true;
        sunLight.enableCSM = enableCSM;

        GUIUtil.renderDirLight(sunLight);
        this.scene.addChild(lightObj3D);
        this.light = sunLight;
        return sunLight;
    }

    initScene() {
        {
            // Tall column. BoxGeometry is centred at its origin; raise by
            // half-height so the base sits on the floor plane (y=0.5 top
            // of the floor slab). Previously y=0 buried the lower 50 units
            // below the floor, which combined with back-face shadow cast
            // (CastShadowMaterialPass.cullMode='front') produced peter-
            // panning: the shadow map stores the back-face at y=-50,
            // leaving the floor fragments at the caster base comparing
            // against a depth well below the receiver and coming back
            // "lit" when they should be shadowed.
            let obj = new Object3D();
            let mr = obj.addComponent(MeshRenderer);
            mr.geometry = new BoxGeometry(20, 100, 20);
            mr.material = new LitMaterial();
            obj.y = 50;
            this.scene.addChild(obj);
        }

        this.createBox();
        {
            let mat = new LitMaterial();
            mat.baseMap = this.engine.res.grayTexture;
            let floor = new Object3D();
            let mr = floor.addComponent(MeshRenderer);
            mr.geometry = new BoxGeometry(10000, 1, 10000);
            mr.material = mat;
            this.scene.addChild(floor);
        }

        for (let i = 0; i < 1000; i++) {
            let item = Object3DUtil.GetSingleSphere(4, 0.6, 0.4, 0.2);
            let angle = Math.PI * 4 * i / 50;
            item.x = Math.sin(angle) * (50 + i ** 1.4);
            item.z = Math.cos(angle) * (50 + i ** 1.4);
            let scale = ((i ** 1.4) * 5 + 1000) / 1000;
            item.scaleX = item.scaleZ = scale;
            item.scaleY = scale * 5;
            // Sit the sphere's bottom on the floor. Vertical half-extent
            // = sphere radius (4) × scaleY = 20 * scale; place the centre
            // at that height. Previously y=4 buried the sphere down to
            // y≈-16, which caused back-face shadow cast to record depth
            // well below the floor and produced the "shadow starts
            // mid-tree" peter-panning effect.
            item.y = 20 * scale;
            this.scene.addChild(item);
        }
    }

    createBox() {
        let box = new Object3D();
        let geom = new BoxGeometry(1, 1, 1);
        let material = new LitMaterial();
        // material.transparent = true;
        // material.shaderState.depthWriteEnabled = false
        material.blendMode = BlendMode.NORMAL;
        material.cullMode = "front";
        material.baseColor = new Color(0.2, 0.2, 0, 0.1);
        let renderer = box.addComponent(MeshRenderer);
        renderer.material = material;
        renderer.geometry = geom;
        // this.scene.addChild(box);
        this.boxRenderer = renderer;
    }

    private _shadowPos: Vector3 = new Vector3();
    private _shadowCameraTarget: Vector3 = new Vector3();
    loop() {
        // let viewCamera = this.viewCamera;
        // let light = this.light;
        // let view = this.view;
        // if (!this.boxRenderer || !this.viewCamera.csm)
        //     return;


        // let csmBound = this.viewCamera.csm.children[0].bound;
        // //update box
        // let size = this.viewCamera.getCSMShadowWorldExtents(0) * 2;
        // this.boxRenderer.object3D.scaleX = size;
        // this.boxRenderer.object3D.scaleY = size;
        // this.boxRenderer.object3D.scaleZ = this.viewCamera.csm.children[0].shadowCamera.far;

        // this.boxRenderer.object3D.localRotation = light.transform.localRotation;
        // this.boxRenderer.object3D.localPosition = csmBound.center;

        // // light direction
        // this._shadowPos.copy(light.direction).normalize(viewCamera.far);
        // csmBound.center.add(this._shadowPos, this._shadowCameraTarget);
        // csmBound.center.subtract(this._shadowPos, this._shadowPos);
        // this.graphic3D.drawLines('shadowLine', [this._shadowPos, this._shadowCameraTarget], new Color(1, 1, 0, 1));
    }

}


new Sample_CSM().run();
