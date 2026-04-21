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
    Scene3D,
    Sprite,
    Vector2,
    Vector4,
    View3D,
} from "@orillusion/core";
import { GUIUtil } from "@samples/utils/GUIUtil";

/**
 * World-space sprite grid (3D scene, not overlay). GUI rebuilds the grid
 * with tunable rows/cols/cell-size + master tint.
 */
class Sample_Sprite_World {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;
    lightObj: Object3D;
    texture: BitmapTexture2D;

    private objects: Object3D[] = [];

    private readonly state = {
        cols: 5,
        rows: 5,
        cell: 18,
        margin: 2,
        tint: new Color(1, 1, 1, 1),
        cornerRadius: 0,
    };

    async run() {
        GUIHelp.init();

        this.engine = await Engine3D.init({});

        this.scene = new Scene3D();
        let sky = this.scene.addComponent(AtmosphericComponent);

        let camera = CameraUtil.createCamera3DObject(this.scene);
        camera.perspective(60, this.engine.aspect, 0.1, 5000.0);
        camera.object3D.addComponent(HoverCameraController).setCamera(0, -15, 150);

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

        /******** sprite grid *******/
        this.rebuildGrid();
    }

    private rebuildGrid() {
        for (const o of this.objects) o.removeFromParent();
        this.objects.length = 0;

        const s = this.state;
        const offsetX = -(s.cols - 1) * (s.cell + s.margin) / 2;
        const offsetY = -(s.rows - 1) * (s.cell + s.margin) / 2;

        for (let r = 0; r < s.rows; r++) {
            for (let c = 0; c < s.cols; c++) {
                const idx = r * s.cols + c;
                const obj = new Object3D();
                const sprite = obj.addComponent(Sprite);
                sprite.texture = this.texture;
                sprite.size = new Vector2(s.cell, s.cell);
                const baseR = 0.4 + 0.6 * (c / Math.max(s.cols - 1, 1));
                const baseG = 0.4 + 0.6 * (r / Math.max(s.rows - 1, 1));
                sprite.color = new Color(baseR * s.tint.r, baseG * s.tint.g, 0.6 * s.tint.b, s.tint.a);
                sprite.fillRatio = 0.2 + 0.8 * (c / Math.max(s.cols - 1, 1));
                sprite.fillDirection = r % 4;
                sprite.cornerRadius = idx % 3 === 0 ? s.cornerRadius : 0;
                sprite.uvRect = new Vector4(0, 0, 1, 1);
                obj.x = offsetX + c * (s.cell + s.margin);
                obj.y = offsetY + r * (s.cell + s.margin) + 20;
                obj.z = 0;
                this.scene.addChild(obj);
                this.objects.push(obj);
            }
        }
    }

    private initGUI() {
        GUIHelp.addFolder('World grid');
        GUIHelp.add(this.state, 'cols', 1, 10, 1).onChange(() => this.rebuildGrid());
        GUIHelp.add(this.state, 'rows', 1, 10, 1).onChange(() => this.rebuildGrid());
        GUIHelp.add(this.state, 'cell', 4, 60, 1).onChange(() => this.rebuildGrid());
        GUIHelp.add(this.state, 'margin', 0, 20, 1).onChange(() => this.rebuildGrid());
        GUIHelp.add(this.state, 'cornerRadius', 0, 16, 0.5).onChange(() => this.rebuildGrid());
        GUIHelp.addColor(this.state, 'tint').onChange(() => this.rebuildGrid());
        GUIHelp.open();
        GUIHelp.endFolder();

        GUIUtil.renderDirLight(this.lightObj.getComponent(DirectLight));
    }
}

new Sample_Sprite_World().run();
