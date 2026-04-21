import { GUIHelp } from "@orillusion/debug/GUIHelp";
import {
    AtmosphericComponent,
    CameraUtil,
    Color,
    DirectLight,
    Engine3D,
    HoverCameraController,
    KelvinUtil,
    Object3D,
    OverlayCamera,
    Scene3D,
    SpriteBatcher,
    TextureAtlas,
    Vector2,
    Vector4,
    View3D,
} from "@orillusion/core";

/**
 * SpriteBatcher demo — N entries in a single `drawIndexed` call. Compare
 * the frame time against Sample_Performance which uses the
 * per-Sprite path.
 */
class Sample_Batcher {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;
    lightObj: Object3D;

    private overlay: OverlayCamera;
    private atlas: TextureAtlas;
    private batcher: SpriteBatcher;

    private readonly state = {
        count: 1000,
        tileSize: 12,
        spacing: 14,
        tint: new Color(1, 1, 1, 1),
    };

    private readonly regionIds = ['button-up', 'button-over', 'button-down', 'button-disable'];

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

        /******** overlay + atlas *******/
        {
            this.atlas = await this.engine.res.loadAtlas('atlas/UI_atlas.json');
            this.overlay = this.view.createOverlayCamera(100);
        }

        /******** batcher *******/
        {
            const host = new Object3D();
            this.batcher = host.addComponent(SpriteBatcher);
            this.batcher.texture = this.atlas.texture;
            this.batcher.color = this.state.tint;
            this.overlay.attach(host);

            this.rebuild();
        }
    }

    private rebuild() {
        this.batcher.clear();
        const s = this.state;
        const regions = this.regionIds
            .map(id => this.atlas.get(id))
            .filter((r): r is NonNullable<typeof r> => !!r);
        const cols = Math.max(8, Math.floor(800 / s.spacing));
        for (let i = 0; i < s.count; i++) {
            const region = regions[i % Math.max(1, regions.length)];
            const uv = region
                ? new Vector4(region.region.x, region.region.y, region.region.z, region.region.w)
                : new Vector4(0, 0, 1, 1);
            this.batcher.add({
                position: new Vector2(10 + (i % cols) * s.spacing, 10 + Math.floor(i / cols) * s.spacing),
                size: new Vector2(s.tileSize, s.tileSize),
                pivot: new Vector2(0.5, 0.5),
                uvRect: uv,
            });
        }
    }

    private initGUI() {
        GUIHelp.addFolder('Batcher');
        GUIHelp.add(this.state, 'count', 1, 5000, 1).onChange(() => this.rebuild());
        GUIHelp.add(this.state, 'tileSize', 4, 48, 1).onChange(() => this.rebuild());
        GUIHelp.add(this.state, 'spacing', 6, 60, 1).onChange(() => this.rebuild());
        GUIHelp.addColor(this.state, 'tint').onChange(c => this.batcher.color = c);
        GUIHelp.open();
        GUIHelp.endFolder();

    }
}

new Sample_Batcher().run();
