import { Sprite, SpriteModifyFlags } from '../../assets/Sprite';
import { Object3D } from '../../core/entities/Object3D';
import { GeometryBase } from '../../core/geometry/GeometryBase';
import { PlaneGeometry } from '../../shape/PlaneGeometry';
import { Context3D } from '../../gfx/graphics/webGpu/Context3D';
import { Texture } from '../../gfx/graphics/webGpu/core/texture/Texture';
import { Color } from '../../math/Color';
import { Vector2 } from '../../math/Vector2';
import { Vector3 } from '../../math/Vector3';
import { Vector4 } from '../../math/Vector4';
import { SpriteMaterial } from '../../materials/SpriteMaterial';
import { RegisterComponent } from '../../util/SerializeDecoration';
import { RenderNode } from './RenderNode';

/**
 * How a `SpriteRenderer` builds its quad geometry.
 * - `simple` — single quad scaled to `size` (default)
 * - `sliced` — 9-slice border remap driven by `sprite.border`
 * - `tiled` — reserved, not implemented; falls back to `simple`
 *
 * @group Components
 */
export enum SpriteDrawMode {
    simple = 0,
    sliced = 1,
    tiled = 2,
}

/**
 * Component that renders a `Sprite` asset. Mount on any `Object3D`,
 * bind a Sprite via `renderer.sprite = mySprite` (or use the shortcut
 * `renderer.setTexture(tex)` for a one-off private sprite). Each
 * renderer adds per-instance `color` / `size` / `flipX` / `flipY` /
 * advanced effects (`fillRatio`, `cornerRadius`, `scissor*`) on top of
 * the shared sprite asset.
 *
 * @group Components
 */
@RegisterComponent(SpriteRenderer, 'SpriteRenderer')
export class SpriteRenderer extends RenderNode {
    /** Bound Sprite asset. Never mutated by this renderer — per-instance tweaks live in the override fields below. */
    private _sprite: Sprite | null = null;
    /** Auto-managed Sprite backing the `setTexture()` ergonomics — created lazily when the user assigns a bare texture. */
    private _autoSprite: Sprite | null = null;
    /** Bound change listener reference so we can unbind cleanly. */
    private _spriteListener: (flags: SpriteModifyFlags) => void;

    // Per-renderer overrides that survive sprite-asset swaps. `null` = fall
    // through to the bound sprite's own field. Without these, `set pivot(v)`
    // / `set uvRect(v)` would have to mutate the asset (clone-on-write),
    // which resets every time `this.sprite = otherAtlasRegion` rebinds.
    private _pivotOverride: Vector2 | null = null;
    private _uvRectOverride: Vector4 | null = null;

    private _pendingColor: Color | null = null;
    private _pendingFillRatio: number | null = null;
    private _pendingFillDirection: number | null = null;
    private _pendingCornerRadius: number | null = null;
    private _customSize: Vector2 | null = null;
    private _flipX: boolean = false;
    private _flipY: boolean = false;
    private _drawMode: SpriteDrawMode = SpriteDrawMode.simple;

    constructor() {
        super();
        this._spriteListener = (flags) => this._onSpriteChange(flags);
    }

    public init(param?: any) {
        super.init(param);
        this.renderOrder = 3000;
    }

    /** Shared unit quad on the Z axis, cached per Context3D. */
    private static _sharedQuad(ctx: Context3D): GeometryBase {
        return ctx.cache(SpriteRenderer, () => new PlaneGeometry(1, 1, 1, 1, Vector3.Z_AXIS));
    }

    public onEnable(): void {
        if (!this._geometry || this._materials.length === 0) {
            this._ensureResources();
        }
        super.onEnable();
    }

    public onDisable(): void {
        super.onDisable();
    }

    private _ensureResources(): void {
        const ctx = this.transform?.view3D?.engine3D?.context3D;
        if (!ctx) return;
        if (!this._geometry) {
            this.geometry = SpriteRenderer._sharedQuad(ctx);
        }
        if (this._materials.length === 0) {
            const mat = new SpriteMaterial(ctx);
            this.material = mat;
            this._applySpriteToMaterial();
            this._applyOverridesToMaterial();
        }
    }

    // ---------- Sprite binding ----------

    /** The bound `Sprite` asset. `null` until either `sprite` is set explicitly or a shortcut setter runs. */
    public get sprite(): Sprite | null {
        return this._sprite;
    }

    public set sprite(value: Sprite | null) {
        if (this._sprite === value) return;
        if (this._sprite) this._sprite.offChange(this._spriteListener);
        this._sprite = value;
        if (value) {
            value.onChange(this._spriteListener);
        }
        // NOTE: per-renderer overrides (_pivotOverride / _uvRectOverride /
        // _customSize / flipX / flipY / _drawMode / color / etc) intentionally
        // survive an asset swap. Swapping atlas regions should not reset the
        // renderer's anchor, UV sub-region, or size.
        this._applySpriteToMaterial();
    }

