//https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_texture_transform

import { Vector4 } from "../../../../math/Vector4";

/** What a glTF `textureInfo` resolves to once KHR_texture_transform and the
 *  base `texCoord` have both been taken into account. */
export type ResolvedTextureInfo = {
    /** `(offset.x, offset.y, scale.x, scale.y)`, consumed by the shader's
     *  `transformUV` as `uv * zw + xy`. Null when the texture needs no
     *  transform, so the material keeps its identity default. */
    offsetSize: Vector4 | null;
    /** Which UV set to sample: 0 for TEXCOORD_0, 1 for TEXCOORD_1. The
     *  extension's own `texCoord` overrides the textureInfo's when present. */
    texCoord: number;
};

/**
 * KHR_texture_transform: per-texture UV offset / scale / rotation.
 *
 * @group Loader
 */
export class KHR_texture_transform {
    private static _warnedRotation = false;

    /**
     * Resolve a glTF `textureInfo` into the UV transform and UV set the
     * engine should use for that slot.
     *
     * @param textureInfo the glTF textureInfo object (may be undefined).
     * @returns the resolved offset/scale and UV set index.
     */
    public static apply(textureInfo: any): ResolvedTextureInfo {
        const result: ResolvedTextureInfo = {
            offsetSize: null,
            // glTF defaults texCoord to 0 when absent.
            texCoord: textureInfo?.texCoord ?? 0,
        };
        if (!textureInfo) return result;

        const ext = textureInfo.extensions?.KHR_texture_transform;
        if (!ext) return result;

        const offset = ext.offset ?? [0, 0];
        const scale = ext.scale ?? [1, 1];
        result.offsetSize = new Vector4(offset[0], offset[1], scale[0], scale[1]);

        // The extension may retarget the UV set independently of the
        // textureInfo's own texCoord.
        if (ext.texCoord !== undefined) result.texCoord = ext.texCoord;

        // Rotation needs a full 2x2 matrix; the engine's per-slot uniform is
        // an offset/scale vec4, so a rotated transform would silently render
        // with the wrong UVs. Say so once rather than looking correct.
        if (ext.rotation) {
            if (!KHR_texture_transform._warnedRotation) {
                KHR_texture_transform._warnedRotation = true;
                console.warn(`[KHR_texture_transform] 'rotation' (${ext.rotation}) is not supported — only offset and scale are applied. UVs for this texture will be unrotated.`);
            }
        }
        return result;
    }
}
