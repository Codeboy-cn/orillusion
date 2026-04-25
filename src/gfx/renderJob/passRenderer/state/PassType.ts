/**
 * @internal
 */
export enum PassType {
    COLOR = 1 << 0,
    REFLECTION = 1 << 1,
    POSITION = 1 << 2,
    GRAPHIC = 1 << 3,
    GI = 1 << 4,
    Cluster = 1 << 5,
    SHADOW = 1 << 6,
    POINT_SHADOW = 1 << 7,
    POST = 1 << 8,
    DEPTH = 1 << 9,
    /** Weighted-Blended OIT accumulation pass (McGuire & Bavoil 2013).
     *  Materials with `oitMode === 'weighted'` register this pass; the
     *  TransparentOITFeature iterates them and writes to two attachments:
     *  `_OITAccum` (RGBA16F, blend=ONE/ONE) and `_OITReveal` (R8, blend=
     *  ZERO/ONE_MINUS_SRC_ALPHA). TransparentResolveFeature composites
     *  `accum.rgb / max(accum.a, 1e-4)` mixed by `1 - reveal` into
     *  `_ColorBuffer`. */
    OIT_ACCUM = 1 << 10,
}
