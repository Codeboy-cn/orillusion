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
 * PR 7 migration: world-space POI label tracking a moving object.
 * Demonstrates overlay Sprite anchored to a 3D position — each frame the
 * overlay sprite's screen position is derived from the tracked object's
 * projected world coordinates.
 */
export class Sample_Sprite_POI {
    private target: Object3D;
    private label: Object3D;
    private view: View3D;
    private pixelRatio: number = 1;
    private _vec: Vector3 = new Vector3();

    async run() {
        const engine = await Engine3D.init({
            renderLoop: () => this._loop(),
        });
        this.pixelRatio = engine.context3D.pixelRatio;
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);
        this.view = scene.view;

        // A moving target in 3D space — a simple rotating cube.
        this.target = Object3DUtil.GetSingleCube(12, 12, 12, 0.3, 0.6, 0.9);
        this.target.y = 10;
        scene.scene.addChild(this.target);

        const overlay = scene.view.createOverlayCamera(100);
        const texture = await UIUtil.textToTexture('Happy Cube', engine.context3D, {
            fontSize: 24, color: '#ffffff', strokeColor: '#000000', strokeWidth: 3, padding: 6,
        });
        const { width, height } = UIUtil.measureText('Happy Cube', { fontSize: 24, padding: 6 });

        this.label = new Object3D();
        const sprite = this.label.addComponent(Sprite);
        sprite.texture = texture;
        sprite.size = new Vector2(width, height);
        sprite.pivot = new Vector2(0.5, 0.5);
        sprite.color = new Color(1, 1, 1, 1);
        overlay.attach(this.label);
    }

    private _loop() {
        if (!this.target || !this.label || !this.view?.camera) return;
        // Spin the cube so there's motion to follow.
        this.target.rotationY += 1;

        const world = this.target.transform.worldPosition;
        const screen = this.view.camera.object3DToScreenRay(world, this._vec);
        this.label.x = screen.x / this.pixelRatio;
        this.label.y = screen.y / this.pixelRatio - 40; // offset above the cube
    }
}
