import { Engine3D, View3D, Scene3D, CameraUtil, AtmosphericComponent, Object3D, Object3DUtil, DirectLight, KelvinUtil, HoverCameraController, PostProcessingComponent, FXAAPost, SSGIPost, Vector3, MeshRenderer } from '@orillusion/core';
import { GUIHelp } from '@orillusion/debug/GUIHelp';
import { GUIUtil } from '@samples/utils/GUIUtil';

// Screen-space GI showcase: an open Cornell-style corner (red wall,
// green wall, white floor and a white ceiling slab over the inner
// corner) with a low sun slanting in through the opening.
//
// The layout separates lit and unlit geometry by pure N.L facing, so
// the contrast does not depend on shadow mapping: the sun reaches only
// the lower bands of the colored walls (the ceiling slab blocks the
// rest), while the ceiling underside, the receivers' camera-facing
// sides and the deep floor face away from the sun and stay near black.
// Everything dark in frame is then lit exclusively by the screen-space
// bounce — toggling SSGI switches those surfaces between near-black
// and wall-colored.
class Sample_SSGI {
    lightObj3D: Object3D;
    scene: Scene3D;

    async run() {
        const engine = await Engine3D.init({
            setting: {
                // Nearly kill the sky ambient: any environment fill would
                // re-light the shadowed receivers and mask the bounce.
                sky: { skyExposure: 0.05 },
            },
        });
        GUIHelp.init();

        this.scene = new Scene3D();
        let sky = this.scene.addComponent(AtmosphericComponent);

        let camera = CameraUtil.createCamera3DObject(this.scene);
        camera.perspective(60, engine.aspect, 0.1, 5000.0);
        let ctrl = camera.object3D.addComponent(HoverCameraController);
        // Look through the opening into the corner: the sunlit wall
        // bands, the dark ceiling underside and the receivers share the
        // frame — SSGI needs its emitters on screen.
        ctrl.setCamera(30, -12, 210, new Vector3(-35, 35, -35));
        ctrl.maxDistance = 600;

        let view = new View3D();
        view.scene = this.scene;
        view.camera = camera;

        this.initScene();

        {
            this.lightObj3D = new Object3D();
            // Low sun through the diagonal opening: both colored walls
            // take it at ~45 deg azimuth. The ceiling slab clips every
            // ray aimed above y ~ 38 on the walls, so only their lower
            // bands stay sunlit — by facing geometry alone, no shadow
            // map required.
            this.lightObj3D.rotationX = 20;
            this.lightObj3D.rotationY = 135;
            let directLight = this.lightObj3D.addComponent(DirectLight);
            directLight.lightColor = KelvinUtil.color_temperature_to_rgb(5355);
            directLight.castShadow = true;
            // Only the wall bands are sunlit — push the intensity so
            // they carry enough radiance to feed the bounce.
            directLight.intensity = 5;
            directLight.enableCSM = true;
            this.scene.addChild(this.lightObj3D);
            GUIUtil.renderDirLight(directLight);
        }
        sky.relativeTransform = this.lightObj3D.transform;

        engine.startRenderView(view);

        let postCom = this.scene.addComponent(PostProcessingComponent);
        let ssgi = postCom.addPost(SSGIPost);
        // The lit wall bands sit 40-150 units from the dark receivers —
        // size the world-space gather to span that.
        ssgi.radius = 40;
        ssgi.giIntensity = 10;
        postCom.addPost(FXAAPost);
        GUIUtil.renderSSGI(ssgi, true);
    }

    // Shadow casting is gated at two levels (renderer flag and material
    // shader state); the material one defaults off for Object3DUtil
    // primitives. The showcase reads correctly without shadow maps, but
    // enable casting so the ceiling also drops a true contact shadow
    // where supported.
    private addCaster(obj: Object3D) {
        let renderer = obj.getComponent(MeshRenderer);
        renderer.castShadow = true;
        renderer.material.castShadow = true;
        this.scene.addChild(obj);
    }

    initScene() {
        // white floor: sunlit only near the opening, dark under the slab.
        let floor = Object3DUtil.GetSingleCube(240, 10, 240, 0.8, 0.8, 0.8);
        floor.y = -5;
        this.scene.addChild(floor);

        // The emitters: red back wall (z = -115) and green left wall
        // (x = -115). Their lower bands catch the sun under the ceiling
        // slab and feed the bounce.
        let redWall = Object3DUtil.GetSingleCube(240, 90, 10, 0.9, 0.05, 0.05);
        redWall.y = 45; redWall.z = -115;
        this.addCaster(redWall);

        let greenWall = Object3DUtil.GetSingleCube(10, 90, 240, 0.05, 0.9, 0.05);
        greenWall.x = -115; greenWall.y = 45;
        this.addCaster(greenWall);

        // White receivers under the slab, hugging the colored walls so
        // the bleed reads at contact scale. Their camera-facing sides
        // point away from the sun and are lit by bounce only.
        let tallBox = Object3DUtil.GetSingleCube(26, 60, 26, 0.85, 0.85, 0.85);
        tallBox.x = -40; tallBox.y = 30; tallBox.z = -75;
        this.addCaster(tallBox);

        let ball = Object3DUtil.GetSingleSphere(16, 0.85, 0.85, 0.85);
        ball.x = -85; ball.y = 16; ball.z = -15;
        this.addCaster(ball);

        let smallBox = Object3DUtil.GetSingleCube(22, 22, 22, 0.85, 0.85, 0.85);
        smallBox.x = -70; smallBox.y = 11; smallBox.z = -50;
        smallBox.rotationY = 30;
        this.addCaster(smallBox);
    }
}

new Sample_SSGI().run();
