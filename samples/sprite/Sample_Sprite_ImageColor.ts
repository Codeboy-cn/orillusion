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
 * Tinted sprite grid. GUI exposes the master tint and grid dimensions.
 */
export class Sample_Sprite_ImageColor {
    async run() {
        GUIHelp.init();

        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const texture = new BitmapTexture2D(true, engine.context3D);
        texture.flipY = true;
        await texture.load('textures/KB3D_NTT_Ads_basecolor.png');

        const overlay = scene.view.createOverlayCamera(100);

        const sprites: Sprite[] = [];
        const objs: Object3D[] = [];

        const state = {
            cols: 4,
            rows: 2,
            tile: 80,
            spacing: 90,
            tint: new Color(1, 1, 1, 1),
        };

        const palette: Color[] = [
            new Color(1, 1, 1, 1),
            new Color(1, 0.4, 0.4, 1),
            new Color(0.4, 1, 0.4, 1),
            new Color(0.4, 0.4, 1, 1),
            new Color(1, 1, 0.4, 0.8),
            new Color(1, 0.4, 1, 0.6),
            new Color(0.4, 1, 1, 0.4),
            new Color(1, 1, 1, 0.2),
        ];

        const rebuild = () => {
            for (const o of objs) o.removeFromParent();
            objs.length = 0;
            sprites.length = 0;
            const total = state.cols * state.rows;
            for (let i = 0; i < total; i++) {
                const obj = new Object3D();
                const sprite = obj.addComponent(Sprite);
                sprite.texture = texture;
                sprite.size = new Vector2(state.tile, state.tile);
                sprite.pivot = new Vector2(0, 0);
                const base = palette[i % palette.length];
                sprite.color = new Color(base.r * state.tint.r, base.g * state.tint.g, base.b * state.tint.b, base.a * state.tint.a);
                obj.x = 40 + (i % state.cols) * state.spacing;
                obj.y = 40 + Math.floor(i / state.cols) * state.spacing;
                overlay.attach(obj);
                objs.push(obj);
                sprites.push(sprite);
            }
        };
        rebuild();

        GUIHelp.addFolder('Grid');
        GUIHelp.add(state, 'cols', 1, 10, 1).onChange(rebuild);
        GUIHelp.add(state, 'rows', 1, 8, 1).onChange(rebuild);
        GUIHelp.add(state, 'tile', 24, 200, 1).onChange(rebuild);
        GUIHelp.add(state, 'spacing', 24, 240, 1).onChange(rebuild);
        GUIHelp.addColor(state, 'tint').onChange(rebuild);
        GUIHelp.open();
        GUIHelp.endFolder();
    }
}
