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
 * PR 6 validation: UIUtil.textToTexture + createButton.
 * The headline text + button color are wired to the GUI for live tweaking;
 * the headline regenerates its texture on change via `updateTextTexture`.
 */
export class Sample_Sprite_UIUtil {
    async run() {
        GUIHelp.init();

        const engine = await Engine3D.init({});
        const scene = createExampleScene(engine);
        engine.startRenderView(scene.view);

        const overlay = scene.view.createOverlayCamera(100);

        // Headline — re-rendered into the same texture when GUI inputs change.
        const headlineState = {
            text: 'BIG HEADLINE',
            fontSize: 48,
            color: '#ffcc00',
            strokeColor: '#000000',
            strokeWidth: 2,
        };
        const headlineTex = await UIUtil.textToTexture(headlineState.text, engine.context3D, headlineState);
        const headlineMeasure = UIUtil.measureText(headlineState.text, headlineState);
        const headlineObj = new Object3D();
        const headlineSprite = headlineObj.addComponent(Sprite);
        headlineSprite.texture = headlineTex;
        headlineSprite.size = new Vector2(headlineMeasure.width, headlineMeasure.height);
        headlineSprite.pivot = new Vector2(0, 0);
        headlineObj.x = 40;
        headlineObj.y = 80;
        overlay.attach(headlineObj);

        const refreshHeadline = async () => {
            await UIUtil.updateTextTexture(headlineTex, headlineState.text, headlineState);
            const m = UIUtil.measureText(headlineState.text, headlineState);
            headlineSprite.size = new Vector2(m.width, m.height);
        };

        GUIHelp.addFolder('Headline');
        GUIHelp.add(headlineState, 'text').onChange(() => refreshHeadline());
        GUIHelp.add(headlineState, 'fontSize', 12, 96, 1).onChange(() => refreshHeadline());
        GUIHelp.addColor({ color: { r: 1, g: 0.8, b: 0, a: 1 } }, 'color').onChange((c: Color) => {
            headlineState.color = `rgba(${(c.r * 255) | 0}, ${(c.g * 255) | 0}, ${(c.b * 255) | 0}, ${c.a})`;
            refreshHeadline();
        });
        GUIHelp.add(headlineState, 'strokeWidth', 0, 8, 0.5).onChange(() => refreshHeadline());
        GUIHelp.open();
        GUIHelp.endFolder();

        // Button — uses an external texture and `createButton` for state wiring.
        const tex = new BitmapTexture2D(true, engine.context3D);
        tex.flipY = true;
        await tex.load('textures/KB3D_NTT_Ads_basecolor.png');
        const hostObj = new Object3D();
        const { sprite: btnSprite } = UIUtil.createButton(hostObj, {
            normalTexture: tex,
            onClick: () => console.log('UIUtil button clicked'),
        });
        btnSprite.size = new Vector2(200, 48);
        btnSprite.pivot = new Vector2(0, 0);
        btnSprite.cornerRadius = 8;
        btnSprite.color = new Color(0.7, 0.8, 1, 1);
        hostObj.x = 40;
        hostObj.y = 220;
        overlay.attach(hostObj);

        const btnState = {
            color: btnSprite.color!,
            cornerRadius: 8,
            width: 200,
            height: 48,
        };
        GUIHelp.addFolder('Button');
        GUIHelp.addColor(btnState, 'color').onChange(c => btnSprite.color = c);
        GUIHelp.add(btnState, 'cornerRadius', 0, 24, 0.5).onChange(v => btnSprite.cornerRadius = v);
        GUIHelp.add(btnState, 'width', 40, 400, 1).onChange(v => btnSprite.size = new Vector2(v, btnState.height));
        GUIHelp.add(btnState, 'height', 24, 100, 1).onChange(v => btnSprite.size = new Vector2(btnState.width, v));
        GUIHelp.open();
        GUIHelp.endFolder();
    }
}
