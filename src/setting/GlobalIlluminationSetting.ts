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
     * Base per-update temporal blend weight of the probe irradiance
     * (weight of the NEW estimate, default 0.2). With the adaptive
     * blend this is the MID tier, used while a texel is converging:
     * texels whose relative change sits below the estimator noise
     * floor blend at lerpHysteresisLow instead, and large persistent
     * changes fast-blend toward 0.5.
     */
    lerpHysteresis: number;
    /**
     * @internal
     * Steady-state temporal blend weight (default 0.05). Applied to
     * texels whose per-update relative change is within the ray
     * estimator's noise band — i.e. already converged — so the
     * per-frame random ray orientation stops reading as GI flicker.
     * Raise it if converged GI should still track slow light drifts
     * faster; lower it for maximum temporal stability.
     */
    lerpHysteresisLow?: number;
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
    /**
     * Ray-traced path: auto-fit the probe volume to the scene bounds at
     * BVH build time. Also implied when probeXCount/probeYCount/
     * probeZCount are ALL 0. The fitted values are written back into
     * probeXCount/probeYCount/probeZCount, probeSpace and offsetX/Y/Z,
     * so debug tooling reads the real grid.
     */
    rtAutoFit?: boolean;
    /**
     * Ray-traced auto-fit: probe count along the LONGEST scene axis
     * (default 12, clamped 2..32). The other axes derive from it so
     * grid cells stay roughly cubic.
     */
    rtDivisions?: number;
    /**
     * Ray-traced path probe-update budget per frame. 0 (default) =
     * update EVERY probe each frame; N > 0 = round-robin N probes per
     * frame, so a full sweep takes ceil(probeCount / N) frames.
     */
    rtProbeCountPerFrame?: number;
    /**
     * Ray-traced path TOTAL ray budget per frame (speedball-style).
     * When > 0 it takes precedence over rtProbeCountPerFrame: the pass
     * updates floor(rtRaysPerFrame / rayNumber) probes per frame,
     * auto-throttled down when the frame runs long. The first sweep
     * after a BVH (re)build always covers every probe regardless of
     * budget so GI appears immediately. Default 0 (off).
     */
    rtRaysPerFrame?: number;
    /**
     * Ray-traced path per-update temporal blend weight (default 0.05).
     * Separate from the raster lerpHysteresis (0.2): the RT path
     * re-blends every probe every 1-3 frames instead of once per
     * probeCount frames, so the same per-update weight would absorb
     * far more per-update ray noise per second and the GI visibly
     * flickers/breathes. History-empty texels still bootstrap at
     * weight 1, and large persistent changes still fast-blend through
     * the change detector, so reactivity is preserved.
     */
    rtLerpHysteresis?: number;
};