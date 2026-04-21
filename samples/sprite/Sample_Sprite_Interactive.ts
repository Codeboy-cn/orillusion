import { GUIHelp } from "@orillusion/debug/GUIHelp";
import {
    AtmosphericComponent,
    BitmapTexture2D,
    CameraUtil,
    Color,
    DirectLight,
    Engine3D,
    HoverCameraController,
    Interactive,
    InteractiveEvent,
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
 * Clickable, hoverable, draggable sprites with live event counters in the
 * right-hand GUI panel.
 */
class Sample_Sprite_Interactive {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;
    lightObj: Object3D;
    texture: BitmapTexture2D;

    private overlay: OverlayCamera;
    private buttonObj: Object3D;
    private button: SpriteRenderer;
    private dragObj: Object3D;
    private dragSprite: SpriteRenderer;

    private readonly normal = new Color(0.7, 0.8, 1, 1);
    private readonly hover = new Color(0.9, 0.95, 1, 1);
    private readonly press = new Color(0.4, 0.5, 0.9, 1);

    private readonly counters = { hover: 0, click: 0, drags: 0, lastClickAt: '' };
    private readonly dragState = { x: 220, y: 120 };
    private dragStartX = 0;
    private dragStartY = 0;

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

        /******** button *******/
        {
            this.buttonObj = new Object3D();
            this.button = this.buttonObj.addComponent(SpriteRenderer);
            this.button.texture = this.texture;
            this.button.size = new Vector2(160, 48);
            this.button.pivot = new Vector2(0, 0);
            this.button.cornerRadius = 8;
            this.button.color = this.normal;

            this.buttonObj.addComponent(Interactive);
            this.buttonObj.addEventListener(InteractiveEvent.OVER, () => { this.button.color = this.hover; this.counters.hover++; }, null);
            this.buttonObj.addEventListener(InteractiveEvent.OUT, () => { this.button.color = this.normal; }, null);
            this.buttonObj.addEventListener(InteractiveEvent.DOWN, () => { this.button.color = this.press; }, null);
            this.buttonObj.addEventListener(InteractiveEvent.UP, () => { this.button.color = this.hover; }, null);
            this.buttonObj.addEventListener(InteractiveEvent.CLICK, (e: InteractiveEvent) => {
                this.counters.click++;
                this.counters.lastClickAt = `(${e.mouseX | 0}, ${e.mouseY | 0})`;
            }, null);

            this.buttonObj.x = 40;
            this.buttonObj.y = 40;
            this.overlay.attach(this.buttonObj);
        }

        /******** draggable tile *******/
        {
            this.dragObj = new Object3D();
            this.dragSprite = this.dragObj.addComponent(SpriteRenderer);
            this.dragSprite.texture = this.texture;
            this.dragSprite.size = new Vector2(80, 80);
            this.dragSprite.pivot = new Vector2(0.5, 0.5);
            this.dragSprite.color = new Color(1, 0.8, 0.4, 1);
            this.dragSprite.cornerRadius = 8;

            this.dragObj.addComponent(Interactive);
            this.dragObj.addEventListener(InteractiveEvent.DRAG_START, () => {
                this.dragStartX = this.dragObj.x;
                this.dragStartY = this.dragObj.y;
            }, null);
            this.dragObj.addEventListener(InteractiveEvent.DRAG, (e: InteractiveEvent) => {
                this.dragObj.x = this.dragStartX + e.dragDeltaX;
                this.dragObj.y = this.dragStartY + e.dragDeltaY;
                this.dragState.x = this.dragObj.x;
                this.dragState.y = this.dragObj.y;
            }, null);
            this.dragObj.addEventListener(InteractiveEvent.DRAG_END, () => { this.counters.drags++; }, null);

            this.dragObj.x = this.dragState.x;
            this.dragObj.y = this.dragState.y;
            this.overlay.attach(this.dragObj);
        }
    }

    private initGUI() {
        GUIHelp.addFolder('Counters');
        GUIHelp.add(this.counters, 'hover', 0, 999).listen();
        GUIHelp.add(this.counters, 'click', 0, 999).listen();
        GUIHelp.add(this.counters, 'drags', 0, 999).listen();
        GUIHelp.add(this.counters, 'lastClickAt').listen();
        GUIHelp.open();
        GUIHelp.endFolder();

        GUIHelp.addFolder('Drag tile');
        GUIHelp.add(this.dragState, 'x', 0, 800, 1).listen().onChange(v => this.dragObj.x = v);
        GUIHelp.add(this.dragState, 'y', 0, 800, 1).listen().onChange(v => this.dragObj.y = v);
        GUIHelp.endFolder();

        GUIUtil.renderDirLight(this.lightObj.getComponent(DirectLight));
    }
}

new Sample_Sprite_Interactive().run();
