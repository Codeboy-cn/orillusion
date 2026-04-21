import { GUIHelp } from "@orillusion/debug/GUIHelp";
import {
    AtmosphericComponent,
    CameraUtil,
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
import { VideoTexture } from "@orillusion/media-extention";

/**
 * Sprite renders a `VideoTexture` (WebGPU `texture_external`). The
 * Sprite component auto-detects the video texture and flips
 * `USE_VIDEO_TEXTURE` on the material, swapping the sampling code path
 * at compile time.
 */
class Sample_Video {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;
    lightObj: Object3D;

    private overlay: OverlayCamera;
    private obj: Object3D;
    private sprite: SpriteRenderer;
    private video: VideoTexture;

    private readonly state = {
        width: 320,
        height: 180,
        x: 40,
        y: 40,
        corner: 12,
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

        /******** overlay + video *******/
        {
            this.video = new VideoTexture(this.engine.context3D);
            await this.video.load('video/chicken.mp4');

            this.overlay = this.view.createOverlayCamera(100);
        }

        /******** video sprite *******/
        {
            this.obj = new Object3D();
            this.sprite = this.obj.addComponent(SpriteRenderer);
            this.sprite.size = new Vector2(this.state.width, this.state.height);
            this.sprite.pivot = new Vector2(0, 0);
            this.sprite.cornerRadius = this.state.corner;
            this.sprite.texture = this.video;    // auto-flips USE_VIDEO_TEXTURE define
            this.obj.x = this.state.x;
            this.obj.y = this.state.y;
            this.overlay.attach(this.obj);
        }
    }

    private initGUI() {
        GUIHelp.addFolder('Video sprite');
        GUIHelp.add(this.state, 'width', 80, 800, 1).onChange(v => this.sprite.size = new Vector2(v, this.state.height));
        GUIHelp.add(this.state, 'height', 60, 600, 1).onChange(v => this.sprite.size = new Vector2(this.state.width, v));
        GUIHelp.add(this.state, 'x', 0, 1200, 1).onChange(v => this.obj.x = v);
        GUIHelp.add(this.state, 'y', 0, 1200, 1).onChange(v => this.obj.y = v);
        GUIHelp.add(this.state, 'corner', 0, 60, 0.5).onChange(v => this.sprite.cornerRadius = v);
        GUIHelp.open();
        GUIHelp.endFolder();

    }
}

new Sample_Video().run();
