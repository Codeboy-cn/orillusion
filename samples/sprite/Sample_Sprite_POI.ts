import { GUIHelp } from "@orillusion/debug/GUIHelp";
import {
    Color,
    Engine3D,
    Object3D,
    Object3DUtil,
    Sprite,
    UIUtil,
    Vector2,
    Vector3,
    View3D,
} from "@orillusion/core";
import { createExampleScene } from "@samples/utils/ExampleScene";

/**
 * World-space POI label tracking a moving 3D cube. GUI controls label
 * text + screen-Y offset above the tracked object.
 */
export class Sample_Sprite_POI {
    private target!: Object3D;
    private label!: Object3D;
    private view!: View3D;
    private pixelRatio: number = 1;
    private _vec: Vector3 = new Vector3();
    private state = {
        text: 'Happy Cube',
        labelOffsetY: 40,
        rotateSpeed: 1.0,
    };
    private labelTex: any = null;

    async run() {
        GUIHelp.init();

        const engine = await Engine3D.init({
            renderLoop: () => this._loop(),
        });
        this.pixelRatio = engine.context3D.pixelRatio;
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);
        this.view = scene.view;

        this.target = Object3DUtil.GetSingleCube(12, 12, 12, 0.3, 0.6, 0.9);
        this.target.y = 10;
        scene.scene.addChild(this.target);

        const overlay = scene.view.createOverlayCamera(100);
        const opts = { fontSize: 24, color: '#ffffff', strokeColor: '#000000', strokeWidth: 3, padding: 6 };
        this.labelTex = await UIUtil.textToTexture(this.state.text, engine.context3D, opts);
        const measure = UIUtil.measureText(this.state.text, opts);

        this.label = new Object3D();
        const sprite = this.label.addComponent(Sprite);
        sprite.texture = this.labelTex;
        sprite.size = new Vector2(measure.width, measure.height);
        sprite.pivot = new Vector2(0.5, 0.5);
        sprite.color = new Color(1, 1, 1, 1);
        overlay.attach(this.label);

        GUIHelp.addFolder('POI');
        GUIHelp.add(this.state, 'text').onChange(async () => {
            await UIUtil.updateTextTexture(this.labelTex, this.state.text, opts);
            const m = UIUtil.measureText(this.state.text, opts);
            sprite.size = new Vector2(m.width, m.height);
        });
        GUIHelp.add(this.state, 'labelOffsetY', -200, 200, 1);
        GUIHelp.add(this.state, 'rotateSpeed', 0, 5, 0.05);
        GUIHelp.open();
        GUIHelp.endFolder();
    }

    private _loop() {
        if (!this.target || !this.label || !this.view?.camera) return;
        this.target.rotationY += this.state.rotateSpeed;
        const world = this.target.transform.worldPosition;
        const screen = this.view.camera.object3DToScreenRay(world, this._vec);
        this.label.x = screen.x / this.pixelRatio;
        this.label.y = screen.y / this.pixelRatio - this.state.labelOffsetY;
    }
}
