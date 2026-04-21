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
 * Feature validation: 9-slice border scaling driven by the atlas's `border`
 * field. Tweak `width` / `height` from the GUI to watch the corners stay
 * at native size while the center stretches.
 */
export class Sample_Sprite_NineSlice {
    async run() {
        GUIHelp.init();

        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const atlas = await engine.res.loadAtlas('atlas/UI_atlas.json');
        const overlay = scene.view.createOverlayCamera(100);

        const regionIds = ['button-up', 'button-over', 'button-down', 'button-disable'];
        const validRegions = regionIds.filter(id => atlas.get(id));
        if (validRegions.length === 0) throw new Error('no atlas regions found');

        const obj = new Object3D();
        const sprite = obj.addComponent(Sprite);
        sprite.pivot = new Vector2(0, 0);
        sprite.color = new Color(1, 1, 1, 1);
        const initialRegion = atlas.get(validRegions[0])!;
        sprite.texture = initialRegion;
        obj.x = 40;
        obj.y = 40;
        overlay.attach(obj);

        // ---------- GUI ----------
        const state = {
            region: validRegions[0],
            width: initialRegion.size.x,
            height: initialRegion.size.y,
            color: new Color(1, 1, 1, 1),
        };
        const regionDict: Record<string, string> = {};
        for (const id of validRegions) regionDict[id] = id;

        const apply = () => {
            const r = atlas.get(state.region);
            if (!r) return;
            sprite.texture = r;                       // resets size to region.size
            sprite.size = new Vector2(state.width, state.height);
        };

        GUIHelp.add(state, 'region', regionDict).onChange(() => apply());
        GUIHelp.add(state, 'width', 32, 600, 1).onChange(v => sprite.size = new Vector2(v, state.height));
        GUIHelp.add(state, 'height', 16, 400, 1).onChange(v => sprite.size = new Vector2(state.width, v));
        GUIHelp.addColor(state, 'color').onChange(c => sprite.color = c);
        GUIHelp.open();
    }
}
