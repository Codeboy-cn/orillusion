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
    View3D,
} from "@orillusion/core";
import { GUIUtil } from "@samples/utils/GUIUtil";

/**
 * Two overlay layers with different priorities — back (100) and front (200).
 * The higher-priority overlay renders on top. GUI lets you drag each sprite
 * around to observe the z-ordering.
 */
class Sample_Sprite_MultiOverlay {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;
    lightObj: Object3D;
    texture: BitmapTexture2D;

    private backOverlay: OverlayCamera;
    private frontOverlay: OverlayCamera;
    private backObj: Object3D;
    private backSprite: Sprite;
    private frontObj: Object3D;
    private frontSprite: Sprite;

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

        /******** texture *******/
        {
            this.texture = new BitmapTexture2D(true, this.engine.context3D);
            this.texture.flipY = true;
            await this.texture.load('textures/KB3D_NTT_Ads_basecolor.png');
        }

        /******** back layer (priority 100) *******/
        {
            this.backOverlay = this.view.createOverlayCamera(100);

            this.backObj = new Object3D();
            this.backSprite = this.backObj.addComponent(Sprite);
            this.backSprite.texture = this.texture;
            this.backSprite.size = new Vector2(280, 180);
            this.backSprite.pivot = new Vector2(0.5, 0.5);
            this.backSprite.color = new Color(0.6, 0.6, 1, 1);
            this.backSprite.cornerRadius = 12;
            this.backObj.x = 180;
            this.backObj.y = 160;
            this.backOverlay.attach(this.backObj);
        }

        /******** front layer (priority 200) *******/
        {
            this.frontOverlay = this.view.createOverlayCamera(200);

            this.frontObj = new Object3D();
            this.frontSprite = this.frontObj.addComponent(Sprite);
            this.frontSprite.texture = this.texture;
            this.frontSprite.size = new Vector2(160, 100);
            this.frontSprite.pivot = new Vector2(0.5, 0.5);
            this.frontSprite.color = new Color(1, 0.5, 0.3, 1);
            this.frontSprite.cornerRadius = 8;
            this.frontObj.x = 220;
            this.frontObj.y = 180;
            this.frontOverlay.attach(this.frontObj);
        }
    }

    private initGUI() {
        /******** Back layer *******/
        GUIHelp.addFolder('Back layer (priority 100)');
        const backState = { x: this.backObj.x, y: this.backObj.y, color: this.backSprite.color! };
        GUIHelp.add(backState, 'x', 0, 1200, 1).onChange(v => this.backObj.x = v);
        GUIHelp.add(backState, 'y', 0, 1200, 1).onChange(v => this.backObj.y = v);
        GUIHelp.addColor(backState, 'color').onChange(c => this.backSprite.color = c);
        GUIHelp.open();
        GUIHelp.endFolder();

        /******** Front layer *******/
        GUIHelp.addFolder('Front layer (priority 200)');
        const frontState = { x: this.frontObj.x, y: this.frontObj.y, color: this.frontSprite.color! };
        GUIHelp.add(frontState, 'x', 0, 1200, 1).onChange(v => this.frontObj.x = v);
        GUIHelp.add(frontState, 'y', 0, 1200, 1).onChange(v => this.frontObj.y = v);
        GUIHelp.addColor(frontState, 'color').onChange(c => this.frontSprite.color = c);
        GUIHelp.open();
        GUIHelp.endFolder();

        GUIUtil.renderDirLight(this.lightObj.getComponent(DirectLight));
    }
}

new Sample_Sprite_MultiOverlay().run();
