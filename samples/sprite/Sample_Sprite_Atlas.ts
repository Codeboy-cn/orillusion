import {
    Color,
    Engine3D,
    Object3D,
    Sprite,
    Vector2,
} from "@orillusion/core";
import { createExampleScene } from "@samples/utils/ExampleScene";

/**
 * PR 4 validation: load an atlas, lay out three named regions as sprites.
 * Exercises TextureAtlas.get + `Sprite.texture = region` convenience.
 */
export class Sample_Sprite_Atlas {
    async run() {
        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const atlas = await engine.res.loadAtlas('atlas/UI_atlas.json');

        const overlay = scene.view.createOverlayCamera(100);

        const names = ['button-up', 'button-over', 'button-down'];
        for (let i = 0; i < names.length; i++) {
            const region = atlas.get(names[i]);
            if (!region) {
                console.warn(`Atlas region ${names[i]} missing`);
                continue;
            }
            const obj = new Object3D();
            const sprite = obj.addComponent(Sprite);
            sprite.pivot = new Vector2(0, 0);
            sprite.color = new Color(1, 1, 1, 1);
            sprite.texture = region; // sets baseMap + uvRect + size automatically
            obj.x = 40 + i * (region.size.x + 16);
            obj.y = 60;
            overlay.attach(obj);
        }
    }
}
