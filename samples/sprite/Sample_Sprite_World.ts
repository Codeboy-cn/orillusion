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
 * PR 2 validation: Sprite component attached to Object3Ds in a world-space
 * scene. A 5×5 grid exercises tint, size, fillRatio, and cornerRadius so
 * each property is visibly distinguishable.
 */
export class Sample_Sprite_World {
    async run() {
        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const texture = new BitmapTexture2D(true, engine.context3D);
        texture.flipY = true;
        await texture.load('textures/KB3D_NTT_Ads_basecolor.png');

        const COLS = 5, ROWS = 5, CELL = 18, MARGIN = 2;
        const offsetX = -(COLS - 1) * (CELL + MARGIN) / 2;
        const offsetY = -(ROWS - 1) * (CELL + MARGIN) / 2;

        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const idx = r * COLS + c;
                const obj = new Object3D();
                const sprite = obj.addComponent(Sprite);
                sprite.texture = texture;
                sprite.size = new Vector2(CELL, CELL);
                sprite.color = new Color(
                    0.4 + 0.6 * (c / (COLS - 1)),
                    0.4 + 0.6 * (r / (ROWS - 1)),
                    0.6,
                    1,
                );
                sprite.fillRatio = 0.2 + 0.8 * (c / (COLS - 1));
                sprite.fillDirection = r % 4;           // cycle 0..3
                sprite.cornerRadius = idx % 3 === 0 ? 4 : 0;
                sprite.uvRect = new Vector4(0, 0, 1, 1);

                obj.x = offsetX + c * (CELL + MARGIN);
                obj.y = offsetY + r * (CELL + MARGIN) + 20;
                obj.z = 0;
                scene.scene.addChild(obj);
            }
        }
    }
}
