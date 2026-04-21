import { GUIHelp } from "@orillusion/debug/GUIHelp";
import {
    AtmosphericComponent,
    BitmapTexture2D,
    CameraUtil,
    Color,
    DirectLight,
    Engine3D,
    HoverCameraController,
    KelvinUtil,
    Object3D,
    OverlayCamera,
    Scene3D,
    Sprite,
    Vector2,
    Vector4,
    View3D,
} from "@orillusion/core";
import { GUIUtil } from "@samples/utils/GUIUtil";

/**
 * SpriteMaterial scissor (UV-space clip + corner radius + fade-out edge).
 * One sprite is fully tunable from the GUI; the second runs an animated
 * wipe so the dynamic-update path is exercised in real time.
 */
class Sample_Sprite_Scissor {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;
    lightObj: Object3D;
    texture: BitmapTexture2D;

    private overlay: OverlayCamera;
    private sprite: Sprite;
    private wipe: Sprite;
    private phase: number = 0;

    private readonly state = {
        scissorLeft: 0.1,
        scissorTop: 0.1,
        scissorRight: 0.9,
        scissorBottom: 0.9,
        cornerRadius: 0.15,
        fadeOut: 0.05,
        spriteCorner: 0,
        wipeAnimate: true,
    };

    async run() {
        GUIHelp.init();

        this.engine = await Engine3D.init({
            renderLoop: () => this.loop(),
        });

        this.scene = new Scene3D();
        let sky = this.scene.addComponent(AtmosphericComponent);

        let camera = CameraUtil.createCamera3DObject(this.scene);
        camera.perspective(60, this.engine.aspect, 0.1, 5000.0);
        camera.object3D.addComponent(HoverCameraController).setCamera(0, -15, 80);

        this.view = new View3D();
        this.view.scene = this.scene;
        this.view.camera = camera;

        this.engine.startRenderView(this.view);

        await this.initScene();
        sky.relativeTransform = this.lightObj.transform;

        this.initGUI();
    }

    async initScene() {
        /******** light *******/
        {
            this.lightObj = new Object3D();
            this.lightObj.rotationX = 45;
            this.lightObj.rotationY = 110;
            let lc = this.lightObj.addComponent(DirectLight);
            lc.lightColor = KelvinUtil.color_temperature_to_rgb(5355);
            lc.intensity = 3;
            this.scene.addChild(this.lightObj);
        }

        /******** overlay + texture *******/
        {
            this.texture = new BitmapTexture2D(true, this.engine.context3D);
            this.texture.flipY = true;
            await this.texture.load('textures/KB3D_NTT_Ads_basecolor.png');

            this.overlay = this.view.createOverlayCamera(100);
        }

        /******** tunable sprite *******/
        {
            const obj = new Object3D();
            this.sprite = obj.addComponent(Sprite);
            this.sprite.texture = this.texture;
            this.sprite.size = new Vector2(240, 240);
            this.sprite.pivot = new Vector2(0, 0);
            this.sprite.color = new Color(1, 1, 1, 1);
            this.applyScissor();
            obj.x = 40;
            obj.y = 40;
            this.overlay.attach(obj);
        }

        /******** animated wipe *******/
        {
            const obj = new Object3D();
            this.wipe = obj.addComponent(Sprite);
            this.wipe.texture = this.texture;
            this.wipe.size = new Vector2(240, 60);
            this.wipe.pivot = new Vector2(0, 0);
            this.wipe.color = new Color(1, 1, 1, 1);
            this.wipe.setScissor(new Vector4(0, 0, 0.5, 1), 0, 0.02);
            obj.x = 40;
            obj.y = 320;
            this.overlay.attach(obj);
        }
    }

    private applyScissor() {
        const s = this.state;
        this.sprite.setScissor(
            new Vector4(s.scissorLeft, s.scissorTop, s.scissorRight, s.scissorBottom),
            s.cornerRadius,
            s.fadeOut,
        );
        this.sprite.cornerRadius = s.spriteCorner;
    }

    private loop() {
        if (!this.wipe || !this.state.wipeAnimate) return;
        this.phase = (this.phase + 0.01) % (Math.PI * 2);
        const right = 0.5 + 0.5 * Math.sin(this.phase);
        this.wipe.setScissor(new Vector4(0, 0, right, 1), 0, 0.02);
    }

    private initGUI() {
        /******** Scissor (top sprite) *******/
        GUIHelp.addFolder('Scissor (top sprite)');
        GUIHelp.add(this.state, 'scissorLeft', 0, 1, 0.01).onChange(() => this.applyScissor());
        GUIHelp.add(this.state, 'scissorTop', 0, 1, 0.01).onChange(() => this.applyScissor());
        GUIHelp.add(this.state, 'scissorRight', 0, 1, 0.01).onChange(() => this.applyScissor());
        GUIHelp.add(this.state, 'scissorBottom', 0, 1, 0.01).onChange(() => this.applyScissor());
        GUIHelp.add(this.state, 'cornerRadius', 0, 0.5, 0.005).onChange(() => this.applyScissor());
        GUIHelp.add(this.state, 'fadeOut', 0, 0.2, 0.001).onChange(() => this.applyScissor());
        GUIHelp.add(this.state, 'spriteCorner', 0, 80, 0.5).onChange(() => this.applyScissor());
        GUIHelp.open();
        GUIHelp.endFolder();

        /******** Wipe *******/
        GUIHelp.addFolder('Wipe (bottom sprite)');
        GUIHelp.add(this.state, 'wipeAnimate');
        GUIHelp.open();
        GUIHelp.endFolder();

        GUIUtil.renderDirLight(this.lightObj.getComponent(DirectLight));
    }
}

new Sample_Sprite_Scissor().run();
