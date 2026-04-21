import { TextureAtlasRegion } from '../../assets/TextureAtlas';
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
 * Sprite renderer: a flat textured quad driven by `SpriteMaterial`.
 * Attach to any `Object3D` and set `texture`, `size`, `color`, etc. Renders
 * world-space by default; pair with an `OverlayCamera` for screen-space.
 *
 * The quad geometry is shared per-engine (a unit PlaneGeometry on the Z axis
 * cached in `Context3D.cache`) — each Sprite instance gets its own material
 * so per-sprite uniforms stay isolated.
 *
 * @group Components
 */
@RegisterComponent(Sprite, 'Sprite')
export class Sprite extends RenderNode {
    private _pendingTexture: Texture | null = null;
    private _pendingColor: Color | null = null;
    private _pendingSize: Vector2 | null = null;
    private _pendingPivot: Vector2 | null = null;
    private _pendingUvRect: Vector4 | null = null;
    private _pendingFillRatio: number | null = null;
    private _pendingFillDirection: number | null = null;
    private _pendingCornerRadius: number | null = null;
    private _pendingSliceBorder: Vector4 | null = null;
    private _pendingSliceScale: Vector2 | null = null;
    private _pendingSliceEnable: boolean | null = null;
    private _sliceSourceSize: Vector2 | null = null;
    private _sliceBorder: Vector4 | null = null;

    constructor() {
        super();
    }

    public init(param?: any) {
        super.init(param);
        // Sprites are transparent — put them in the transparent bucket so
        // they sort after opaque geometry.
        this.renderOrder = 3000;
    }

    /** Shared unit quad on the Z axis, cached per Context3D. */
    private static _sharedQuad(ctx: Context3D): GeometryBase {
        return ctx.cache(Sprite, () => new PlaneGeometry(1, 1, 1, 1, Vector3.Z_AXIS));
    }

    public onEnable(): void {
        // RenderNode.onEnable wants geometry + materials to exist before it
        // walks the pipeline. The earliest we can build them is when the
        // Object3D joins a scene attached to a view — Context3D becomes
        // reachable via transform.view3D.engine3D.
        if (!this._geometry || this._materials.length === 0) {
            this._ensureResources();
        }
        super.onEnable();
    }

    private _ensureResources(): void {
        const ctx = this.transform?.view3D?.engine3D?.context3D;
        if (!ctx) return;
        if (!this._geometry) {
            this.geometry = Sprite._sharedQuad(ctx);
        }
        if (this._materials.length === 0) {
            const mat = new SpriteMaterial(ctx);
            this.material = mat;
            this._flushPending(mat);
        }
    }

    private _flushPending(mat: SpriteMaterial) {
        if (this._pendingTexture) this._applyTextureToMat(mat, this._pendingTexture);
        if (this._pendingColor) mat.color = this._pendingColor;
        if (this._pendingSize) mat.size = this._pendingSize;
        if (this._pendingPivot) mat.pivot = this._pendingPivot;
        if (this._pendingUvRect) mat.uvRect = this._pendingUvRect;
        if (this._pendingFillRatio !== null) mat.fillRatio = this._pendingFillRatio;
        if (this._pendingFillDirection !== null) mat.fillDirection = this._pendingFillDirection;
        if (this._pendingCornerRadius !== null) mat.cornerRadius = this._pendingCornerRadius;
        if (this._pendingSliceBorder) mat.sliceBorder = this._pendingSliceBorder;
        if (this._pendingSliceScale) mat.sliceScale = this._pendingSliceScale;
        if (this._pendingSliceEnable !== null) mat.sliceEnable = this._pendingSliceEnable;
    }

    private _spriteMaterial(): SpriteMaterial | null {
        return (this._materials[0] as SpriteMaterial) ?? null;
    }

    /**
     * Base texture sampled by the sprite. Accepts either a raw `Texture` or a
     * `TextureAtlasRegion` — the region form also writes `uvRect`, `size`,
     * and (when present) 9-slice `sliceBorder` + `sliceScale` from the
     * region descriptor. Accepts `VideoTexture` too — the `USE_VIDEO_TEXTURE`
     * shader define is flipped on automatically.
     */
    public set texture(value: Texture | TextureAtlasRegion) {
        if (value instanceof TextureAtlasRegion) {
            this.uvRect = value.uv.clone();
            this.size = value.size.clone();
            // Apply 9-slice border if the region has one. sliceScale is
            // recomputed every time size changes (see set size).
            const hasBorder = value.border && (value.border.x > 0 || value.border.y > 0 || value.border.z > 0 || value.border.w > 0);
            const mat = this._spriteMaterial();
            if (hasBorder) {
                this._applySliceBorder(value.border, value.size);
            }
            const tex = value.atlas.texture;
            if (mat) {
                this._applyTextureToMat(mat, tex);
            } else {
                this._pendingTexture = tex;
            }
        } else {
            const mat = this._spriteMaterial();
            if (mat) {
                this._applyTextureToMat(mat, value);
            } else {
                this._pendingTexture = value;
            }
        }
    }

    public get texture(): Texture | null {
        return this._spriteMaterial()?.baseMap ?? this._pendingTexture;
    }

