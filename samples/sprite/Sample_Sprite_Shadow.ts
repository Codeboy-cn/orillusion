import { GUIHelp } from "@orillusion/debug/GUIHelp";
import {
    BitmapTexture2D,
    Color,
    Engine3D,
    Object3D,
    Sprite,
    UIUtil,
    Vector2,
} from "@orillusion/core";
import { createExampleScene } from "@samples/utils/ExampleScene";

/**
 * Feature validation: `UIUtil.wrapShadow` — drop shadow via offset+tinted
 * sibling Sprite. Shadow params are tunable from the GUI; the helper
 * recreates the shadow Object3D when parameters change.
 */
export class Sample_Sprite_Shadow {
    async run() {
        GUIHelp.init();

        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const texture = new BitmapTexture2D(true, engine.context3D);
        texture.flipY = true;
        await texture.load('textures/KB3D_NTT_Ads_basecolor.png');

        const overlay = scene.view.createOverlayCamera(100);

        const obj = new Object3D();
        const sprite = obj.addComponent(Sprite);
        sprite.texture = texture;
        sprite.size = new Vector2(220, 220);
        sprite.pivot = new Vector2(0, 0);
        sprite.cornerRadius = 12;
        sprite.color = new Color(1, 0.95, 0.8, 1);
        obj.x = 80;
        obj.y = 80;
        overlay.attach(obj);

        const state = {
            offsetX: 12,
            offsetY: 18,
            color: new Color(0.2, 0.05, 0.05, 1),
            alphaScale: 0.55,
            spriteCorner: 12,
        };
        let shadow: Object3D | null = null;
        const rebuildShadow = () => {
            if (shadow) shadow.removeFromParent();
            shadow = UIUtil.wrapShadow(obj, {
                offset: new Vector2(state.offsetX, state.offsetY),
                color: state.color,
                alphaScale: state.alphaScale,
            });
        };
        rebuildShadow();

        GUIHelp.addFolder('Shadow');
        GUIHelp.add(state, 'offsetX', -40, 40, 0.5).onChange(rebuildShadow);
        GUIHelp.add(state, 'offsetY', -40, 40, 0.5).onChange(rebuildShadow);
        GUIHelp.add(state, 'alphaScale', 0, 1, 0.01).onChange(rebuildShadow);
        GUIHelp.addColor(state, 'color').onChange(rebuildShadow);
        GUIHelp.add(state, 'spriteCorner', 0, 80, 0.5).onChange(v => sprite.cornerRadius = v);
        GUIHelp.open();
        GUIHelp.endFolder();
    }
}
