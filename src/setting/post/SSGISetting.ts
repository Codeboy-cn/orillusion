/**
 * Setting of SSGI (screen-space global illumination).
 * @group Setting
 */
export type SSGISetting = {
    enable: boolean;
    /** Power curve applied to the visibility (AO) term; 0 disables AO. */
    aoIntensity: number;
    /** Strength of the indirect diffuse term. */
    giIntensity: number;
    /** Gather radius: world units, or screen proportion when
     *  useScreenSpaceSampling is on. */
    radius: number;
    /** Hemisphere slices per pixel (clamped to 1..4). */
    sliceCount: number;
    /** March steps along each side of a slice (clamped to 1..32). */
    stepCount: number;
    /** Step distribution exponent (1 = uniform, higher = denser near
     *  the receiver). */
    expFactor: number;
    /** Assumed surface thickness in world units; light passes behind
     *  surfaces beyond it. */
    thickness: number;
    /** Grow the thickness linearly with view distance. */
    useLinearThickness: boolean;
    /** March step sizing in screen proportion instead of world space
     *  (more detail up close). */
    useScreenSpaceSampling: boolean;
    /** Fraction of light emitted by back-facing surfaces (0..1). */
    backfaceLighting: number;
    /** Temporal blend: fraction of the accumulated history kept each
     *  frame (0 = no accumulation, 0.98 ~= 50-frame average). */
    hysteresis: number;
};
