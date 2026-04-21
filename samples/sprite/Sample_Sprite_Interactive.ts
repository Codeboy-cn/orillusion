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
 * PR 5 validation: clickable, hoverable, draggable sprites.
 * - "button" fires CLICK + swaps tint on hover/press
 * - "draggable" follows the pointer after a DRAG_START
 * Both live on an overlay view so hit tests are in screen pixels.
 */
export class Sample_Sprite_Interactive {
    async run() {
        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const texture = new BitmapTexture2D(true, engine.context3D);
        texture.flipY = true;
        await texture.load('textures/KB3D_NTT_Ads_basecolor.png');

        const overlay = scene.view.createOverlayCamera(100);

        // Button
        {
            const obj = new Object3D();
            const sprite = obj.addComponent(Sprite);
            sprite.texture = texture;
            sprite.size = new Vector2(160, 48);
            sprite.pivot = new Vector2(0, 0);
            sprite.cornerRadius = 8;
            const normal = new Color(0.7, 0.8, 1, 1);
            const hover = new Color(0.9, 0.95, 1, 1);
            const press = new Color(0.4, 0.5, 0.9, 1);
            sprite.color = normal;

            obj.addComponent(Interactive);
            obj.addEventListener(InteractiveEvent.OVER, () => { sprite.color = hover; }, null);
            obj.addEventListener(InteractiveEvent.OUT, () => { sprite.color = normal; }, null);
            obj.addEventListener(InteractiveEvent.DOWN, () => { sprite.color = press; }, null);
            obj.addEventListener(InteractiveEvent.UP, () => { sprite.color = hover; }, null);
            obj.addEventListener(InteractiveEvent.CLICK, () => { console.log('button clicked'); }, null);

            obj.x = 40;
            obj.y = 40;
            overlay.attach(obj);
        }

        // Draggable tile — follows the pointer during DRAG
        {
            const obj = new Object3D();
            const sprite = obj.addComponent(Sprite);
            sprite.texture = texture;
            sprite.size = new Vector2(80, 80);
            sprite.pivot = new Vector2(0.5, 0.5);
            sprite.color = new Color(1, 0.8, 0.4, 1);
            sprite.cornerRadius = 8;

            const hitbox = obj.addComponent(Interactive);
            hitbox.hitArea = 'rect';

            let dragStartX = 0, dragStartY = 0;
            obj.addEventListener(InteractiveEvent.DRAG_START, () => {
                dragStartX = obj.x;
                dragStartY = obj.y;
            }, null);
            obj.addEventListener(InteractiveEvent.DRAG, (e: InteractiveEvent) => {
                obj.x = dragStartX + e.dragDeltaX;
                obj.y = dragStartY + e.dragDeltaY;
            }, null);
            obj.addEventListener(InteractiveEvent.DRAG_END, () => {
                console.log('drag ended at', obj.x, obj.y);
            }, null);

            obj.x = 220;
            obj.y = 120;
            overlay.attach(obj);
        }
    }
}
