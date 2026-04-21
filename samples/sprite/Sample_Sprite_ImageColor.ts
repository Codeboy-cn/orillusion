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
 * Tinted sprite grid on an overlay view. GUI exposes master tint + grid
 * dimensions; the grid is rebuilt in-place on each change.
 */
class Sample_Sprite_ImageColor {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;
    lightObj: Object3D;
    texture: BitmapTexture2D;

    private overlay: OverlayCamera;
    private objs: Object3D[] = [];
    private sprites: Sprite[] = [];

    private readonly state = {
        cols: 4,
        rows: 2,
        tile: 80,
        spacing: 90,
        tint: new Color(1, 1, 1, 1),
    };

    private readonly palette: Color[] = [
        new Color(1, 1, 1, 1),
        new Color(1, 0.4, 0.4, 1),
        new Color(0.4, 1, 0.4, 1),
        new Color(0.4, 0.4, 1, 1),
        new Color(1, 1, 0.4, 0.8),
        new Color(1, 0.4, 1, 0.6),
        new Color(0.4, 1, 1, 0.4),
        new Color(1, 1, 1, 0.2),
    ];

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

        /******** sprite grid *******/
        this.rebuildGrid();
    }

    private rebuildGrid() {
        for (const o of this.objs) o.removeFromParent();
        this.objs.length = 0;
        this.sprites.length = 0;

        const total = this.state.cols * this.state.rows;
        for (let i = 0; i < total; i++) {
            const obj = new Object3D();
            const sprite = obj.addComponent(Sprite);
            sprite.texture = this.texture;
            sprite.size = new Vector2(this.state.tile, this.state.tile);
            sprite.pivot = new Vector2(0, 0);

            const base = this.palette[i % this.palette.length];
            sprite.color = new Color(
                base.r * this.state.tint.r,
                base.g * this.state.tint.g,
                base.b * this.state.tint.b,
                base.a * this.state.tint.a,
            );

            obj.x = 40 + (i % this.state.cols) * this.state.spacing;
            obj.y = 40 + Math.floor(i / this.state.cols) * this.state.spacing;
            this.overlay.attach(obj);

            this.objs.push(obj);
            this.sprites.push(sprite);
        }
    }

    private initGUI() {
        GUIHelp.addFolder('Grid');
        GUIHelp.add(this.state, 'cols', 1, 10, 1).onChange(() => this.rebuildGrid());
        GUIHelp.add(this.state, 'rows', 1, 8, 1).onChange(() => this.rebuildGrid());
        GUIHelp.add(this.state, 'tile', 24, 200, 1).onChange(() => this.rebuildGrid());
        GUIHelp.add(this.state, 'spacing', 24, 240, 1).onChange(() => this.rebuildGrid());
        GUIHelp.addColor(this.state, 'tint').onChange(() => this.rebuildGrid());
        GUIHelp.open();
        GUIHelp.endFolder();

        GUIUtil.renderDirLight(this.lightObj.getComponent(DirectLight));
    }
}

new Sample_Sprite_ImageColor().run();
