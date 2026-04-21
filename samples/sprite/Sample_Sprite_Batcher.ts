import { GUIHelp } from "@orillusion/debug/GUIHelp";
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
 * SpriteBatcher demo — N entries in a single drawIndexed call. Tweak
 * `count` and `tileSize` to compare against Sample_Sprite_Performance
 * (per-Sprite path).
 */
export class Sample_Sprite_Batcher {
    async run() {
        GUIHelp.init();

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

        const regionIds = ['button-up', 'button-over', 'button-down', 'button-disable'];
        const regions = regionIds
            .map(id => atlas.get(id))
            .filter((r): r is NonNullable<typeof r> => !!r);

        const state = {
            count: 1000,
            tileSize: 12,
            spacing: 14,
        };

        const rebuild = () => {
            batcher.clear();
            const cols = Math.max(8, Math.floor(800 / state.spacing));
            for (let i = 0; i < state.count; i++) {
                const region = regions[i % Math.max(1, regions.length)];
                const uv = region
                    ? new Vector4(region.uv.x, region.uv.y, region.uv.z, region.uv.w)
                    : new Vector4(0, 0, 1, 1);
                batcher.add({
                    position: new Vector2(10 + (i % cols) * state.spacing, 10 + Math.floor(i / cols) * state.spacing),
                    size: new Vector2(state.tileSize, state.tileSize),
                    pivot: new Vector2(0.5, 0.5),
                    uvRect: uv,
                });
            }
        };
        rebuild();

        GUIHelp.addFolder('Batcher');
        GUIHelp.add(state, 'count', 1, 5000, 1).onChange(rebuild);
        GUIHelp.add(state, 'tileSize', 4, 48, 1).onChange(rebuild);
        GUIHelp.add(state, 'spacing', 6, 60, 1).onChange(rebuild);
        const tintState = { color: new Color(1, 1, 1, 1) };
        GUIHelp.addColor(tintState, 'color').onChange(c => batcher.color = c);
        GUIHelp.open();
    }
}
