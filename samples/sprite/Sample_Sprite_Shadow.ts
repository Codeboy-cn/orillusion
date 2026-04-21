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
    UIUtil,
    Vector2,
    View3D,
} from "@orillusion/core";
import { GUIUtil } from "@samples/utils/GUIUtil";

/**
 * `UIUtil.wrapShadow` — drop shadow via a sibling Sprite tinted + offset
 * behind the target. GUI params rebuild the shadow Object3D on each
 * change (the helper is idempotent).
 */
class Sample_Sprite_Shadow {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;
    lightObj: Object3D;
    texture: BitmapTexture2D;

    private overlay: OverlayCamera;
    private targetObj: Object3D;
    private targetSprite: Sprite;
    private shadow: Object3D | null = null;

    private readonly state = {
        offsetX: 12,
        offsetY: 18,
        color: new Color(0.2, 0.05, 0.05, 1),
        alphaScale: 0.55,
        spriteCorner: 12,
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

        /******** target sprite + initial shadow *******/
        {
            this.targetObj = new Object3D();
            this.targetSprite = this.targetObj.addComponent(Sprite);
            this.targetSprite.texture = this.texture;
            this.targetSprite.size = new Vector2(220, 220);
            this.targetSprite.pivot = new Vector2(0, 0);
            this.targetSprite.cornerRadius = this.state.spriteCorner;
            this.targetSprite.color = new Color(1, 0.95, 0.8, 1);
            this.targetObj.x = 80;
            this.targetObj.y = 80;
            this.overlay.attach(this.targetObj);

            this.rebuildShadow();
        }
    }

    private rebuildShadow() {
        if (this.shadow) this.shadow.removeFromParent();
        this.shadow = UIUtil.wrapShadow(this.targetObj, {
            offset: new Vector2(this.state.offsetX, this.state.offsetY),
            color: this.state.color,
            alphaScale: this.state.alphaScale,
        });
    }

    private initGUI() {
        GUIHelp.addFolder('Shadow');
        GUIHelp.add(this.state, 'offsetX', -40, 40, 0.5).onChange(() => this.rebuildShadow());
        GUIHelp.add(this.state, 'offsetY', -40, 40, 0.5).onChange(() => this.rebuildShadow());
        GUIHelp.add(this.state, 'alphaScale', 0, 1, 0.01).onChange(() => this.rebuildShadow());
        GUIHelp.addColor(this.state, 'color').onChange(() => this.rebuildShadow());
        GUIHelp.add(this.state, 'spriteCorner', 0, 80, 0.5).onChange(v => {
            this.targetSprite.cornerRadius = v;
            this.rebuildShadow();
        });
        GUIHelp.open();
        GUIHelp.endFolder();

        GUIUtil.renderDirLight(this.lightObj.getComponent(DirectLight));
    }
}

new Sample_Sprite_Shadow().run();
