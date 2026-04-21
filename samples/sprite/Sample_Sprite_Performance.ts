import {
    BitmapTexture2D,
    Color,
    Engine3D,
    Object3D,
    Sprite,
    Vector2,
} from "@orillusion/core";
import { createExampleScene } from "@samples/utils/ExampleScene";

/**
 * PR 7 migration: replaces Sample_UIPerformance. Spawns ~200 sprites on an
 * overlay to exercise the per-sprite pipeline throughput. Each sprite uses a
 * distinct position/color so we can eyeball variety. No batching — this is
 * the Sprite-as-primitive baseline; PR 8 phase 2 may add a SpriteBatcher.
 */
export class Sample_Sprite_Performance {
    async run() {
        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const texture = new BitmapTexture2D(true, engine.context3D);
        texture.flipY = true;
        await texture.load('textures/KB3D_NTT_Ads_basecolor.png');

        const overlay = scene.view.createOverlayCamera(100);

        const COUNT = 200;
        const cols = 20;
        for (let i = 0; i < COUNT; i++) {
            const obj = new Object3D();
            const sprite = obj.addComponent(Sprite);
            sprite.texture = texture;
            sprite.size = new Vector2(24, 24);
            sprite.pivot = new Vector2(0.5, 0.5);
            sprite.color = new Color(
                0.3 + 0.7 * ((i * 37) % 100) / 100,
                0.3 + 0.7 * ((i * 91) % 100) / 100,
                0.3 + 0.7 * ((i * 53) % 100) / 100,
                1,
            );
            obj.x = 24 + (i % cols) * 30;
            obj.y = 24 + Math.floor(i / cols) * 30;
            overlay.attach(obj);
        }
    }
}
