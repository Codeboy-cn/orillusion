/**
 * GI setting
 * @group Setting
 */
export type GlobalIlluminationSetting = {
    debug: boolean;
    /**
     * 
     */
    debugCamera?: boolean;
    /**
     * enable
     */
    enable: boolean;
    /**
     * offset position X of volume of GI
     */
    offsetX: number;
    /**
     * offset position Y of volume of GI
     */
    offsetY: number;
    /**
     * offset position Z of volume of GI
     */
    offsetZ: number;
    /**
     * Number of probes on the x-axis
     */
    probeXCount: number;
    /**
     * Number of probes on the y-axis
     */
    probeYCount: number;
    /**
     * Number of probes on the z-axis
     */
    probeZCount: number;
    /**
     * The size of the data sampled by a probe on the map
     */
    probeSize: number;
    /**
     * @internal
     * The distance between probes
     */
    probeSpace: number;
    /**
     * @internal
     * The textute size of probe 
     */
    probeSourceTextureSize: number;
    /**
     * @internal
     * Set the overall size of octahedral texture
     */
    octRTMaxSize: number;
    /**
     * @internal
     * Set square size of each octahedral texture
     */
    octRTSideSize: number;
    /**
     * @internal
     * Set max depth distance of probes
     */
    maxDistance: number;
    /**
     * @internal
     */
    normalBias: number;
    /**
     * @internal
     */
    depthSharpness: number;
    /**
     * @internal
     */
    hysteresis: number;
    /**
     * @internal
     * Set hysteresis value (default 0.01)
     */
    lerpHysteresis: number;
    /**
     * @internal
     */
    irradianceChebyshevBias: number;
    /**
     * @internal
     */
    rayNumber: number;
    /**
     * @internal
     */
    irradianceDistanceBias: number;
    /**
     * Illumination intensity of indirect light
     */
    indirectIntensity: number;
    /**
     * 
     */
    ddgiGamma: number,
    /**
     * The intensity of light rebound
     */
    bounceIntensity: number;
    /**
     * @internal
     * Set probe roughness
     */
    probeRoughness: number;
    /**
     * Set whether to use real-time update GI
     */
    realTimeGI: boolean;
    /**
     * Set whether the probe automatically render scene
     */
    autoRenderProbe: boolean;
    /**
     * How many probes re-capture their cube GBuffer each frame (default 1).
     * A full probe sweep takes ceil(probeXCount*probeYCount*probeZCount / N)
     * frames, so raising this makes GI react to scene changes faster at the
     * cost of N-1 extra 6-face probe renders per frame.
     */
    probeCountPerFrame?: number;
    /**
     * Use the software-ray-traced probe update path (BVH compute tracing)
     * instead of the cube-capture GBuffer path. Updates EVERY probe with
     * `rayNumber` rays each frame, needs no shadow maps for the probe
     * lighting (shadow rays are traced against the same BVH), and reacts
     * to light changes immediately. The BVH rebuilds automatically when
     * meshes are added or removed; transform-only changes are picked up
     * on the next rebuild.
     */
    rayTracing?: boolean;
    /**
     * Sky radiance multiplier for rays that miss the scene on the
     * ray-traced path (samples the environment cube). Default 1.
     */
    rtSkyIntensity?: number;
};