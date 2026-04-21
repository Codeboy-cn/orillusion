import { GUIHelp } from "@orillusion/debug/GUIHelp";
import {
    BitmapTexture2D,
    Color,
    Engine3D,
    InteractiveEvent,
    Object3D,
    Sprite,
    Vector2,
    Interactive,
} from "@orillusion/core";
import { createExampleScene } from "@samples/utils/ExampleScene";

/**
 * PR 5 validation: clickable, hoverable, draggable sprites with live event
 * counters in the GUI panel.
 */
export class Sample_Sprite_Interactive {
    async run() {
        GUIHelp.init();

        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const texture = new BitmapTexture2D(true, engine.context3D);
        texture.flipY = true;
        await texture.load('textures/KB3D_NTT_Ads_basecolor.png');

        const overlay = scene.view.createOverlayCamera(100);

        // ---------- button ----------
        const buttonObj = new Object3D();
        const button = buttonObj.addComponent(Sprite);
        button.texture = texture;
        button.size = new Vector2(160, 48);
        button.pivot = new Vector2(0, 0);
        button.cornerRadius = 8;
        const normal = new Color(0.7, 0.8, 1, 1);
        const hover = new Color(0.9, 0.95, 1, 1);
        const press = new Color(0.4, 0.5, 0.9, 1);
        button.color = normal;

        const counters = { hover: 0, click: 0, drags: 0, lastClickAt: '' };
        buttonObj.addComponent(Interactive);
        buttonObj.addEventListener(InteractiveEvent.OVER, () => { button.color = hover; counters.hover++; }, null);
        buttonObj.addEventListener(InteractiveEvent.OUT, () => { button.color = normal; }, null);
        buttonObj.addEventListener(InteractiveEvent.DOWN, () => { button.color = press; }, null);
        buttonObj.addEventListener(InteractiveEvent.UP, () => { button.color = hover; }, null);
        buttonObj.addEventListener(InteractiveEvent.CLICK, (e: InteractiveEvent) => {
            counters.click++;
            counters.lastClickAt = `(${e.mouseX | 0}, ${e.mouseY | 0})`;
        }, null);

        buttonObj.x = 40;
        buttonObj.y = 40;
        overlay.attach(buttonObj);

        // ---------- draggable ----------
        const drag = new Object3D();
        const dragSprite = drag.addComponent(Sprite);
        dragSprite.texture = texture;
        dragSprite.size = new Vector2(80, 80);
        dragSprite.pivot = new Vector2(0.5, 0.5);
        dragSprite.color = new Color(1, 0.8, 0.4, 1);
        dragSprite.cornerRadius = 8;

        drag.addComponent(Interactive);
        let dragStartX = 0, dragStartY = 0;
        drag.addEventListener(InteractiveEvent.DRAG_START, () => {
            dragStartX = drag.x;
            dragStartY = drag.y;
        }, null);
        drag.addEventListener(InteractiveEvent.DRAG, (e: InteractiveEvent) => {
            drag.x = dragStartX + e.dragDeltaX;
            drag.y = dragStartY + e.dragDeltaY;
        }, null);
        drag.addEventListener(InteractiveEvent.DRAG_END, () => { counters.drags++; }, null);

        drag.x = 220;
        drag.y = 120;
        overlay.attach(drag);

        // ---------- GUI ----------
        GUIHelp.addFolder('Counters');
        GUIHelp.add(counters, 'hover', 0, 999).listen();
        GUIHelp.add(counters, 'click', 0, 999).listen();
        GUIHelp.add(counters, 'drags', 0, 999).listen();
        GUIHelp.add(counters, 'lastClickAt').listen();
        GUIHelp.open();
        GUIHelp.endFolder();

        GUIHelp.addFolder('Drag tile');
        const dragState = { x: drag.x, y: drag.y };
        GUIHelp.add(dragState, 'x', 0, 800, 1).listen().onChange(v => drag.x = v);
        GUIHelp.add(dragState, 'y', 0, 800, 1).listen().onChange(v => drag.y = v);
        // mirror runtime drag onto the GUI sliders
        drag.addEventListener(InteractiveEvent.DRAG, () => {
            dragState.x = drag.x;
            dragState.y = drag.y;
        }, null);
        GUIHelp.endFolder();
    }
}
