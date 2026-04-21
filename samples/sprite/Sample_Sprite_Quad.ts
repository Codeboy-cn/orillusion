import {
    Engine3D,
    Object3D,
    MeshRenderer,
    PlaneGeometry,
    BitmapTexture2D,
    SpriteMaterial,
    Vector3,
    Color,
    Vector4,
    Vector2,
} from "@orillusion/core";
import { createExampleScene } from "@samples/utils/ExampleScene";

/**
 * PR 1 warmup: a minimal quad (PlaneGeometry + SpriteMaterial) parented to
 * a MeshRenderer. Exercises the SpriteShader end-to-end before the Sprite
 * component / OverlayCamera land in PR 2 / PR 3.
 */
export class Sample_Sprite_Quad {
    async run() {
        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const texture = new BitmapTexture2D(true, engine.context3D);
        texture.flipY = true;
        await texture.load('textures/KB3D_NTT_Ads_basecolor.png');

        // Three sprites to exercise: tint, uvRect sub-region, corner radius.
        const variants: Array<{ pos: Vector3, color: Color, uvRect: Vector4, radius: number }> = [
            { pos: new Vector3(-40, 25, 0), color: new Color(1, 1, 1, 1), uvRect: new Vector4(0, 0, 1, 1), radius: 0 },
            { pos: new Vector3(0, 25, 0), color: new Color(1, 0.5, 0.5, 1), uvRect: new Vector4(0.25, 0.25, 0.5, 0.5), radius: 0 },
            { pos: new Vector3(40, 25, 0), color: new Color(0.6, 1, 0.8, 1), uvRect: new Vector4(0, 0, 1, 1), radius: 6 },
        ];

        for (const v of variants) {
            const obj = new Object3D();
            const mr = obj.addComponent(MeshRenderer);
            mr.geometry = new PlaneGeometry(30, 30, 1, 1, Vector3.Z_AXIS);
            const mat = new SpriteMaterial(engine.context3D);
            mat.baseMap = texture;
            mat.color = v.color;
            mat.uvRect = v.uvRect;
            mat.size = new Vector2(30, 30);
            mat.cornerRadius = v.radius;
            mr.material = mat;
            obj.localPosition = v.pos;
            scene.scene.addChild(obj);
        }
    }
}
