import {
    BitmapTexture2D,
    Color,
    Engine3D,
    Object3D,
    Sprite,
    UIUtil,
    Vector2,
} from "@orillusion/core";
import { createExampleScene } from "@samples/utils/ExampleScene";

/**
 * Feature validation: `UIUtil.wrapShadow` — replicates a sprite behind the
 * original with offset/tint/alpha to fake a drop shadow without a dedicated
 * shader pass.
 */
export class Sample_Sprite_Shadow {
    async run() {
        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const texture = new BitmapTexture2D(true, engine.context3D);
        texture.flipY = true;
        await texture.load('textures/KB3D_NTT_Ads_basecolor.png');

        const overlay = scene.view.createOverlayCamera(100);

        // Tight shadow — small offset, dark, semi-transparent.
        {
            const obj = new Object3D();
            const sprite = obj.addComponent(Sprite);
            sprite.texture = texture;
            sprite.size = new Vector2(180, 180);
            sprite.pivot = new Vector2(0, 0);
            sprite.cornerRadius = 12;
            sprite.color = new Color(1, 1, 1, 1);
            obj.x = 40;
            obj.y = 40;
            overlay.attach(obj);
            UIUtil.wrapShadow(obj, { offset: new Vector2(6, 6), alphaScale: 0.4 });
        }

        // Long, tinted shadow for a hero/label element.
        {
            const obj = new Object3D();
            const sprite = obj.addComponent(Sprite);
            sprite.texture = texture;
            sprite.size = new Vector2(220, 120);
            sprite.pivot = new Vector2(0, 0);
            sprite.cornerRadius = 8;
            sprite.color = new Color(1, 0.95, 0.8, 1);
            obj.x = 260;
            obj.y = 40;
            overlay.attach(obj);
            UIUtil.wrapShadow(obj, {
                offset: new Vector2(12, 18),
                color: new Color(0.2, 0.05, 0.05, 1),
                alphaScale: 0.55,
            });
        }
    }
}
