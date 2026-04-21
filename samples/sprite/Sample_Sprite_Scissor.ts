import { GUIHelp } from "@orillusion/debug/GUIHelp";
import {
    BitmapTexture2D,
    Color,
    Engine3D,
    Object3D,
    Sprite,
    Vector2,
    Vector4,
} from "@orillusion/core";
import { createExampleScene } from "@samples/utils/ExampleScene";

/**
 * Feature validation: SpriteMaterial scissor (UV-space clip + corner radius
 * + fade-out edge). One sprite is fully tunable from the GUI panel; the
 * second runs an animated wipe so the dynamic-update path is exercised.
 */
export class Sample_Sprite_Scissor {
    private wipe: Sprite;
    private phase: number = 0;

    async run() {
        GUIHelp.init();

        const engine = await Engine3D.init({
            renderLoop: () => this._loop(),
        });
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const texture = new BitmapTexture2D(true, engine.context3D);
        texture.flipY = true;
        await texture.load('textures/KB3D_NTT_Ads_basecolor.png');

        const overlay = scene.view.createOverlayCamera(100);

        // Tunable sprite — exposed in the GUI.
        const obj = new Object3D();
        const sprite = obj.addComponent(Sprite);
        sprite.texture = texture;
        sprite.size = new Vector2(240, 240);
        sprite.pivot = new Vector2(0, 0);
        sprite.color = new Color(1, 1, 1, 1);
        sprite.setScissor(new Vector4(0.1, 0.1, 0.9, 0.9), 0.15, 0.05);
        obj.x = 40;
        obj.y = 40;
        overlay.attach(obj);

        // Animated wipe at the bottom of the canvas.
        const wipeObj = new Object3D();
        this.wipe = wipeObj.addComponent(Sprite);
        this.wipe.texture = texture;
        this.wipe.size = new Vector2(240, 60);
        this.wipe.pivot = new Vector2(0, 0);
        this.wipe.color = new Color(1, 1, 1, 1);
        this.wipe.setScissor(new Vector4(0, 0, 0.5, 1), 0, 0.02);
        wipeObj.x = 40;
        wipeObj.y = 320;
        overlay.attach(wipeObj);

        // ---------- GUI ----------
        const state = {
            scissorLeft: 0.1,
            scissorTop: 0.1,
            scissorRight: 0.9,
            scissorBottom: 0.9,
            cornerRadius: 0.15,
            fadeOut: 0.05,
            spriteCorner: 0,
            wipeAnimate: true,
        };
        const apply = () => {
            sprite.setScissor(
                new Vector4(state.scissorLeft, state.scissorTop, state.scissorRight, state.scissorBottom),
                state.cornerRadius,
                state.fadeOut,
            );
            sprite.cornerRadius = state.spriteCorner;
        };
        GUIHelp.addFolder('Scissor (top sprite)');
        GUIHelp.add(state, 'scissorLeft', 0, 1, 0.01).onChange(apply);
        GUIHelp.add(state, 'scissorTop', 0, 1, 0.01).onChange(apply);
        GUIHelp.add(state, 'scissorRight', 0, 1, 0.01).onChange(apply);
        GUIHelp.add(state, 'scissorBottom', 0, 1, 0.01).onChange(apply);
        GUIHelp.add(state, 'cornerRadius', 0, 0.5, 0.005).onChange(apply);
        GUIHelp.add(state, 'fadeOut', 0, 0.2, 0.001).onChange(apply);
        GUIHelp.add(state, 'spriteCorner', 0, 80, 0.5).onChange(apply);
        GUIHelp.open();
        GUIHelp.endFolder();

        GUIHelp.addFolder('Wipe (bottom sprite)');
        GUIHelp.add(state, 'wipeAnimate').onChange(v => { this.wipeAnimate = v; });
        GUIHelp.open();
        GUIHelp.endFolder();
    }

    private wipeAnimate: boolean = true;

    private _loop() {
        if (!this.wipe || !this.wipeAnimate) return;
        this.phase = (this.phase + 0.01) % (Math.PI * 2);
        const right = 0.5 + 0.5 * Math.sin(this.phase);
        this.wipe.setScissor(new Vector4(0, 0, right, 1), 0, 0.02);
    }
}
