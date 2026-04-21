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
 * PR 3 validation: screen-space sprites rendered through an `OverlayCamera`.
 * - top-left: health bar (pivot 0,0)
 * - bottom-right: mini-map (pivot 1,1)
 * Both positioned in canvas pixels so the OverlayCamera's top-left origin is
 * visibly correct.
 */
export class Sample_Sprite_Overlay {
    async run() {
        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const texture = new BitmapTexture2D(true, engine.context3D);
        texture.flipY = true;
        await texture.load('textures/KB3D_NTT_Ads_basecolor.png');

        const overlay = scene.view.createOverlayCamera(100);

        // Health bar — pivoted to top-left of sprite so (16, 16) is the anchor.
        {
            const obj = new Object3D();
            const sprite = obj.addComponent(Sprite);
            sprite.texture = texture;
            sprite.size = new Vector2(240, 24);
            sprite.pivot = new Vector2(0, 0);
            sprite.color = new Color(0.4, 1.0, 0.4, 1);
            sprite.fillRatio = 0.7;
            sprite.fillDirection = 0;         // left-to-right
            sprite.cornerRadius = 4;
            obj.x = 16;
            obj.y = 16;
            overlay.attach(obj);
        }

        // Mini-map — pivoted to bottom-right so positioning is offset from the
        // right/bottom edges.
        {
            const obj = new Object3D();
            const sprite = obj.addComponent(Sprite);
            sprite.texture = texture;
            sprite.size = new Vector2(160, 160);
            sprite.pivot = new Vector2(1, 1);
            sprite.color = new Color(1, 1, 1, 0.8);
            sprite.cornerRadius = 12;
            obj.x = engine.context3D.presentationSize[0] / engine.context3D.pixelRatio - 16;
            obj.y = engine.context3D.presentationSize[1] / engine.context3D.pixelRatio - 16;
            overlay.attach(obj);
        }
    }
}
