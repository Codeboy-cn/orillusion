
/**
 * Shadow setting
 * @group Setting
 */
export type ShadowSetting = {
    debug: any,
    /**
     * enable
     */
    enable: boolean;
    /**
     *
     */
    needUpdate: boolean;
    /**
     * update shadown automatic
     */
    autoUpdate: boolean;

    /**
     * frequency for shadows update
     */
    updateFrameRate: number;

    /**
     * Percentage-Closer Filtering(PCF)is a simple, often seen technique for removing shadow edges.
     * Soft shadow, is a soft and blurred shadow that is farther away from the object when the light is shot down.
     * Hard shadow, is a sharper shadow, at the exchange (connection) with the object or the place where the light hits and close to the object, 
     or the occluded place where the sunlight cannot reach.
     */
    type: `PCF` | `HARD` | `SOFT`;
    // /**
    //  * Shadow quality
    //  */
    // shadowQuality: number;
    /**
     * shadow mapping Size
     */
    shadowSize: number;
    /**
     * Shadow softness
     */
    shadowSoft: number;
    /**
     * Point shadow mapping size
     */
    pointShadowSize: number;
    /**
     * Blend Shadow(0-1)
     */
    csmMargin: number;
    /**
     * scattering csm Area Exponent for each level
     */
    csmScatteringExp: number;
    /**
     * scale csm Area of all level
     */
    csmAreaScale: number;
    // /**
    //  * Shadow near section
    //  */
    // shadowNear: number;
    // /**
    //  * Shadow Far Section
    //  */
    // shadowFar: number;

    /**
     * max shadow map number
     */
    maxShadowMapNum: number;

    /**
     * max shadow map width
     */
    maxShadowMapWidth: number;

    /**
     * max shadow map height
     */
    maxShadowMapHeight: number;

    /**
     * max cascades for csm
     */
    maxCascades: number;

    /**
     * shadow bound, the area of shadow map projection,
     * the larger the value, the more area the shadow map covers,
     * but the lower the quality.
     * The smaller the value, the higher the quality,
     * but the smaller the area covered by the shadow map.
     * It is recommended to set this value according to the
     * scene size and light distance.
     */
    shadowBound: number;

    /**
     * Opt-in static-shadow caching.
     *
     * When `true`, the shadow-cast pass splits into two phases per frame:
     *   1. If the per-light static layer is dirty (light moved, or the scene
     *      explicitly marked dirty), rebuild it by drawing only renderers
     *      with `shadowCacheMode === 'static'`. Result stored in a cached
     *      depth texture.
     *   2. Every frame: copy the cached static depth into the live shadow
     *      map and draw renderers with `shadowCacheMode === 'dynamic'` on
     *      top (load-op preserves the copied depth, allowing correct
     *      occlusion resolution between static and dynamic geometry).
     *
     * When `false` (default), all renderers are treated as dynamic and the
     * pipeline behaves exactly like before — no cached layer, no extra
     * copies. Safe default for backwards compatibility.
     *
     * Only `'auto'` / `'static'` / `'dynamic'` tags on `RenderNode.shadowCacheMode`
     * are consulted when this flag is on; `'auto'` counts as dynamic.
     */
    enableStaticCache?: boolean;
};