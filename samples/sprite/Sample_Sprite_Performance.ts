import { GUIHelp } from "@orillusion/debug/GUIHelp";
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
 * Per-Sprite baseline (no batching). Tweak `count` to see when individual
 * sprite draws start to bottleneck the frame.
 */
export class Sample_Sprite_Performance {
    async run() {
        GUIHelp.init();

        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const texture = new BitmapTexture2D(true, engine.context3D);
        texture.flipY = true;
        await texture.load('textures/KB3D_NTT_Ads_basecolor.png');

        const overlay = scene.view.createOverlayCamera(100);
        const objects: Object3D[] = [];

        const state = {
            count: 200,
            tileSize: 24,
            spacing: 30,
        };

        const rebuild = () => {
            for (const o of objects) o.removeFromParent();
            objects.length = 0;
            const cols = Math.max(4, Math.floor(800 / state.spacing));
            for (let i = 0; i < state.count; i++) {
                const obj = new Object3D();
                const sprite = obj.addComponent(Sprite);
                sprite.texture = texture;
                sprite.size = new Vector2(state.tileSize, state.tileSize);
                sprite.pivot = new Vector2(0.5, 0.5);
                sprite.color = new Color(
                    0.3 + 0.7 * ((i * 37) % 100) / 100,
                    0.3 + 0.7 * ((i * 91) % 100) / 100,
                    0.3 + 0.7 * ((i * 53) % 100) / 100,
                    1,
                );
                obj.x = 24 + (i % cols) * state.spacing;
                obj.y = 24 + Math.floor(i / cols) * state.spacing;
                overlay.attach(obj);
                objects.push(obj);
            }
        };
        rebuild();

        GUIHelp.addFolder('Sprite count (baseline)');
        GUIHelp.add(state, 'count', 1, 2000, 1).onChange(rebuild);
        GUIHelp.add(state, 'tileSize', 4, 64, 1).onChange(rebuild);
        GUIHelp.add(state, 'spacing', 6, 80, 1).onChange(rebuild);
        GUIHelp.open();
    }
}
