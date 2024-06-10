import { GUIHelp } from "@orillusion/debug/GUIHelp";
import { AtmosphericComponent, BoxGeometry, CameraUtil, CylinderGeometry, DirectLight, Engine3D, FlyCameraController, KelvinUtil, LitMaterial, MeshRenderer, Object3D, Scene3D, SphereGeometry, Vector2, Vector3, View3D } from "../../src";
import { Geometry } from "./SupportGenerator/Geometry";

export class Sample_MeshJoint {

    protected view: View3D;

    async run() {
        await Engine3D.init();

        GUIHelp.init();

        let scene = new Scene3D();

        let sky = scene.addComponent(AtmosphericComponent)
        sky.sunY = 0.6;
        // sky.enable = false;

        // init camera3D
        let mainCamera = CameraUtil.createCamera3D(null, scene);
        mainCamera.perspective(60, Engine3D.aspect, 0.01, 200.0);
        // this.mainCamera = mainCamera;
        mainCamera.object3D.addComponent(FlyCameraController);

        // add a basic direct light
        let lightObj = new Object3D();
        lightObj.rotationX = 45;
        lightObj.rotationY = 60;
        lightObj.rotationZ = 150;
        let dirLight = lightObj.addComponent(DirectLight);
        dirLight.lightColor = KelvinUtil.color_temperature_to_rgb(5355);
        dirLight.intensity = 20;
        scene.addChild(lightObj);
        sky.relativeTransform = dirLight.transform;

        // create a view with target scene and camera
        this.view = new View3D();
        this.view.scene = scene;
        this.view.camera = mainCamera;

        // start render
        Engine3D.startRenderView(this.view);

        this.view.graphic3D.drawAxis('axis');

        await this.initScene();
    }

    private async initScene() {
        let box = new Object3D();
        box.y = 0.5;
        box.x = 5;
        let mr = box.addComponent(MeshRenderer);
        mr.geometry = new BoxGeometry(1, 1, 1);
        mr.material = new LitMaterial();
        this.view.scene.addChild(box);

        let sphere = new Object3D();
        sphere.y = 2;
        mr = sphere.addComponent(MeshRenderer);
        mr.geometry = new SphereGeometry(2, 16, 16);
        mr.material = new LitMaterial();
        this.view.scene.addChild(sphere);

        let cylinder = new Object3D();
        cylinder.y = 0.5;
        cylinder.z = 5;
        mr = cylinder.addComponent(MeshRenderer);
        mr.geometry = new CylinderGeometry();
        mr.materials = [new LitMaterial(), new LitMaterial(), new LitMaterial()];
        this.view.scene.addChild(cylinder);

        GUIHelp.addButton('jointMesh', async () => {
            let meshObjs = [box, sphere, cylinder];
            let splicingPoint = [
                new Vector2(0, 0), new Vector2(5, 0),
                new Vector2(0, 0), new Vector2(0, 5),
            ];
            this.jointAllMesh(meshObjs, splicingPoint);
        });
    }

    private jointAllMesh(meshObj: Object3D[], splicingPoint: Vector2[]) {
        let linkGeometry = new Geometry();
        for (let i = 0; i < splicingPoint.length; i+=2) {
            const s = splicingPoint[i];
            const e = splicingPoint[i + 1];

            let startPos = Vector3.HELP_0.set(s.x, 0, s.y);
            let endPos = Vector3.HELP_1.set(e.x, 0, e.y);
            linkGeometry.buildLinkBase(startPos, endPos, 0.4, 0.1);
        }

        let linkObj = new Object3D();
        let linkMesh = linkObj.addComponent(MeshRenderer);
        linkMesh.geometry = linkGeometry.toGeometryBase();
        linkMesh.material = new LitMaterial();
        this.view.scene.addChild(linkObj);
    }
}
