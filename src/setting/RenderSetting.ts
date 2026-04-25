import { DepthOfViewSetting } from "./post/DepthOfViewSetting";
import { GlobalFogSetting } from "./post/GlobalFogSetting";
import { GTAOSetting } from "./post/GTAOSetting";
import { OutlineSetting } from "./post/OutlineSetting";
import { SSRSetting } from "./post/SSRSetting";
import { TAASetting } from "./post/TAASetting";
import { BloomSetting } from "./post/BloomSetting";
import { GodRaySetting } from "./post/GodRaySetting";
import { VolumetricFogSetting } from "./post/VolumetricFogSetting";

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
    /** GPU-driven culling — when true, frustum + (when paired with
     *  Hi-Z) occlusion tests run on the GPU per mesh instance and
     *  produce a `drawIndexedIndirect` arg buffer. The compute pass
     *  is fully implemented in `GPUCullFeature` /
     *  `GPUFrustumCull_cs`; what's still skeleton is the
     *  `ColorPassRenderer.drawNodes` consumer that actually issues
     *  the indirect call (the existing per-node iteration coexists).
     *  Flip this on AND open the integration in
     *  `ColorPassRenderer.drawNodes` to get the 5-20× perf win. */
    gpuCull?: boolean;
    /** Two-phase Hi-Z occlusion culling — phase 1 tests against the
     *  prior frame's Hi-Z and renders the survivors; phase 2 rebuilds
     *  Hi-Z and re-tests the failures to catch newly-revealed
     *  geometry. Reduces over-culling artifacts at edges and during
     *  fast camera motion. Implementation seam: `GPUCullSystem` runs
     *  twice with different Hi-Z bindings. Defaults off; gated by
     *  `gpuCull === true`. */
    gpuCullTwoPhase?: boolean;
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
        volumetricFog?: VolumetricFogSetting;
    };
}