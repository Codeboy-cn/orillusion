import {
    Engine3D,
    Object3D,
    Sprite,
    Vector2,
} from "@orillusion/core";
import { VideoTexture } from "@orillusion/media-extention";
import { createExampleScene } from "@samples/utils/ExampleScene";

/**
 * Feature validation: Sprite renders a `VideoTexture` (WebGPU
 * `texture_external`). The Sprite component auto-detects the video texture
 * and flips `USE_VIDEO_TEXTURE` on the material, swapping the sampling
 * code path at compile time.
 */
export class Sample_Sprite_Video {
    async run() {
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
        sprite.texture = video; // auto-flips USE_VIDEO_TEXTURE define
        obj.x = 40;
        obj.y = 40;
        overlay.attach(obj);
    }
}
