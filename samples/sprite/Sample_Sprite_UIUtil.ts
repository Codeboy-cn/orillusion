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
 * `UIUtil` helper API demo:
 *  - `textToTexture` / `updateTextTexture`: render text via OffscreenCanvas
 *    into a GPU texture used by a Sprite. Edit the text in GUI to see
 *    the texture re-render in place.
 *  - `createButton`: one-call Sprite + Interactive + hover/press wiring.
 */
class Sample_Sprite_UIUtil {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;
    lightObj: Object3D;
    buttonTexture: BitmapTexture2D;

    private overlay: OverlayCamera;
    private headlineObj: Object3D;
    private headlineSprite: Sprite;
    private headlineTex: BitmapTexture2D;
    private buttonSprite: Sprite;

    private readonly headlineState = {
        text: 'BIG HEADLINE',
        fontSize: 48,
        color: '#ffcc00',
        strokeColor: '#000000',
        strokeWidth: 2,
    };

    private readonly buttonState = {
        color: new Color(0.7, 0.8, 1, 1),
        cornerRadius: 8,
        width: 200,
        height: 48,
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

        /******** overlay *******/
        this.overlay = this.view.createOverlayCamera(100);

        /******** headline — Canvas2D text to GPU texture *******/
        {
            this.headlineTex = await UIUtil.textToTexture(
                this.headlineState.text,
                this.engine.context3D,
                this.headlineState,
            );
            const measure = UIUtil.measureText(this.headlineState.text, this.headlineState);

            this.headlineObj = new Object3D();
            this.headlineSprite = this.headlineObj.addComponent(Sprite);
            this.headlineSprite.texture = this.headlineTex;
            this.headlineSprite.size = new Vector2(measure.width, measure.height);
            this.headlineSprite.pivot = new Vector2(0, 0);
            this.headlineObj.x = 40;
            this.headlineObj.y = 80;
            this.overlay.attach(this.headlineObj);
        }

        /******** button — UIUtil.createButton *******/
        {
            this.buttonTexture = new BitmapTexture2D(true, this.engine.context3D);
            this.buttonTexture.flipY = true;
            await this.buttonTexture.load('textures/KB3D_NTT_Ads_basecolor.png');

            const hostObj = new Object3D();
            const built = UIUtil.createButton(hostObj, {
                normalTexture: this.buttonTexture,
                onClick: () => console.log('UIUtil button clicked'),
            });
            this.buttonSprite = built.sprite;
            this.buttonSprite.size = new Vector2(this.buttonState.width, this.buttonState.height);
            this.buttonSprite.pivot = new Vector2(0, 0);
            this.buttonSprite.cornerRadius = this.buttonState.cornerRadius;
            this.buttonSprite.color = this.buttonState.color;
            hostObj.x = 40;
            hostObj.y = 220;
            this.overlay.attach(hostObj);
        }
    }

    private async refreshHeadline() {
        await UIUtil.updateTextTexture(this.headlineTex, this.headlineState.text, this.headlineState);
        const m = UIUtil.measureText(this.headlineState.text, this.headlineState);
        this.headlineSprite.size = new Vector2(m.width, m.height);
    }

    private initGUI() {
        /******** Headline *******/
        GUIHelp.addFolder('Headline');
        GUIHelp.add(this.headlineState, 'text').onChange(() => this.refreshHeadline());
        GUIHelp.add(this.headlineState, 'fontSize', 12, 96, 1).onChange(() => this.refreshHeadline());
        GUIHelp.addColor({ color: { r: 1, g: 0.8, b: 0, a: 1 } }, 'color').onChange((c: Color) => {
            this.headlineState.color = `rgba(${(c.r * 255) | 0}, ${(c.g * 255) | 0}, ${(c.b * 255) | 0}, ${c.a})`;
            this.refreshHeadline();
        });
        GUIHelp.add(this.headlineState, 'strokeWidth', 0, 8, 0.5).onChange(() => this.refreshHeadline());
        GUIHelp.open();
        GUIHelp.endFolder();

        /******** Button *******/
        GUIHelp.addFolder('Button');
        GUIHelp.addColor(this.buttonState, 'color').onChange(c => this.buttonSprite.color = c);
        GUIHelp.add(this.buttonState, 'cornerRadius', 0, 24, 0.5).onChange(v => this.buttonSprite.cornerRadius = v);
        GUIHelp.add(this.buttonState, 'width', 40, 400, 1).onChange(v => this.buttonSprite.size = new Vector2(v, this.buttonState.height));
        GUIHelp.add(this.buttonState, 'height', 24, 100, 1).onChange(v => this.buttonSprite.size = new Vector2(this.buttonState.width, v));
        GUIHelp.open();
        GUIHelp.endFolder();

        GUIUtil.renderDirLight(this.lightObj.getComponent(DirectLight));
    }
}

new Sample_Sprite_UIUtil().run();
