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
    Sprite,
    TextureAtlas,
    Vector2,
    View3D,
} from "@orillusion/core";
import { GUIUtil } from "@samples/utils/GUIUtil";

/**
 * 9-slice border scaling driven by the atlas's `border` field. Tweak the
 * `width` / `height` in GUI to watch the corners stay at native size
 * while the center stretches.
 */
class Sample_Sprite_NineSlice {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;
    lightObj: Object3D;

    private overlay: OverlayCamera;
    private atlas: TextureAtlas;
    private sprite: Sprite;

    private readonly state = {
        region: '',
        width: 0,
        height: 0,
        color: new Color(1, 1, 1, 1),
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

        /******** overlay + atlas *******/
        {
            this.atlas = await this.engine.res.loadAtlas('atlas/UI_atlas.json');
            this.overlay = this.view.createOverlayCamera(100);
        }

        /******** sprite (initial region) *******/
        {
            const initialRegion = this.atlas.get('button-up')
                ?? this.atlas.regions.values().next().value;
            if (!initialRegion) throw new Error('no atlas regions found');
            this.state.region = initialRegion.id;
            this.state.width = initialRegion.size.x;
            this.state.height = initialRegion.size.y;

            const obj = new Object3D();
            this.sprite = obj.addComponent(Sprite);
            this.sprite.pivot = new Vector2(0, 0);
            this.sprite.color = this.state.color;
            this.sprite.texture = initialRegion;
            obj.x = 40;
            obj.y = 40;
            this.overlay.attach(obj);
        }
    }

    private initGUI() {
        const regionDict: Record<string, string> = {};
        this.atlas.regions.forEach((_r, id) => regionDict[id] = id);

        const apply = () => {
            const r = this.atlas.get(this.state.region);
            if (!r) return;
            this.sprite.texture = r;   // resets size to region.size + slice params
            this.sprite.size = new Vector2(this.state.width, this.state.height);
        };

        GUIHelp.addFolder('9-slice');
        GUIHelp.add(this.state, 'region', regionDict).onChange(() => apply());
        GUIHelp.add(this.state, 'width', 32, 600, 1).onChange(v => this.sprite.size = new Vector2(v, this.state.height));
        GUIHelp.add(this.state, 'height', 16, 400, 1).onChange(v => this.sprite.size = new Vector2(this.state.width, v));
        GUIHelp.addColor(this.state, 'color').onChange(c => this.sprite.color = c);
        GUIHelp.open();
        GUIHelp.endFolder();

        GUIUtil.renderDirLight(this.lightObj.getComponent(DirectLight));
    }
}

new Sample_Sprite_NineSlice().run();
