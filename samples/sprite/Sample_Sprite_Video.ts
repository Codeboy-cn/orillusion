import { GUIHelp } from "@orillusion/debug/GUIHelp";
import {
    Engine3D,
    Object3D,
    Sprite,
    Vector2,
} from "@orillusion/core";
import { VideoTexture } from "@orillusion/media-extention";
import { createExampleScene } from "@samples/utils/ExampleScene";

/**
 * Feature validation: Sprite renders a `VideoTexture`. GUI exposes
 * size + corner radius for live tweaks.
 */
export class Sample_Sprite_Video {
    async run() {
        GUIHelp.init();

        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const video = new VideoTexture(engine.context3D);
        await video.load('video/chicken.mp4');

        const overlay = scene.view.createOverlayCamera(100);

        const obj = new Object3D();
        const sprite = obj.addComponent(Sprite);
        sprite.size = new Vector2(320, 180);
        sprite.pivot = new Vector2(0, 0);
        sprite.cornerRadius = 12;
        sprite.texture = video;
        obj.x = 40;
        obj.y = 40;
        overlay.attach(obj);

        GUIHelp.addFolder('Video sprite');
        const state = { width: 320, height: 180, x: 40, y: 40, corner: 12 };
        GUIHelp.add(state, 'width', 80, 800, 1).onChange(v => sprite.size = new Vector2(v, state.height));
        GUIHelp.add(state, 'height', 60, 600, 1).onChange(v => sprite.size = new Vector2(state.width, v));
        GUIHelp.add(state, 'x', 0, 800, 1).onChange(v => obj.x = v);
        GUIHelp.add(state, 'y', 0, 800, 1).onChange(v => obj.y = v);
        GUIHelp.add(state, 'corner', 0, 60, 0.5).onChange(v => sprite.cornerRadius = v);
        GUIHelp.open();
        GUIHelp.endFolder();
    }
}
