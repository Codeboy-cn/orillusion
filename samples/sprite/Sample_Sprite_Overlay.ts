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
 * Screen-space sprites rendered through an `OverlayCamera`:
 *  - top-left: health bar (pivot 0,0)
 *  - bottom-right: mini-map (pivot 1,1)
 * Both positioned in canvas pixels so the OverlayCamera's top-left origin
 * is visibly correct.
 */
class Sample_Sprite_Overlay {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;
    lightObj: Object3D;
    texture: BitmapTexture2D;

    private overlay: OverlayCamera;
    private healthObj: Object3D;
    private health: Sprite;
    private mapObj: Object3D;
    private map: Sprite;

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

        /******** health bar (pivot top-left) *******/
        {
            this.healthObj = new Object3D();
            this.health = this.healthObj.addComponent(Sprite);
            this.health.texture = this.texture;
            this.health.size = new Vector2(240, 24);
            this.health.pivot = new Vector2(0, 0);
            this.health.color = new Color(0.4, 1.0, 0.4, 1);
            this.health.fillRatio = 0.7;
            this.health.fillDirection = 0;
            this.health.cornerRadius = 4;
            this.healthObj.x = 16;
            this.healthObj.y = 16;
            this.overlay.attach(this.healthObj);
        }

        /******** mini-map (pivot bottom-right) *******/
        {
            this.mapObj = new Object3D();
            this.map = this.mapObj.addComponent(Sprite);
            this.map.texture = this.texture;
            this.map.size = new Vector2(160, 160);
            this.map.pivot = new Vector2(1, 1);
            this.map.color = new Color(1, 1, 1, 0.8);
            this.map.cornerRadius = 12;
            this.mapObj.x = this.engine.context3D.presentationSize[0] / this.engine.context3D.pixelRatio - 16;
            this.mapObj.y = this.engine.context3D.presentationSize[1] / this.engine.context3D.pixelRatio - 16;
            this.overlay.attach(this.mapObj);
        }
    }

    private initGUI() {
        /******** Health bar *******/
        GUIHelp.addFolder('Health bar');
        const healthState = {
            x: this.healthObj.x,
            y: this.healthObj.y,
            w: 240,
            h: 24,
            fill: 0.7,
            dir: 0,
            corner: 4,
            color: this.health.color!,
        };
        const fillDirOptions = { 'left→right': 0, 'right→left': 1, 'down→up': 2, 'up→down': 3 };
        GUIHelp.add(healthState, 'x', 0, 800, 1).onChange(v => this.healthObj.x = v);
        GUIHelp.add(healthState, 'y', 0, 800, 1).onChange(v => this.healthObj.y = v);
        GUIHelp.add(healthState, 'w', 8, 600, 1).onChange(v => this.health.size = new Vector2(v, healthState.h));
        GUIHelp.add(healthState, 'h', 4, 200, 1).onChange(v => this.health.size = new Vector2(healthState.w, v));
        GUIHelp.add(healthState, 'fill', 0, 1, 0.01).onChange(v => this.health.fillRatio = v);
        GUIHelp.add(healthState, 'dir', fillDirOptions).onChange(v => this.health.fillDirection = +v);
        GUIHelp.add(healthState, 'corner', 0, 32, 0.5).onChange(v => this.health.cornerRadius = v);
        GUIHelp.addColor(healthState, 'color').onChange(c => this.health.color = c);
        GUIHelp.open();
        GUIHelp.endFolder();

        /******** Mini-map *******/
        GUIHelp.addFolder('Mini-map');
        const mapState = { x: this.mapObj.x, y: this.mapObj.y, size: 160, alpha: 0.8, corner: 12 };
        GUIHelp.add(mapState, 'x', 0, 1200, 1).onChange(v => this.mapObj.x = v);
        GUIHelp.add(mapState, 'y', 0, 1200, 1).onChange(v => this.mapObj.y = v);
        GUIHelp.add(mapState, 'size', 32, 320, 1).onChange(v => this.map.size = new Vector2(v, v));
        GUIHelp.add(mapState, 'alpha', 0, 1, 0.01).onChange(v => this.map.color = new Color(1, 1, 1, v));
        GUIHelp.add(mapState, 'corner', 0, 80, 0.5).onChange(v => this.map.cornerRadius = v);
        GUIHelp.open();
        GUIHelp.endFolder();

        GUIUtil.renderDirLight(this.lightObj.getComponent(DirectLight));
    }
}

new Sample_Sprite_Overlay().run();