    private _applyTextureToMat(mat: SpriteMaterial, tex: Texture) {
        // Flip the video-texture shader branch before assigning — setTexture
        // triggers shader reflection, so the define must be in its final
        // state before the first pipeline build.
        const isVideo = (tex as any)?.isVideoTexture === true;
        if (mat.useVideoTexture !== isVideo) {
            mat.useVideoTexture = isVideo;
        }
        mat.baseMap = tex;
    }

    private _applySliceBorder(border: Vector4, sourceSize: Vector2) {
        const mat = this._spriteMaterial();
        // Record source size so `set size` can recompute sliceScale without
        // needing the atlas region.
        this._sliceSourceSize = sourceSize.clone();
        this._sliceBorder = border.clone();
        const displaySize = this._pendingSize ?? mat?.size ?? sourceSize;
        const scale = new Vector2(
            displaySize.x / Math.max(sourceSize.x, 0.0001),
            displaySize.y / Math.max(sourceSize.y, 0.0001),
        );
        if (mat) {
            mat.sliceBorder = this._sliceBorder;
            mat.sliceScale = scale;
            mat.sliceEnable = true;
        } else {
            this._pendingSliceBorder = this._sliceBorder;
            this._pendingSliceScale = scale;
            this._pendingSliceEnable = true;
        }
    }

    public set size(value: Vector2) {
        const mat = this._spriteMaterial();
        if (mat) mat.size = value; else this._pendingSize = value;
        // Recompute 9-slice scale when size changes — slice math depends on
        // displaySize / sourceSize.
        if (this._sliceSourceSize) {
            const scale = new Vector2(
                value.x / Math.max(this._sliceSourceSize.x, 0.0001),
                value.y / Math.max(this._sliceSourceSize.y, 0.0001),
            );
            if (mat) mat.sliceScale = scale; else this._pendingSliceScale = scale;
        }
    }

    public get size(): Vector2 | null {
        return this._spriteMaterial()?.size ?? this._pendingSize;
    }

    public set pivot(value: Vector2) {
        const mat = this._spriteMaterial();
        if (mat) mat.pivot = value; else this._pendingPivot = value;
    }

    public get pivot(): Vector2 | null {
        return this._spriteMaterial()?.pivot ?? this._pendingPivot;
    }

    public set color(value: Color) {
        const mat = this._spriteMaterial();
        if (mat) mat.color = value; else this._pendingColor = value;
    }

    public get color(): Color | null {
        return this._spriteMaterial()?.color ?? this._pendingColor;
    }

    public set uvRect(value: Vector4) {
        const mat = this._spriteMaterial();
        if (mat) mat.uvRect = value; else this._pendingUvRect = value;
    }

    public get uvRect(): Vector4 | null {
        return this._spriteMaterial()?.uvRect ?? this._pendingUvRect;
    }

    public set fillRatio(value: number) {
        const mat = this._spriteMaterial();
        if (mat) mat.fillRatio = value; else this._pendingFillRatio = value;
    }

    public get fillRatio(): number {
        const mat = this._spriteMaterial();
        if (mat) return mat.fillRatio;
        return this._pendingFillRatio ?? 1.0;
    }

    public set fillDirection(value: number) {
        const mat = this._spriteMaterial();
        if (mat) mat.fillDirection = value; else this._pendingFillDirection = value;
    }

    public get fillDirection(): number {
        const mat = this._spriteMaterial();
        if (mat) return mat.fillDirection;
        return this._pendingFillDirection ?? 0.0;
    }

    public set cornerRadius(value: number) {
        const mat = this._spriteMaterial();
        if (mat) mat.cornerRadius = value; else this._pendingCornerRadius = value;
    }

    public get cornerRadius(): number {
        const mat = this._spriteMaterial();
        if (mat) return mat.cornerRadius;
        return this._pendingCornerRadius ?? 0.0;
    }

    /**
     * Enable scissor clipping in local-UV space. Works alongside `scissorRect`
     * / `scissorCornerRadius` / `scissorFadeOutSize` on the underlying material.
     */
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

    /** Override the default SpriteMaterial. Use `new SpriteMaterial(engine.context3D)` for multi-engine setups. */
    public get material(): SpriteMaterial {
        return this._spriteMaterial();
    }

    public set material(value: SpriteMaterial) {
        this.materials = [value];
        if (value) this._flushPending(value);
    }

    /** Alias for `enable` — `visible=false` stops rendering without destroying the component. */
    public get visible(): boolean {
        return this.enable;
    }

    public set visible(value: boolean) {
        this.enable = value;
    }

    public cloneTo(obj: Object3D): void {
        const sprite = obj.addComponent(Sprite);
        sprite.copyComponent(this);
    }

    public copyComponent(from: this): this {
        super.copyComponent(from);
        if (from.texture) this.texture = from.texture;
        if (from.size) this.size = from.size.clone();
        if (from.pivot) this.pivot = from.pivot.clone();
        if (from.color) this.color = from.color.clone();
        if (from.uvRect) this.uvRect = from.uvRect.clone();
        this.fillRatio = from.fillRatio;
        this.fillDirection = from.fillDirection;
        this.cornerRadius = from.cornerRadius;
        return this;
    }
}
