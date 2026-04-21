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
 * Two overlay layers — back (low priority, behind) and front (high priority,
 * on top). GUI lets you tweak each sprite's color/alpha to see the
 * z-ordering in action.
 */
export class Sample_Sprite_MultiOverlay {
    async run() {
        GUIHelp.init();

        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const texture = new BitmapTexture2D(true, engine.context3D);
        texture.flipY = true;
        await texture.load('textures/KB3D_NTT_Ads_basecolor.png');

        const back = scene.view.createOverlayCamera(100);
        const backObj = new Object3D();
        const backSprite = backObj.addComponent(Sprite);
        backSprite.texture = texture;
        backSprite.size = new Vector2(280, 180);
        backSprite.pivot = new Vector2(0.5, 0.5);
        backSprite.color = new Color(0.6, 0.6, 1, 1);
        backSprite.cornerRadius = 12;
        backObj.x = 180;
        backObj.y = 160;
        back.attach(backObj);

        const front = scene.view.createOverlayCamera(200);
        const frontObj = new Object3D();
        const frontSprite = frontObj.addComponent(Sprite);
        frontSprite.texture = texture;
        frontSprite.size = new Vector2(160, 100);
        frontSprite.pivot = new Vector2(0.5, 0.5);
        frontSprite.color = new Color(1, 0.5, 0.3, 1);
        frontSprite.cornerRadius = 8;
        frontObj.x = 220;
        frontObj.y = 180;
        front.attach(frontObj);

        GUIHelp.addFolder('Back layer (priority 100)');
        const backState = { x: backObj.x, y: backObj.y, color: backSprite.color! };
        GUIHelp.add(backState, 'x', 0, 800, 1).onChange(v => backObj.x = v);
        GUIHelp.add(backState, 'y', 0, 800, 1).onChange(v => backObj.y = v);
        GUIHelp.addColor(backState, 'color').onChange(c => backSprite.color = c);
        GUIHelp.open();
        GUIHelp.endFolder();

        GUIHelp.addFolder('Front layer (priority 200)');
        const frontState = { x: frontObj.x, y: frontObj.y, color: frontSprite.color! };
        GUIHelp.add(frontState, 'x', 0, 800, 1).onChange(v => frontObj.x = v);
        GUIHelp.add(frontState, 'y', 0, 800, 1).onChange(v => frontObj.y = v);
        GUIHelp.addColor(frontState, 'color').onChange(c => frontSprite.color = c);
        GUIHelp.open();
        GUIHelp.endFolder();
    }
}
