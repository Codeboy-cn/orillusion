import { DepthOfViewSetting } from "./post/DepthOfViewSetting";
import { GlobalFogSetting } from "./post/GlobalFogSetting";
import { GTAOSetting } from "./post/GTAOSetting";
import { OutlineSetting } from "./post/OutlineSetting";
import { SSRSetting } from "./post/SSRSetting";
import { TAASetting } from "./post/TAASetting";
import { BloomSetting } from "./post/BloomSetting";
import { GodRaySetting } from "./post/GodRaySetting";

export type RenderSetting = {
    debug: boolean;
    renderPassState: number;
    renderState_left: number;
    renderState_right: number;
    renderState_split: number;
    quadScale: number;
    hdrExposure: number;
    debugQuad: number;
    maxPointLight: number;
    maxDirectLight: number;
    maxSportLight: number;
    drawOpMin: number;
    drawOpMax: number;
    drawTrMin: number;
    drawTrMax: number;
    zPrePass: boolean;
    useLogDepth: boolean;
    useCompressGBuffer: boolean;
    gi: boolean;
    /** Route rendering through the declarative Frame Graph
     *  (`FrameGraphRendererJob`) instead of the legacy hardcoded
     *  `RendererJob.renderFrame()`. False by default — the FG path
     *  is still under active migration (Phase C) and the legacy
     *  path remains the reference. Flip per-instance via
     *  `engine.setting.render.useFrameGraph = true`. */
    useFrameGraph: boolean;
    /** Per-instance MSAA sample count for the main color pass.
     *  0 disables MSAA (default). Valid non-zero values: 2 | 4 | 8
     *  depending on device support. Enabling MSAA unlocks
     *  alpha-to-coverage (set LitMaterial.alphaMode = 'MASK'). */
    msaa: 0 | 2 | 4 | 8;
    /** Opt-in order-independent transparency (Weighted Blended OIT).
     *  When true, materials with `oitMode === 'weighted'` are routed
     *  through the OIT accum/resolve features instead of the sorted
     *  transparent path. Default false — matches legacy behavior. */
    useOIT: boolean;
    /**
     * post effect
     */
    postProcessing: {
        enable?: boolean;
        bloom?: BloomSetting,
        ssao?: {
            debug: any;
            enable: boolean;
            radius: number;
            bias: number;
            aoPower: number;
        };
        ssr?: SSRSetting;
        taa?: TAASetting;
        gtao?: GTAOSetting;
        ssgi?: GTAOSetting;
        outline?: OutlineSetting;
        globalFog?: GlobalFogSetting;
        godRay?: GodRaySetting;
        fxaa?: {
            enable: boolean;
        };
        depthOfView?: DepthOfViewSetting;
    };
}