    /**
     * Shortcut: bind a bare texture as the sprite. The first call creates a
     * private auto-managed `Sprite`; subsequent calls update its texture in
     * place without allocating a new Sprite.
     */
    public setTexture(texture: Texture): void {
        if (!this._autoSprite) {
            this._autoSprite = new Sprite({ texture });
        } else {
            this._autoSprite.texture = texture;
        }
        // Bind (or re-bind) to the auto sprite. Any user-explicit `sprite`
        // assignment pointing elsewhere is overwritten — that's the intended
        // semantic of "set texture on this renderer".
        if (this._sprite !== this._autoSprite) this.sprite = this._autoSprite;
    }

    /**
     * Anchor point in [0,1]². Stored as a per-renderer override; the bound
     * sprite asset stays untouched. Swapping `sprite` preserves this.
     */
    public get pivot(): Vector2 {
        return this._pivotOverride ?? this._sprite?.pivot ?? new Vector2(0.5, 0.5);
    }

    public set pivot(value: Vector2) {
        if (!this._pivotOverride) this._pivotOverride = new Vector2();
        this._pivotOverride.set(value.x, value.y);
        this._applyPivotToMaterial();
    }

    /**
     * UV sub-region as normalized `(offsetX, offsetY, scaleX, scaleY)`.
     * Stored as a per-renderer override; the bound sprite asset stays
     * untouched. Swapping `sprite` preserves this.
     */
    public get uvRect(): Vector4 {
        return this._uvRectOverride ?? this._sprite?.region ?? new Vector4(0, 0, 1, 1);
    }

    public set uvRect(value: Vector4) {
        if (!this._uvRectOverride) this._uvRectOverride = new Vector4();
        this._uvRectOverride.set(value.x, value.y, value.z, value.w);
        this._applyUVRectToMaterial();
    }

    /** Shortcut: assign a `Sprite` from a texture (auto-managed private sprite). */
    public set texture(tex: Texture) {
        this.setTexture(tex);
    }

    public get texture(): Texture | null {
        return this._sprite?.texture ?? null;
    }

    // ---------- Per-renderer overrides ----------

    /** Rendering color (multiplied with the sprite's sampled texel). */
    public get color(): Color | null {
        return this._spriteMaterial()?.color ?? this._pendingColor;
    }

    public set color(value: Color) {
        const mat = this._spriteMaterial();
        if (mat) mat.color = value; else this._pendingColor = value;
    }

    /** Render size in pixels. When unset, uses `sprite.nativeSize`. */
    public get size(): Vector2 | null {
        if (this._customSize) return this._customSize;
        return this._sprite?.nativeSize ?? null;
    }

    public set size(value: Vector2) {
        this._customSize = (this._customSize ?? new Vector2()).set(value.x, value.y) as Vector2;
        this._applySize();
    }

    public get flipX(): boolean { return this._flipX; }
    public set flipX(v: boolean) {
        if (this._flipX !== v) { this._flipX = v; this._applySize(); }
    }

    public get flipY(): boolean { return this._flipY; }
    public set flipY(v: boolean) {
        if (this._flipY !== v) { this._flipY = v; this._applySize(); }
    }

    public get drawMode(): SpriteDrawMode { return this._drawMode; }
    public set drawMode(value: SpriteDrawMode) {
        if (this._drawMode === value) return;
        this._drawMode = value;
        this._applyDrawMode();
    }

    // ---------- Advanced per-renderer effects ----------

    public get fillRatio(): number {
        const mat = this._spriteMaterial();
        return mat ? mat.fillRatio : (this._pendingFillRatio ?? 1.0);
    }

    public set fillRatio(value: number) {
        const mat = this._spriteMaterial();
        if (mat) mat.fillRatio = value; else this._pendingFillRatio = value;
    }

    public get fillDirection(): number {
        const mat = this._spriteMaterial();
        return mat ? mat.fillDirection : (this._pendingFillDirection ?? 0.0);
    }

    public set fillDirection(value: number) {
        const mat = this._spriteMaterial();
        if (mat) mat.fillDirection = value; else this._pendingFillDirection = value;
    }

    public get cornerRadius(): number {
        const mat = this._spriteMaterial();
        return mat ? mat.cornerRadius : (this._pendingCornerRadius ?? 0.0);
    }

    public set cornerRadius(value: number) {
        const mat = this._spriteMaterial();
        if (mat) mat.cornerRadius = value; else this._pendingCornerRadius = value;
    }

    /** UV-space scissor clip. See `SpriteMaterial.setScissor` for semantics. */
    public setScissor(rect: Vector4, cornerRadius: number = 0, fadeOutSize: number = 0) {
        const mat = this._spriteMaterial();
        if (!mat) return;
        mat.scissorRect = rect;
        mat.scissorCornerRadius = cornerRadius;
        mat.scissorFadeOutSize = fadeOutSize;
        mat.scissorEnable = true;
    }

