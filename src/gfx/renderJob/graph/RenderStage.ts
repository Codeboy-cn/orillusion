/**
 * Coarse-grained execution phase for a RenderFeature. Provides a stable
 * sort key when the declarative reads/writes graph has multiple valid
 * topological orderings — tie-break is stage-first, insertion-order
 * second. Stages are ordered by the numeric enum value.
 *
 * Hooks exposed between the mainstream phases (AfterOpaque,
 * AfterTransparent, AfterPost) are the insertion points users are
 * expected to target for custom features (refraction, opaque-only post,
 * TAA sharpen, etc.).
 *
 * @group Graph
 */
export enum RenderStage {
    /** Camera matrix refresh, light/reflection probe update, culling. */
    BeforeShadows = 0,
    /** Directional + point-light shadow map rendering. */
    Shadow = 10,
    /** Per-mesh depth prepass (optional, gated by `render.zPrePass`). */
    PreDepth = 20,
    /** DDGI probe update, SSGI / GTAO compute. */
    GI = 30,
    /** Opaque geometry main color pass. */
    Opaque = 40,
    /** Slot for refraction masks, opaque-only post, SSR normal buffer. */
    AfterOpaque = 50,
    /** Transparent geometry (sorted or OIT). */
    Transparent = 60,
    /** Slot for transparent-depth snapshots or deferred composites. */
    AfterTransparent = 70,
    /** Motion vectors, TAA jitter resolve — anything run before Post. */
    PrePost = 80,
    /** Post-processing chain (bloom, tonemap, color grade, ...). */
    Post = 90,
    /** Slot for FXAA / sharpen after tonemap. */
    AfterPost = 100,
    /** UI / canvas overlay. */
    UI = 110,
    /** Swapchain presentation. */
    Present = 120,
}
