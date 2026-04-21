import { GUIHelp } from "@orillusion/debug/GUIHelp";
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
 * World-space sprite grid (3D scene). GUI rebuilds the grid with
 * tunable rows/cols/cell-size + master tint.
 */
export class Sample_Sprite_World {
    async run() {
        GUIHelp.init();

        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const texture = new BitmapTexture2D(true, engine.context3D);
        texture.flipY = true;
        await texture.load('textures/KB3D_NTT_Ads_basecolor.png');

        const objects: Object3D[] = [];
        const state = {
            cols: 5,
            rows: 5,
            cell: 18,
            margin: 2,
            tint: new Color(1, 1, 1, 1),
            cornerRadius: 0,
        };

        const rebuild = () => {
            for (const o of objects) o.removeFromParent();
            objects.length = 0;
            const offsetX = -(state.cols - 1) * (state.cell + state.margin) / 2;
            const offsetY = -(state.rows - 1) * (state.cell + state.margin) / 2;
            for (let r = 0; r < state.rows; r++) {
                for (let c = 0; c < state.cols; c++) {
                    const idx = r * state.cols + c;
                    const obj = new Object3D();
                    const sprite = obj.addComponent(Sprite);
                    sprite.texture = texture;
                    sprite.size = new Vector2(state.cell, state.cell);
                    const baseR = 0.4 + 0.6 * (c / Math.max(state.cols - 1, 1));
                    const baseG = 0.4 + 0.6 * (r / Math.max(state.rows - 1, 1));
                    sprite.color = new Color(baseR * state.tint.r, baseG * state.tint.g, 0.6 * state.tint.b, state.tint.a);
                    sprite.fillRatio = 0.2 + 0.8 * (c / Math.max(state.cols - 1, 1));
                    sprite.fillDirection = r % 4;
                    sprite.cornerRadius = idx % 3 === 0 ? state.cornerRadius : 0;
                    sprite.uvRect = new Vector4(0, 0, 1, 1);
                    obj.x = offsetX + c * (state.cell + state.margin);
                    obj.y = offsetY + r * (state.cell + state.margin) + 20;
                    obj.z = 0;
                    scene.scene.addChild(obj);
                    objects.push(obj);
                }
            }
        };
        rebuild();

        GUIHelp.addFolder('World grid');
        GUIHelp.add(state, 'cols', 1, 10, 1).onChange(rebuild);
        GUIHelp.add(state, 'rows', 1, 10, 1).onChange(rebuild);
        GUIHelp.add(state, 'cell', 4, 60, 1).onChange(rebuild);
        GUIHelp.add(state, 'margin', 0, 20, 1).onChange(rebuild);
        GUIHelp.add(state, 'cornerRadius', 0, 16, 0.5).onChange(rebuild);
        GUIHelp.addColor(state, 'tint').onChange(rebuild);
        GUIHelp.open();
        GUIHelp.endFolder();
    }
}
