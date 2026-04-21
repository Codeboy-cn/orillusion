import { GUIHelp } from "@orillusion/debug/GUIHelp";
import {
    AtmosphericComponent,
    BillboardComponent,
    BillboardType,
    BitmapTexture2D,
    CameraUtil,
    Color,
    DirectLight,
    Engine3D,
    HoverCameraController,
    KelvinUtil,
    Object3D,
    Scene3D,
    SpriteRenderer,
    Vector2,
    Vector4,
    View3D,
} from "@orillusion/core";

/**
 * World-space sprite grid. Demonstrates `SpriteRenderer` as a textured
 * quad in 3D space — positioned in world units (meters), participates
 * in the normal forward pass alongside 3D meshes. Optional billboard +
 * distance-invariant size.
 */
class Sample_World {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;
    lightObj: Object3D;
    texture: BitmapTexture2D;

    private objects: Object3D[] = [];

    private readonly state = {
        cols: 5,
        rows: 5,
        cell: 1.5,
        margin: 0.3,
        tint: new Color(1, 1, 1, 1),
        billboard: BillboardType.None,
        distanceInvariant: false,
    };

    async run() {
        GUIHelp.init();

        this.engine = await Engine3D.init({});

        this.scene = new Scene3D();
        let sky = this.scene.addComponent(AtmosphericComponent);

        let camera = CameraUtil.createCamera3DObject(this.scene);
        camera.perspective(60, this.engine.aspect, 0.1, 5000.0);
        camera.object3D.addComponent(HoverCameraController).setCamera(0, -15, 20);

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
        const step = s.cell + s.margin;
        const offsetX = -(s.cols - 1) * step / 2;
        const offsetY = -(s.rows - 1) * step / 2;

        for (let r = 0; r < s.rows; r++) {
            for (let c = 0; c < s.cols; c++) {
                const obj = new Object3D();
                const sprite = obj.addComponent(SpriteRenderer);
                sprite.texture = this.texture;
                sprite.size = new Vector2(s.cell, s.cell);
                sprite.pivot = new Vector2(0.5, 0.5);
                const baseR = 0.4 + 0.6 * (c / Math.max(s.cols - 1, 1));
                const baseG = 0.4 + 0.6 * (r / Math.max(s.rows - 1, 1));
                sprite.color = new Color(baseR * s.tint.r, baseG * s.tint.g, 0.6 * s.tint.b, s.tint.a);
                sprite.uvRect = new Vector4(0, 0, 1, 1);
                sprite.distanceInvariantSize = s.distanceInvariant;

                if (s.billboard !== BillboardType.None) {
                    obj.addComponent(BillboardComponent).type = s.billboard;
                }

                obj.x = offsetX + c * step;
                obj.y = offsetY + r * step + 2;
                obj.z = 0;
                this.scene.addChild(obj);
                this.objects.push(obj);
            }
        }
    }

    private initGUI() {
        GUIHelp.addFolder('World grid');
        GUIHelp.add(this.state, 'cols', 1, 10, 1).onFinishChange(() => this.rebuildGrid());
        GUIHelp.add(this.state, 'rows', 1, 10, 1).onFinishChange(() => this.rebuildGrid());
        GUIHelp.add(this.state, 'cell', 0.2, 5, 0.1).onFinishChange(() => this.rebuildGrid());
        GUIHelp.add(this.state, 'margin', 0, 2, 0.05).onFinishChange(() => this.rebuildGrid());
        GUIHelp.addColor(this.state, 'tint').onChange(() => this.rebuildGrid());
        GUIHelp.add(this.state, 'billboard', {
            None: BillboardType.None,
            'Billboard Y': BillboardType.BillboardY,
            'Billboard XYZ': BillboardType.BillboardXYZ,
        }).onChange(() => this.rebuildGrid());
        GUIHelp.add(this.state, 'distanceInvariant').onChange((v: boolean) => {
            for (const o of this.objects) {
                const sprite = o.getComponent(SpriteRenderer) as SpriteRenderer | null;
                if (sprite) sprite.distanceInvariantSize = v;
            }
        });
        GUIHelp.open();
        GUIHelp.endFolder();

    }
}

new Sample_World().run();
