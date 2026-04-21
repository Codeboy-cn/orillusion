import { Texture } from "../gfx/graphics/webGpu/core/texture/Texture";
import { Vector2 } from "../math/Vector2";
import { Vector4 } from "../math/Vector4";
import { Sprite } from "./Sprite";

/**
 * Texture atlas — a base texture plus a dictionary of named `Sprite`
 * assets. Returned by `Engine3D.resFor(ctx).loadAtlas(url)`.
 *
 * Each region parsed from the atlas JSON becomes a `Sprite` that shares
 * the atlas's texture and carries its own UV region / pivot / 9-slice
 * border. Pair with `SpriteRenderer.sprite = atlas.get('name')` to render.
 *
 * @group Assets
 */
export class TextureAtlas {
    public texture: Texture;
    public readonly sprites: Map<string, Sprite>;
    public name: string = '';

    constructor(texture: Texture) {
        this.texture = texture;
        this.sprites = new Map<string, Sprite>();
    }

    /** Look up a named sprite. Returns `undefined` if the atlas has no such region. */
    public get(id: string): Sprite | undefined {
        return this.sprites.get(id);
    }

    /** Register a sprite. `region` is normalized UV; `nativeSize` is display size in pixels. */
    public add(id: string, region: Vector4, nativeSize?: Vector2, border?: Vector4): Sprite {
        const sprite = new Sprite({
            texture: this.texture,
            region,
            nativeSize,
            border,
            name: id,
        });
        this.sprites.set(id, sprite);
        return sprite;
    }

    /** Register a sprite from a pixel-space rect in the source texture. */
    public addPixelRect(id: string, pixelRect: { x: number; y: number; w: number; h: number }, atlasWidth: number, atlasHeight: number, displaySize?: Vector2, border?: Vector4): Sprite {
        const region = new Vector4(
            pixelRect.x / atlasWidth,
            pixelRect.y / atlasHeight,
            pixelRect.w / atlasWidth,
            pixelRect.h / atlasHeight,
        );
        const size = displaySize ?? new Vector2(pixelRect.w, pixelRect.h);
        return this.add(id, region, size, border);
    }
}
