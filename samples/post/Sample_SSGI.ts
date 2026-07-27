import { Engine3D, View3D, Scene3D, CameraUtil, AtmosphericComponent, Object3D, Object3DUtil, DirectLight, KelvinUtil, HoverCameraController, PostProcessingComponent, FXAAPost, SSGIPost } from '@orillusion/core';
import { GUIHelp } from '@orillusion/debug/GUIHelp';
import { GUIUtil } from '@samples/utils/GUIUtil';

// Screen-space GI showcase: two saturated walls forming a corner, white
// floor and white blockers next to the walls. The sun lights the walls;
// SSGI bleeds their color onto the nearby white surfaces — an effect the
// DDGI probe volume is too coarse to resolve at contact scale.
class Sample_SSGI {
    lightObj3D: Object3D;
    scene: Scene3D;

    async run() {
        const engine = await Engine3D.init({
            setting: {
                // Dim the open sky so wall bounce is not swamped by sky ambient.
                sky: { skyExposure: 0.25 },
            },
        });
        GUIHelp.init();

        this.scene = new Scene3D();
        let sky = this.scene.addComponent(AtmosphericComponent);

        let camera = CameraUtil.createCamera3DObject(this.scene);
        camera.perspective(60, engine.aspect, 0.1, 5000.0);
        let ctrl = camera.object3D.addComponent(HoverCameraController);
        ctrl.setCamera(-30, -20, 260);
        ctrl.maxDistance = 1000;

        let view = new View3D();
        view.scene = this.scene;
        view.camera = camera;

        this.initScene();

        {
            this.lightObj3D = new Object3D();
            this.lightObj3D.rotationX = 40;
            this.lightObj3D.rotationY = 150;
            let directLight = this.lightObj3D.addComponent(DirectLight);
            directLight.lightColor = KelvinUtil.color_temperature_to_rgb(5355);
            directLight.castShadow = true;
            directLight.intensity = 3;
            this.scene.addChild(this.lightObj3D);
            GUIUtil.renderDirLight(directLight);
        }
        sky.relativeTransform = this.lightObj3D.transform;

        engine.startRenderView(view);

        let postCom = this.scene.addComponent(PostProcessingComponent);
        let ssgi = postCom.addPost(SSGIPost);
        // Engine defaults are tuned for contact-scale bleed; this scene's
        // walls are large, so widen the gather for a clearer showcase.
        ssgi.radius = 60;
        ssgi.intensity = 1.5;
        postCom.addPost(FXAAPost);
        GUIUtil.renderSSGI(ssgi, true);
    }

    initScene() {
        // white floor
        let floor = Object3DUtil.GetSingleCube(500, 10, 500, 0.8, 0.8, 0.8);
        floor.y = -5;
        this.scene.addChild(floor);

        // red back wall (z = -150) and green left wall (x = -150)
        let redWall = Object3DUtil.GetSingleCube(500, 150, 10, 0.9, 0.05, 0.05);
        redWall.y = 75; redWall.z = -145;
        this.scene.addChild(redWall);

        let greenWall = Object3DUtil.GetSingleCube(10, 150, 500, 0.05, 0.9, 0.05);
        greenWall.x = -145; greenWall.y = 75;
        this.scene.addChild(greenWall);

        // white receivers close to the colored walls
        let tallBox = Object3DUtil.GetSingleCube(50, 110, 50, 0.85, 0.85, 0.85);
        tallBox.x = 20; tallBox.y = 55; tallBox.z = -105;
        this.scene.addChild(tallBox);

        let ball = Object3DUtil.GetSingleSphere(30, 0.85, 0.85, 0.85);
        ball.x = -100; ball.y = 30; ball.z = 0;
        this.scene.addChild(ball);

        let smallBox = Object3DUtil.GetSingleCube(40, 40, 40, 0.85, 0.85, 0.85);
        smallBox.x = -60; smallBox.y = 20; smallBox.z = -80;
        smallBox.rotationY = 30;
        this.scene.addChild(smallBox);
    }
}

new Sample_SSGI().run();
