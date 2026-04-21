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
 * PR 6 validation: UIUtil.textToTexture + createButton.
 * - Renders three text variants (small / large / wrapped) as sprites.
 * - Builds a two-state button with hover-on-hover texture swap.
 */
export class Sample_Sprite_UIUtil {
    async run() {
        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const overlay = scene.view.createOverlayCamera(100);

        // Text — three variants
        const variants: Array<{ text: string; opts: any; y: number }> = [
            { text: 'Hello Sprite', opts: { fontSize: 18, color: '#ffffff' }, y: 40 },
            { text: 'BIG HEADLINE', opts: { fontSize: 48, color: '#ffcc00', strokeColor: '#000000', strokeWidth: 2 }, y: 80 },
            { text: 'A longer line of text that will wrap when maxWidth is set.', opts: { fontSize: 16, color: '#aaffaa', maxWidth: 200, lineHeight: 1.3 }, y: 160 },
        ];
        for (const v of variants) {
            const texture = await UIUtil.textToTexture(v.text, engine.context3D, v.opts);
            const { width, height } = UIUtil.measureText(v.text, v.opts);
            const obj = new Object3D();
            const sprite = obj.addComponent(Sprite);
            sprite.texture = texture;
            sprite.size = new Vector2(width, height);
            sprite.pivot = new Vector2(0, 0);
            sprite.color = new Color(1, 1, 1, 1);
            obj.x = 40;
            obj.y = v.y;
            overlay.attach(obj);
        }

        // Button — uses a placeholder PNG as normal/hover textures
        const tex = new BitmapTexture2D(true, engine.context3D);
        tex.flipY = true;
        await tex.load('textures/KB3D_NTT_Ads_basecolor.png');
        const hostObj = new Object3D();
        const { sprite } = UIUtil.createButton(hostObj, {
            normalTexture: tex,
            onClick: () => console.log('UIUtil button clicked'),
        });
        sprite.size = new Vector2(200, 48);
        sprite.pivot = new Vector2(0, 0);
        sprite.cornerRadius = 8;
        sprite.color = new Color(0.7, 0.8, 1, 1);
        hostObj.x = 40;
        hostObj.y = 300;
        overlay.attach(hostObj);
    }
}
