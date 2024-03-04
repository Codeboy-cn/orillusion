import { AtmosphericComponent, CameraUtil, DirectLight, Engine3D, GTAOPost, HoverCameraController, KelvinUtil, Object3D, PostProcessingComponent, Scene3D, View3D } from "@orillusion/core";

export class Sample_LoadSTL {
    async run() {
        await Engine3D.init();

        let scene = new Scene3D();

        let camera = CameraUtil.createCamera3DObject(scene);
        camera.perspective(60, Engine3D.aspect, 0.01, 5000.0);

        let ctrl = camera.object3D.addComponent(HoverCameraController);
        ctrl.setCamera(0, -45, 100);
        ctrl.maxDistance = 1000;

        let lightObj3D = new Object3D();
        lightObj3D.x = 0;
        lightObj3D.y = 30;
        lightObj3D.z = -40;
        lightObj3D.rotationX = 144;
        lightObj3D.rotationY = 0;
        lightObj3D.rotationZ = 0;
        let directLight = lightObj3D.addComponent(DirectLight);
        directLight.lightColor = KelvinUtil.color_temperature_to_rgb(5355);
        directLight.castShadow = true;
        directLight.intensity = 25;
        scene.addChild(lightObj3D);

        let sky = scene.addComponent(AtmosphericComponent);
        sky.relativeTransform = lightObj3D.transform;

        let obj = await Engine3D.res.loadSTL("stls/2019-11-12_00001-006-upperjaw.stl");
        obj.scaleX = 1;
        obj.scaleY = 1;
        obj.scaleZ = 1;
        scene.addChild(obj);

        let renderView = new View3D();
        renderView.scene = scene;
        renderView.camera = camera;
        Engine3D.startRenderView(renderView);

        let ppc = scene.addComponent(PostProcessingComponent);
        ppc.addPost(GTAOPost);
    }
}
