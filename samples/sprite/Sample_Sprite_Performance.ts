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
    SpriteRenderer,
    Vector2,
    View3D,
} from "@orillusion/core";
import { GUIUtil } from "@samples/utils/GUIUtil";

/**
 * Per-Sprite baseline (no batching) — one draw per sprite. Compare the
 * frame time against Sample_Sprite_Batcher which renders the same shape
 * set in a single draw call.
 */
class Sample_Sprite_Performance {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;
    lightObj: Object3D;
    texture: BitmapTexture2D;

    private overlay: OverlayCamera;
    private objects: Object3D[] = [];

    private readonly state = {
        count: 200,
        tileSize: 24,
        spacing: 30,
    };

    async run() {
        GUIHelp.init();

        this.engine = await Engine3D.init({});

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

        /******** sprite swarm *******/
        this.rebuild();
    }

    private rebuild() {
        for (const o of this.objects) o.removeFromParent();
        this.objects.length = 0;

        const s = this.state;
        const cols = Math.max(4, Math.floor(800 / s.spacing));
        for (let i = 0; i < s.count; i++) {
            const obj = new Object3D();
            const sprite = obj.addComponent(SpriteRenderer);
            sprite.texture = this.texture;
            sprite.size = new Vector2(s.tileSize, s.tileSize);
            sprite.pivot = new Vector2(0.5, 0.5);
            sprite.color = new Color(
                0.3 + 0.7 * ((i * 37) % 100) / 100,
                0.3 + 0.7 * ((i * 91) % 100) / 100,
                0.3 + 0.7 * ((i * 53) % 100) / 100,
                1,
            );
            obj.x = 24 + (i % cols) * s.spacing;
            obj.y = 24 + Math.floor(i / cols) * s.spacing;
            this.overlay.attach(obj);
            this.objects.push(obj);
        }
    }

    private initGUI() {
        GUIHelp.addFolder('Sprite count (baseline)');
        GUIHelp.add(this.state, 'count', 1, 2000, 1).onChange(() => this.rebuild());
        GUIHelp.add(this.state, 'tileSize', 4, 64, 1).onChange(() => this.rebuild());
        GUIHelp.add(this.state, 'spacing', 6, 80, 1).onChange(() => this.rebuild());
        GUIHelp.open();
        GUIHelp.endFolder();

        GUIUtil.renderDirLight(this.lightObj.getComponent(DirectLight));
    }
}

new Sample_Sprite_Performance().run();
