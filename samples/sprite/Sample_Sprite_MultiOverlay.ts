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
 * PR 7 migration: replaces Sample_UIMultiCanvas / Sample_UIPanelOrder.
 * Two overlay cameras with different priorities — the higher-priority overlay
 * renders on top. Demonstrates stable z-ordering of screen-space layers.
 */
export class Sample_Sprite_MultiOverlay {
    async run() {
        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const texture = new BitmapTexture2D(true, engine.context3D);
        texture.flipY = true;
        await texture.load('textures/KB3D_NTT_Ads_basecolor.png');

        // Back layer: priority 100 (renders first, appears underneath).
        const back = scene.view.createOverlayCamera(100);
        {
            const obj = new Object3D();
            const sprite = obj.addComponent(Sprite);
            sprite.texture = texture;
            sprite.size = new Vector2(280, 180);
            sprite.pivot = new Vector2(0.5, 0.5);
            sprite.color = new Color(0.6, 0.6, 1, 1);
            sprite.cornerRadius = 12;
            obj.x = 180;
            obj.y = 160;
            back.attach(obj);
        }

        // Front layer: priority 200 (renders later, appears on top).
        const front = scene.view.createOverlayCamera(200);
        {
            const obj = new Object3D();
            const sprite = obj.addComponent(Sprite);
            sprite.texture = texture;
            sprite.size = new Vector2(160, 100);
            sprite.pivot = new Vector2(0.5, 0.5);
            sprite.color = new Color(1, 0.5, 0.3, 1);
            sprite.cornerRadius = 8;
            obj.x = 220;
            obj.y = 180;
            front.attach(obj);
        }
    }
}
