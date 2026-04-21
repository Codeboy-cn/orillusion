import { GUIHelp } from "@orillusion/debug/GUIHelp";
import {
    BitmapTexture2D,
    Color,
    Engine3D,
    MeshRenderer,
    Object3D,
    PlaneGeometry,
    SpriteMaterial,
    Vector2,
    Vector3,
    Vector4,
} from "@orillusion/core";
import { createExampleScene } from "@samples/utils/ExampleScene";

/**
 * Minimal raw-material quad: MeshRenderer + 1×1 PlaneGeometry +
 * SpriteMaterial. The shader's `size` uniform does the scaling — the
 * geometry must stay a unit quad (a 30×30 PlaneGeometry would multiply
 * with the size uniform and produce a 900-unit quad).
 */
export class Sample_Sprite_Quad {
    async run() {
        GUIHelp.init();

        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const texture = new BitmapTexture2D(true, engine.context3D);
        texture.flipY = true;
        await texture.load('textures/KB3D_NTT_Ads_basecolor.png');

        const obj = new Object3D();
        const mr = obj.addComponent(MeshRenderer);
        mr.geometry = new PlaneGeometry(1, 1, 1, 1, Vector3.Z_AXIS);
        const mat = new SpriteMaterial(engine.context3D);
        mat.baseMap = texture;
        mat.color = new Color(1, 1, 1, 1);
        mat.uvRect = new Vector4(0, 0, 1, 1);
        mat.size = new Vector2(40, 40);
        mr.material = mat;
        obj.x = 0;
        obj.y = 30;
        obj.z = 0;
        scene.scene.addChild(obj);

        const state = {
            sizeX: 40,
            sizeY: 40,
            color: new Color(1, 1, 1, 1),
            uvX: 0, uvY: 0, uvW: 1, uvH: 1,
            cornerRadius: 0,
        };
        GUIHelp.addFolder('Quad');
        GUIHelp.add(state, 'sizeX', 4, 200, 1).onChange(v => mat.size = new Vector2(v, state.sizeY));
        GUIHelp.add(state, 'sizeY', 4, 200, 1).onChange(v => mat.size = new Vector2(state.sizeX, v));
        GUIHelp.addColor(state, 'color').onChange(c => mat.color = c);
        GUIHelp.add(state, 'uvX', 0, 1, 0.01).onChange(() => mat.uvRect = new Vector4(state.uvX, state.uvY, state.uvW, state.uvH));
        GUIHelp.add(state, 'uvY', 0, 1, 0.01).onChange(() => mat.uvRect = new Vector4(state.uvX, state.uvY, state.uvW, state.uvH));
        GUIHelp.add(state, 'uvW', 0.01, 1, 0.01).onChange(() => mat.uvRect = new Vector4(state.uvX, state.uvY, state.uvW, state.uvH));
        GUIHelp.add(state, 'uvH', 0.01, 1, 0.01).onChange(() => mat.uvRect = new Vector4(state.uvX, state.uvY, state.uvW, state.uvH));
        GUIHelp.add(state, 'cornerRadius', 0, 16, 0.5).onChange(v => mat.cornerRadius = v);
        GUIHelp.open();
        GUIHelp.endFolder();
    }
}
