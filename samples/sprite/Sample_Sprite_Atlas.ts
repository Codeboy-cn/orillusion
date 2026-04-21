import { GUIHelp } from "@orillusion/debug/GUIHelp";
import {
    Color,
    Engine3D,
    Object3D,
    Sprite,
    Vector2,
} from "@orillusion/core";
import { createExampleScene } from "@samples/utils/ExampleScene";

/**
 * PR 4 validation: load an atlas, render named sub-regions as sprites.
 * GUI exposes a region picker per slot so you can swap sub-images live.
 */
export class Sample_Sprite_Atlas {
    async run() {
        GUIHelp.init();

        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const atlas = await engine.res.loadAtlas('atlas/UI_atlas.json');
        const overlay = scene.view.createOverlayCamera(100);

        const allRegions: string[] = [];
        atlas.regions.forEach((_r, id) => allRegions.push(id));
        const regionDict: Record<string, string> = {};
        for (const id of allRegions) regionDict[id] = id;

        const initialPicks = ['button-up', 'button-over', 'button-down'];
        const sprites: Sprite[] = [];
        const states: Array<{ region: string; x: number; y: number; color: Color }> = [];

        for (let i = 0; i < initialPicks.length; i++) {
            const region = atlas.get(initialPicks[i]) ?? atlas.get(allRegions[0]);
            if (!region) continue;
            const obj = new Object3D();
            const sprite = obj.addComponent(Sprite);
            sprite.pivot = new Vector2(0, 0);
            sprite.color = new Color(1, 1, 1, 1);
            sprite.texture = region;
            obj.x = 40 + i * (region.size.x + 16);
            obj.y = 60;
            overlay.attach(obj);
            sprites.push(sprite);
            states.push({ region: region.id, x: obj.x, y: obj.y, color: new Color(1, 1, 1, 1) });
        }

        for (let i = 0; i < sprites.length; i++) {
            const sprite = sprites[i];
            const state = states[i];
            GUIHelp.addFolder(`Sprite ${i + 1}`);
            GUIHelp.add(state, 'region', regionDict).onChange(id => {
                const r = atlas.get(id);
                if (r) sprite.texture = r;
            });
            GUIHelp.addColor(state, 'color').onChange(c => sprite.color = c);
            GUIHelp.open();
            GUIHelp.endFolder();
        }
    }
}
