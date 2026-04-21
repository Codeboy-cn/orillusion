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
    SpriteRenderer,
    TextureAtlas,
    Vector2,
    View3D,
} from "@orillusion/core";
import { GUIUtil } from "@samples/utils/GUIUtil";

/**
 * Load an atlas, render three named sub-regions as sprites on an overlay.
 * GUI exposes a per-slot region picker so you can swap sub-images live.
 */
class Sample_Sprite_Atlas {
    engine: Engine3D;
    scene: Scene3D;
    view: View3D;
    lightObj: Object3D;

    private overlay: OverlayCamera;
    private atlas: TextureAtlas;
    private sprites: SpriteRenderer[] = [];
    private pickStates: Array<{ region: string; color: Color }> = [];

    private readonly initialPicks = ['button-up', 'button-over', 'button-down'];

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

        /******** sprites *******/
        for (let i = 0; i < this.initialPicks.length; i++) {
            const region = this.atlas.get(this.initialPicks[i]);
            if (!region) continue;

            const obj = new Object3D();
            const sprite = obj.addComponent(SpriteRenderer);
            sprite.sprite = region;           // bind the atlas Sprite asset
            sprite.pivot = new Vector2(0, 0); // clone-on-write local pivot
            sprite.color = new Color(1, 1, 1, 1);
            obj.x = 40 + i * (region.nativeSize.x + 16);
            obj.y = 60;
            this.overlay.attach(obj);

            this.sprites.push(sprite);
            this.pickStates.push({ region: region.name, color: new Color(1, 1, 1, 1) });
        }
    }

    private initGUI() {
        const allRegions: string[] = [];
        this.atlas.sprites.forEach((_r, id) => allRegions.push(id));
        const regionDict: Record<string, string> = {};
        for (const id of allRegions) regionDict[id] = id;

        for (let i = 0; i < this.sprites.length; i++) {
            const sprite = this.sprites[i];
            const state = this.pickStates[i];
            GUIHelp.addFolder(`Sprite ${i + 1}`);
            GUIHelp.add(state, 'region', regionDict).onChange(id => {
                const r = this.atlas.get(id);
                if (r) sprite.sprite = r;
            });
            GUIHelp.addColor(state, 'color').onChange(c => sprite.color = c);
            GUIHelp.open();
            GUIHelp.endFolder();
        }

        GUIUtil.renderDirLight(this.lightObj.getComponent(DirectLight));
    }
}

new Sample_Sprite_Atlas().run();
