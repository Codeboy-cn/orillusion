import { Texture } from '../gfx/graphics/webGpu/core/texture/Texture';
import { Vector2 } from '../math/Vector2';
import { Vector4 } from '../math/Vector4';

/**
 * Change-notification flags emitted when a field of a `Sprite` asset
 * mutates. Consumers subscribe via `Sprite.onChange`.
 *
 * @group Assets
 */
export enum SpriteModifyFlags {
    texture = 1 << 0,
    region = 1 << 1,
    pivot = 1 << 2,
    border = 1 << 3,
    nativeSize = 1 << 4,
}

export type SpriteChangeListener = (flags: SpriteModifyFlags) => void;

/**
 * Sprite — 2D image **asset**. Describes what to render: a region of a
 * texture, an anchor pivot, and (optionally) a 9-slice border.
 *
 * A Sprite is data, not a component. One Sprite can be shared by many
 * `SpriteRenderer` components — renderers subscribe to change
 * notifications via `onChange` so updating the shared sprite propagates
 * to every instance that binds it. Pair with `TextureAtlas.get(name)` to
 * get sprites directly from a packed atlas.
 *
 * @group Assets
 */
export class Sprite {
    public name: string = '';

    private _texture: Texture | null = null;
    /** Normalized sub-rect of `texture` in UV space — (offsetX, offsetY, scaleX, scaleY). */
    private _region: Vector4 = new Vector4(0, 0, 1, 1);
    /** Anchor point in [0,1]² — (0.5, 0.5) = centered, (0, 0) = top-left for screen overlay. */
    private _pivot: Vector2 = new Vector2(0.5, 0.5);
    /** 9-slice border in normalized region-UV: (left, top, right, bottom). `(0,0,0,0)` disables 9-slice. */
    private _border: Vector4 = new Vector4(0, 0, 0, 0);
    /** Explicit native display size in pixels (overrides texture-derived default). */
    private _customNativeSize: Vector2 | null = null;
    /** Cached derived native size when `_customNativeSize` is null. */
    private _derivedNativeSize: Vector2 = new Vector2(0, 0);

    private _listeners: SpriteChangeListener[] = [];

    constructor(opts?: {
        texture?: Texture;
        region?: Vector4;
        pivot?: Vector2;
        border?: Vector4;
        nativeSize?: Vector2;
        name?: string;
    }) {
        if (opts) {
            if (opts.texture) this._texture = opts.texture;
            if (opts.region) this._region.copyFrom(opts.region);
            if (opts.pivot) this._pivot.copyFrom(opts.pivot);
            if (opts.border) this._border.copyFrom(opts.border);
            if (opts.nativeSize) {
                this._customNativeSize = new Vector2(opts.nativeSize.x, opts.nativeSize.y);
            }
            if (opts.name) this.name = opts.name;
        }
    }

    public get texture(): Texture | null { return this._texture; }
    public set texture(value: Texture | null) {
        if (this._texture !== value) {
            this._texture = value;
            this._dispatch(SpriteModifyFlags.texture);
        }
    }

    public get region(): Vector4 { return this._region; }
    public set region(v: Vector4) {
        this._region.copyFrom(v);
        this._dispatch(SpriteModifyFlags.region);
    }

    public get pivot(): Vector2 { return this._pivot; }
    public set pivot(v: Vector2) {
        this._pivot.copyFrom(v);
        this._dispatch(SpriteModifyFlags.pivot);
    }

    public get border(): Vector4 { return this._border; }
    public set border(v: Vector4) {
        this._border.copyFrom(v);
        this._dispatch(SpriteModifyFlags.border);
    }

    /**
     * Native display size in pixels. When unset, derived from
     * `texture.width × region.z` and `texture.height × region.w`
     * (i.e. the sprite's sub-image size in the source texture).
     */
    public get nativeSize(): Vector2 {
        if (this._customNativeSize) return this._customNativeSize;
        const tex = this._texture;
        if (tex) {
            this._derivedNativeSize.x = tex.width * this._region.z;
            this._derivedNativeSize.y = tex.height * this._region.w;
        } else {
            this._derivedNativeSize.set(0, 0);
        }
        return this._derivedNativeSize;
    }

    public set nativeSize(v: Vector2) {
        if (!this._customNativeSize) this._customNativeSize = new Vector2();
        this._customNativeSize.set(v.x, v.y);
        this._dispatch(SpriteModifyFlags.nativeSize);
    }

    /** Subscribe to sprite field changes. Renderers use this to invalidate their cached vertex / UV data. */
    public onChange(fn: SpriteChangeListener): void {
        if (this._listeners.indexOf(fn) < 0) this._listeners.push(fn);
    }

    public offChange(fn: SpriteChangeListener): void {
        const i = this._listeners.indexOf(fn);
        if (i >= 0) this._listeners.splice(i, 1);
    }

    private _dispatch(flags: SpriteModifyFlags): void {
        const arr = this._listeners;
        for (let i = 0; i < arr.length; i++) arr[i](flags);
    }

    /** Shallow clone — texture is shared (not duplicated), all vector fields are copied. */
    public clone(): Sprite {
        const out = new Sprite();
        out.name = this.name;
        out._texture = this._texture;
        out._region.copyFrom(this._region);
        out._pivot.copyFrom(this._pivot);
        out._border.copyFrom(this._border);
        if (this._customNativeSize) {
            out._customNativeSize = new Vector2(this._customNativeSize.x, this._customNativeSize.y);
        }
        return out;
    }

    /** Convenience: build a Sprite from a bare texture, full region, centered pivot. */
    public static fromTexture(texture: Texture, name?: string): Sprite {
        return new Sprite({ texture, name });
    }
}
