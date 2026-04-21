import {
    BitmapTexture2D,
    Color,
    Engine3D,
    Object3D,
    Sprite,
    Vector2,
    Vector4,
} from "@orillusion/core";
import { createExampleScene } from "@samples/utils/ExampleScene";

/**
 * Feature validation: SpriteMaterial scissor (UV-space clip + corner radius
 * + fade-out edge). Three sprites share the same texture; each uses a
 * different scissor config: hard rect, rounded soft, animated wipe.
 */
export class Sample_Sprite_Scissor {
    private wipe: Sprite;
    private phase: number = 0;

    async run() {
        const engine = await Engine3D.init({
            renderLoop: () => this._loop(),
        });
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const texture = new BitmapTexture2D(true, engine.context3D);
        texture.flipY = true;
        await texture.load('textures/KB3D_NTT_Ads_basecolor.png');

        const overlay = scene.view.createOverlayCamera(100);

        // 1. Hard rect clip — show only the center half of the sprite.
        {
            const obj = new Object3D();
            const sprite = obj.addComponent(Sprite);
            sprite.texture = texture;
            sprite.size = new Vector2(200, 200);
            sprite.pivot = new Vector2(0, 0);
            sprite.color = new Color(1, 1, 1, 1);
            sprite.setScissor(new Vector4(0.25, 0.25, 0.75, 0.75), 0, 0);
            obj.x = 40;
            obj.y = 40;
            overlay.attach(obj);
        }

        // 2. Rounded + faded edge.
        {
            const obj = new Object3D();
            const sprite = obj.addComponent(Sprite);
            sprite.texture = texture;
            sprite.size = new Vector2(200, 200);
            sprite.pivot = new Vector2(0, 0);
            sprite.color = new Color(1, 1, 1, 1);
            sprite.setScissor(new Vector4(0.1, 0.1, 0.9, 0.9), 0.15, 0.05);
            obj.x = 280;
            obj.y = 40;
            overlay.attach(obj);
        }

        // 3. Animated scissor — wipe reveal driven from `_loop`.
        {
            const obj = new Object3D();
            const sprite = obj.addComponent(Sprite);
            sprite.texture = texture;
            sprite.size = new Vector2(200, 200);
            sprite.pivot = new Vector2(0, 0);
            sprite.color = new Color(1, 1, 1, 1);
            sprite.setScissor(new Vector4(0, 0, 0.5, 1), 0, 0);
            obj.x = 520;
            obj.y = 40;
            overlay.attach(obj);
            this.wipe = sprite;
        }
    }

    private _loop() {
        if (!this.wipe) return;
        this.phase = (this.phase + 0.01) % (Math.PI * 2);
        const right = 0.5 + 0.5 * Math.sin(this.phase);
        this.wipe.setScissor(new Vector4(0, 0, right, 1), 0, 0.02);
    }
}
