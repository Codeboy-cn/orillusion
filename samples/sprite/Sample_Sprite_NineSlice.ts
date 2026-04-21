import {
    Color,
    Engine3D,
    Object3D,
    Sprite,
    Vector2,
} from "@orillusion/core";
import { createExampleScene } from "@samples/utils/ExampleScene";

/**
 * Feature validation: 9-slice border scaling driven by the atlas's `border`
 * field. The same `button-up` region is rendered at three different sizes;
 * the corner pixels stay 1:1 while the center stretches.
 */
export class Sample_Sprite_NineSlice {
    async run() {
        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const atlas = await engine.res.loadAtlas('atlas/UI_atlas.json');
        const region = atlas.get('button-up');
        if (!region) throw new Error('button-up region not in atlas');

        const overlay = scene.view.createOverlayCamera(100);

        const sizes: Vector2[] = [
            new Vector2(region.size.x, region.size.y),  // native
            new Vector2(380, 70),                        // wider — only center stretches
            new Vector2(200, 200),                       // much taller + square
        ];
        for (let i = 0; i < sizes.length; i++) {
            const obj = new Object3D();
            const sprite = obj.addComponent(Sprite);
            sprite.pivot = new Vector2(0, 0);
            sprite.color = new Color(1, 1, 1, 1);
            // assigning the region applies uv/size/border/sliceScale in one call
            sprite.texture = region;
            sprite.size = sizes[i];                       // overrides region.size; slice recomputes
            obj.x = 40;
            obj.y = 40 + i * 110;
            overlay.attach(obj);
        }
    }
}
