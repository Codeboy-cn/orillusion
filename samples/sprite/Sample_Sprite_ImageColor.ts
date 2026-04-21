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
 * PR 7 migration: replaces Sample_UIImageColor. A grid of tinted sprites
 * exercising the `color` uniform at varying hue / alpha combinations.
 */
export class Sample_Sprite_ImageColor {
    async run() {
        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const texture = new BitmapTexture2D(true, engine.context3D);
        texture.flipY = true;
        await texture.load('textures/KB3D_NTT_Ads_basecolor.png');

        const overlay = scene.view.createOverlayCamera(100);

        const colors: Color[] = [
            new Color(1, 1, 1, 1),
            new Color(1, 0.4, 0.4, 1),
            new Color(0.4, 1, 0.4, 1),
            new Color(0.4, 0.4, 1, 1),
            new Color(1, 1, 0.4, 0.8),
            new Color(1, 0.4, 1, 0.6),
            new Color(0.4, 1, 1, 0.4),
            new Color(1, 1, 1, 0.2),
        ];
        for (let i = 0; i < colors.length; i++) {
            const obj = new Object3D();
            const sprite = obj.addComponent(Sprite);
            sprite.texture = texture;
            sprite.size = new Vector2(80, 80);
            sprite.pivot = new Vector2(0, 0);
            sprite.color = colors[i];
            obj.x = 40 + (i % 4) * 90;
            obj.y = 40 + Math.floor(i / 4) * 90;
            overlay.attach(obj);
        }
    }
}
