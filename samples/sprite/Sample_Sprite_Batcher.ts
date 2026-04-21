import {
    Color,
    Engine3D,
    Object3D,
    SpriteBatcher,
    Vector2,
    Vector4,
} from "@orillusion/core";
import { createExampleScene } from "@samples/utils/ExampleScene";

/**
 * Feature validation: SpriteBatcher — 1000 sprites rendered in a single
 * draw call via a baked multi-quad geometry. Compared to
 * Sample_Sprite_Performance's 200 per-Sprite draws, this is the batched
 * equivalent with 5x the entry count.
 *
 * Limitations demonstrated:
 * - Every entry shares the batcher's texture + tint color.
 * - Per-entry uvRect works (cycled through 4 atlas-style sub-rects).
 */
export class Sample_Sprite_Batcher {
    async run() {
        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const atlas = await engine.res.loadAtlas('atlas/UI_atlas.json');
        const overlay = scene.view.createOverlayCamera(100);

        const host = new Object3D();
        const batcher = host.addComponent(SpriteBatcher);
        batcher.texture = atlas.texture;
        batcher.color = new Color(1, 1, 1, 1);
        overlay.attach(host);

        // Reuse a handful of atlas regions so per-entry uvRect is exercised.
        const regionIds = ['button-up', 'button-over', 'button-down', 'button-disable'];
        const regions = regionIds
            .map(id => atlas.get(id))
            .filter((r): r is NonNullable<typeof r> => !!r);

        const COUNT = 1000;
        const cols = 40;
        for (let i = 0; i < COUNT; i++) {
            const region = regions[i % Math.max(1, regions.length)];
            const uv = region
                ? new Vector4(region.uv.x, region.uv.y, region.uv.z, region.uv.w)
                : new Vector4(0, 0, 1, 1);
            batcher.add({
                position: new Vector2(10 + (i % cols) * 14, 10 + Math.floor(i / cols) * 14),
                size: new Vector2(12, 12),
                pivot: new Vector2(0.5, 0.5),
                uvRect: uv,
            });
        }
    }
}