    public clearScissor() {
        const mat = this._spriteMaterial();
        if (mat) mat.scissorEnable = false;
    }

    // ---------- Material / visibility ----------

    public get material(): SpriteMaterial {
        return this._spriteMaterial();
    }

    public set material(value: SpriteMaterial) {
        this.materials = [value];
        this._applySpriteToMaterial();
        this._applyOverridesToMaterial();
    }

    /** Alias for `enable` — `visible = false` stops rendering without destroying the component. */
    public get visible(): boolean { return this.enable; }
    public set visible(value: boolean) { this.enable = value; }

    // ---------- Internal ----------

    private _spriteMaterial(): SpriteMaterial | null {
        return (this._materials[0] as SpriteMaterial) ?? null;
    }

    private _applySpriteToMaterial() {
        const mat = this._spriteMaterial();
        if (!mat || !this._sprite) return;
        const sprite = this._sprite;

        // Texture + video-texture define branch
        if (sprite.texture) {
            const isVideo = (sprite.texture as any)?.isVideoTexture === true;
            if (mat.useVideoTexture !== isVideo) mat.useVideoTexture = isVideo;
            mat.baseMap = sprite.texture;
        }

        this._applyUVRectToMaterial();
        this._applyPivotToMaterial();
        this._applySize();
        this._applyDrawMode();
    }

    private _applyPivotToMaterial() {
        const mat = this._spriteMaterial();
        if (!mat) return;
        const p = this._pivotOverride ?? this._sprite?.pivot;
        if (!p) return;
        mat.pivot = new Vector2(p.x, p.y);
    }

    private _applyUVRectToMaterial() {
        const mat = this._spriteMaterial();
        if (!mat) return;
        const r = this._uvRectOverride ?? this._sprite?.region;
        if (!r) return;
        mat.uvRect = new Vector4(r.x, r.y, r.z, r.w);
    }

    private _applyOverridesToMaterial() {
        const mat = this._spriteMaterial();
        if (!mat) return;
        if (this._pendingColor) mat.color = this._pendingColor;
        if (this._pendingFillRatio !== null) mat.fillRatio = this._pendingFillRatio;
        if (this._pendingFillDirection !== null) mat.fillDirection = this._pendingFillDirection;
        if (this._pendingCornerRadius !== null) mat.cornerRadius = this._pendingCornerRadius;
        // Pivot / uvRect overrides are pushed through _applySpriteToMaterial
        // during _ensureResources, so no duplicate write here.
    }

    private _applySize() {
        const mat = this._spriteMaterial();
        if (!mat) return;
        const size = this._customSize ?? this._sprite?.nativeSize;
        if (!size) return;
        const sx = this._flipX ? -size.x : size.x;
        const sy = this._flipY ? -size.y : size.y;
        mat.size = new Vector2(sx, sy);
    }

    private _applyDrawMode() {
        const mat = this._spriteMaterial();
        if (!mat || !this._sprite) return;
        const border = this._sprite.border;
        const sliced = this._drawMode === SpriteDrawMode.sliced
            && (border.x > 0 || border.y > 0 || border.z > 0 || border.w > 0);
        if (sliced) {
            mat.sliceBorder = new Vector4(border.x, border.y, border.z, border.w);
            const native = this._sprite.nativeSize;
            const displaySize = this._customSize ?? native;
            const scale = new Vector2(
                displaySize.x / Math.max(native.x, 0.0001),
                displaySize.y / Math.max(native.y, 0.0001),
            );
            mat.sliceScale = scale;
            mat.sliceEnable = true;
        } else {
            mat.sliceEnable = false;
        }
    }

    private _onSpriteChange(_flags: SpriteModifyFlags) {
        if (!this._spriteMaterial()) return;
        // Asset mutations re-apply everything except fields masked by a
        // per-renderer override — those stay locked to the override value.
        this._applySpriteToMaterial();
    }

    public cloneTo(obj: Object3D): void {
        const renderer = obj.addComponent(SpriteRenderer);
        renderer.copyComponent(this);
    }

    public copyComponent(from: this): this {
        super.copyComponent(from);
        if (from._sprite) this.sprite = from._sprite;
        if (from._pivotOverride) this.pivot = from._pivotOverride;
        if (from._uvRectOverride) this.uvRect = from._uvRectOverride;
        if (from._customSize) this.size = from._customSize;
        if (from.color) this.color = from.color.clone();
        this.flipX = from._flipX;
        this.flipY = from._flipY;
        this._drawMode = from._drawMode;
        this.fillRatio = from.fillRatio;
        this.fillDirection = from.fillDirection;
        this.cornerRadius = from.cornerRadius;
        return this;
    }
}
