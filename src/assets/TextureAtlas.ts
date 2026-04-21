import { Texture } from "../gfx/graphics/webGpu/core/texture/Texture";
import { Vector2 } from "../math/Vector2";
import { Vector4 } from "../math/Vector4";

/**
 * A single sub-region inside a `TextureAtlas`. Feeds directly into
 * `Sprite.texture = region` — the setter pulls `atlas.texture`, `uv`, and
 * `size` from the region to configure the sprite's material.
 *
 * @group Assets
 */
export class TextureAtlasRegion {
    public readonly atlas: TextureAtlas;
    /** UV sub-rect in [0,1] texture space as (offsetX, offsetY, scaleX, scaleY). */
    public readonly uv: Vector4;
    /** Display size of the region in pixels. */
    public readonly size: Vector2;
    public readonly id: string;
    /**
     * 9-slice border in normalized source-UV fractions (left, top, right, bottom).
     * Each component in [0, 1] relative to the region's own size. `(0,0,0,0)` → solid sprite (no slicing).
     */
    public border: Vector4;

    constructor(atlas: TextureAtlas, id: string, uv: Vector4, size: Vector2, border?: Vector4) {
        this.atlas = atlas;
        this.id = id;
        this.uv = uv;
        this.size = size;
        this.border = border ?? new Vector4(0, 0, 0, 0);
    }
}

/**
 * Texture atlas — a base texture plus named sub-regions. Returned by
 * `Engine3D.resFor(ctx).loadAtlas(url)`. Pair with `Sprite.texture = region`
 * to render a single sub-image as a sprite.
 *
 * Regions are plain data (no GPU state) — the texture itself is the only
 * device-bound resource. Safe to share across engines if the backing texture
 * has been cloned (see Plan B docs).
 *
 * @group Assets
 */
export class TextureAtlas {
    public texture: Texture;
    public readonly regions: Map<string, TextureAtlasRegion>;
    public name: string = '';

    constructor(texture: Texture) {
        this.texture = texture;
        this.regions = new Map<string, TextureAtlasRegion>();
    }

    public get(id: string): TextureAtlasRegion | undefined {
        return this.regions.get(id);
    }

    /** Register a region. `uv` is normalized in [0,1]; `size` in pixels; `border` (optional) in normalized region-UV fractions. */
    public add(id: string, uv: Vector4, size: Vector2, border?: Vector4): TextureAtlasRegion {
        const region = new TextureAtlasRegion(this, id, uv, size, border);
        this.regions.set(id, region);
        return region;
    }

    /** Add a region from pixel-space rect (x, y, w, h) inside the source texture. */
    public addPixelRect(id: string, pixelRect: { x: number; y: number; w: number; h: number }, atlasWidth: number, atlasHeight: number, displaySize?: Vector2): TextureAtlasRegion {
        const uv = new Vector4(
            pixelRect.x / atlasWidth,
            pixelRect.y / atlasHeight,
            pixelRect.w / atlasWidth,
            pixelRect.h / atlasHeight,
        );
        const size = displaySize ?? new Vector2(pixelRect.w, pixelRect.h);
        return this.add(id, uv, size);
    }
}
