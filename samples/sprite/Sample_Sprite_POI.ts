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
    Object3DUtil,
    OverlayCamera,
    Scene3D,
    Sprite,
    UIUtil,
    Vector2,
    Vector3,
    View3D,
} from "@orillusion/core";
import { GUIUtil } from "@samples/utils/GUIUtil";

/**
 * World-space POI label tracking a moving 3D cube. Each frame the cube's
 * world position is projected to screen via the main camera, and the
 * overlay label's screen position is updated to follow it.
 */
class Sample_Sprite_POI {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;
    lightObj: Object3D;

    private overlay: OverlayCamera;
    private target: Object3D;
    private label: Object3D;
    private labelSprite: Sprite;
    private labelTex: BitmapTexture2D;
    private pixelRatio: number = 1;
    private _vec: Vector3 = new Vector3();

    private readonly state = {
        text: 'Happy Cube',
        labelOffsetY: 40,
        rotateSpeed: 1.0,
    };

    private readonly labelOpts = {
        fontSize: 24,
        color: '#ffffff',
        strokeColor: '#000000',
        strokeWidth: 3,
        padding: 6,
    };

    async run() {
        GUIHelp.init();

        this.engine = await Engine3D.init({
            renderLoop: () => this.loop(),
        });
        this.pixelRatio = this.engine.context3D.pixelRatio;

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

        /******** tracked cube *******/
        {
            this.target = Object3DUtil.GetSingleCube(12, 12, 12, 0.3, 0.6, 0.9);
            this.target.y = 10;
            this.scene.addChild(this.target);
        }

        /******** overlay + label *******/
        {
            this.overlay = this.view.createOverlayCamera(100);

            this.labelTex = await UIUtil.textToTexture(this.state.text, this.engine.context3D, this.labelOpts);
            const measure = UIUtil.measureText(this.state.text, this.labelOpts);

            this.label = new Object3D();
            this.labelSprite = this.label.addComponent(Sprite);
            this.labelSprite.texture = this.labelTex;
            this.labelSprite.size = new Vector2(measure.width, measure.height);
            this.labelSprite.pivot = new Vector2(0.5, 0.5);
            this.labelSprite.color = new Color(1, 1, 1, 1);
            this.overlay.attach(this.label);
        }
    }

    private loop() {
        if (!this.target || !this.label || !this.view?.camera) return;
        this.target.rotationY += this.state.rotateSpeed;
        const world = this.target.transform.worldPosition;
        const screen = this.view.camera.object3DToScreenRay(world, this._vec);
        this.label.x = screen.x / this.pixelRatio;
        this.label.y = screen.y / this.pixelRatio - this.state.labelOffsetY;
    }

    private initGUI() {
        GUIHelp.addFolder('POI');
        GUIHelp.add(this.state, 'text').onChange(async () => {
            await UIUtil.updateTextTexture(this.labelTex, this.state.text, this.labelOpts);
            const m = UIUtil.measureText(this.state.text, this.labelOpts);
            this.labelSprite.size = new Vector2(m.width, m.height);
        });
        GUIHelp.add(this.state, 'labelOffsetY', -200, 200, 1);
        GUIHelp.add(this.state, 'rotateSpeed', 0, 5, 0.05);
        GUIHelp.open();
        GUIHelp.endFolder();

        GUIUtil.renderDirLight(this.lightObj.getComponent(DirectLight));
    }
}

new Sample_Sprite_POI().run();
