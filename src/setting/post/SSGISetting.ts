/**
 * Setting of SSGI (screen-space global illumination)
 * @group Setting
 */
export type SSGISetting = {
    enable: boolean;
    /** Strength of the indirect term added to the scene color. */
    intensity: number;
    /** World-space gather radius the effect collects bounce light from. */
    radius: number;
    /** Azimuthal march directions per pixel (clamped to 2..8). */
    sliceCount: number;
    /** Radial march steps per direction (clamped to 4..16). */
    stepCount: number;
    /** Temporal blend: fraction of the accumulated history kept each
     *  frame (0 = no accumulation, 0.98 ~= 50-frame average). */
    hysteresis: number;
};
