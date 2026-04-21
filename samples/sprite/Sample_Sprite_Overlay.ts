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
 * PR 3 validation: screen-space sprites rendered through an `OverlayCamera`.
 * - top-left: health bar (pivot 0,0)
 * - bottom-right: mini-map (pivot 1,1)
 * Both positioned in canvas pixels so the OverlayCamera's top-left origin is
 * visibly correct.
 */
export class Sample_Sprite_Overlay {
    async run() {
        GUIHelp.init();

        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const texture = new BitmapTexture2D(true, engine.context3D);
        texture.flipY = true;
        await texture.load('textures/KB3D_NTT_Ads_basecolor.png');

        const overlay = scene.view.createOverlayCamera(100);

        // Health bar — pivoted to top-left of sprite so (16, 16) is the anchor.
        const healthObj = new Object3D();
        const health = healthObj.addComponent(Sprite);
        health.texture = texture;
        health.size = new Vector2(240, 24);
        health.pivot = new Vector2(0, 0);
        health.color = new Color(0.4, 1.0, 0.4, 1);
        health.fillRatio = 0.7;
        health.fillDirection = 0;       // left-to-right
        health.cornerRadius = 4;
        healthObj.x = 16;
        healthObj.y = 16;
        overlay.attach(healthObj);

        // Mini-map — pivoted to bottom-right so positioning is offset from the
        // right/bottom edges.
        const mapObj = new Object3D();
        const map = mapObj.addComponent(Sprite);
        map.texture = texture;
        map.size = new Vector2(160, 160);
        map.pivot = new Vector2(1, 1);
        map.color = new Color(1, 1, 1, 0.8);
        map.cornerRadius = 12;
        mapObj.x = engine.context3D.presentationSize[0] / engine.context3D.pixelRatio - 16;
        mapObj.y = engine.context3D.presentationSize[1] / engine.context3D.pixelRatio - 16;
        overlay.attach(mapObj);

        // ---------- GUI ----------
        GUIHelp.addFolder('Health bar');
        const healthState = { x: healthObj.x, y: healthObj.y, w: 240, h: 24, fill: 0.7, dir: 0, corner: 4, color: health.color };
        const fillDirOptions = { 'left→right': 0, 'right→left': 1, 'down→up': 2, 'up→down': 3 };
        GUIHelp.add(healthState, 'x', 0, 600, 1).onChange(v => healthObj.x = v);
        GUIHelp.add(healthState, 'y', 0, 600, 1).onChange(v => healthObj.y = v);
        GUIHelp.add(healthState, 'w', 8, 600, 1).onChange(v => health.size = new Vector2(v, healthState.h));
        GUIHelp.add(healthState, 'h', 4, 200, 1).onChange(v => health.size = new Vector2(healthState.w, v));
        GUIHelp.add(healthState, 'fill', 0, 1, 0.01).onChange(v => health.fillRatio = v);
        GUIHelp.add(healthState, 'dir', fillDirOptions).onChange(v => health.fillDirection = +v);
        GUIHelp.add(healthState, 'corner', 0, 32, 0.5).onChange(v => health.cornerRadius = v);
        GUIHelp.addColor(healthState, 'color').onChange(c => health.color = c);
        GUIHelp.open();
        GUIHelp.endFolder();

        GUIHelp.addFolder('Mini-map');
        const mapState = { x: mapObj.x, y: mapObj.y, size: 160, alpha: 0.8, corner: 12 };
        GUIHelp.add(mapState, 'x', 0, 800, 1).onChange(v => mapObj.x = v);
        GUIHelp.add(mapState, 'y', 0, 800, 1).onChange(v => mapObj.y = v);
        GUIHelp.add(mapState, 'size', 32, 320, 1).onChange(v => map.size = new Vector2(v, v));
        GUIHelp.add(mapState, 'alpha', 0, 1, 0.01).onChange(v => map.color = new Color(1, 1, 1, v));
        GUIHelp.add(mapState, 'corner', 0, 80, 0.5).onChange(v => map.cornerRadius = v);
        GUIHelp.open();
        GUIHelp.endFolder();
    }
}
