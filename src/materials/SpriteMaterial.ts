import { Engine3D } from '../Engine3D';
import { Context3D } from '../gfx/graphics/webGpu/Context3D';
import { SpriteShader } from '../gfx/graphics/webGpu/shader/SpriteShader';
import { Texture } from '../gfx/graphics/webGpu/core/texture/Texture';
import { Color } from '../math/Color';
import { Vector2 } from '../math/Vector2';
import { Vector4 } from '../math/Vector4';
import { Material } from './Material';

/**
 * Material for `Sprite` (textured quad). Writes a single textured, tinted
 * quad with optional fill-ratio mask and rounded-corner alpha. No lighting,
 * no shadow, no reflection — depth-test on, depth-write off, two-sided,
 * blendMode NORMAL.
 * @group Material
 */
export class SpriteMaterial extends Material {

    constructor(ctx?: Context3D) {
        super();
        this.shader = new SpriteShader();
        // Default sprite is a white quad — callers assign texture/color later.
        this.baseMap = Engine3D.resFor(ctx).whiteTexture;
    }

    public set baseMap(texture: Texture) {
        this.shader.setTexture(`baseMap`, texture);
    }

    public get baseMap(): Texture {
        return this.shader.getTexture(`baseMap`);
    }

    public set color(value: Color) {
        this.shader.setUniformColor(`color`, value);
    }

    public get color(): Color {
        return this.shader.getUniformColor(`color`);
    }

    /** UV sub-region as (offsetX, offsetY, scaleX, scaleY) in [0,1] texture space. */
    public set uvRect(value: Vector4) {
        this.shader.setUniformVector4(`uvRect`, value);
    }

    public get uvRect(): Vector4 {
        return this.shader.getUniformVector4(`uvRect`);
    }

    /** Quad size in local units. Used by the corner-radius SDF to size pixels. */
    public set size(value: Vector2) {
        this.shader.setUniformVector2(`size`, value);
    }

    public get size(): Vector2 {
        return this.shader.getUniformVector2(`size`);
    }

    public set pivot(value: Vector2) {
        this.shader.setUniformVector2(`pivot`, value);
    }

    public get pivot(): Vector2 {
        return this.shader.getUniformVector2(`pivot`);
    }

    /** 0..1 portion of the quad that shows through. 1 = fully visible. */
    public set fillRatio(value: number) {
        this.shader.setUniformFloat(`fillRatio`, value);
    }

    public get fillRatio(): number {
        return this.shader.getUniformFloat(`fillRatio`);
    }

    /** 0 = horizontal right, 1 = horizontal left, 2 = vertical up, 3 = vertical down. */
    public set fillDirection(value: number) {
        this.shader.setUniformFloat(`fillDirection`, value);
    }

    public get fillDirection(): number {
        return this.shader.getUniformFloat(`fillDirection`);
    }

    /** Rounded-corner radius in the same units as `size`. 0 disables. */
    public set cornerRadius(value: number) {
        this.shader.setUniformFloat(`cornerRadius`, value);
    }

    public get cornerRadius(): number {
        return this.shader.getUniformFloat(`cornerRadius`);
    }

    /** 9-slice border in source-UV space: (left, top, right, bottom). Feed `sliceEnable=true` to activate. */
    public set sliceBorder(value: Vector4) {
        this.shader.setUniformVector4(`sliceBorder`, value);
    }

    public get sliceBorder(): Vector4 {
        return this.shader.getUniformVector4(`sliceBorder`);
    }

    /** Ratio of displaySize to source texture size, per axis. Set alongside `sliceBorder` + `sliceEnable`. */
    public set sliceScale(value: Vector2) {
        this.shader.setUniformVector2(`sliceScale`, value);
    }

    public get sliceScale(): Vector2 {
        return this.shader.getUniformVector2(`sliceScale`);
    }

    public set sliceEnable(value: boolean) {
        this.shader.setUniformFloat(`sliceEnable`, value ? 1.0 : 0.0);
    }

    public get sliceEnable(): boolean {
        return this.shader.getUniformFloat(`sliceEnable`) > 0.5;
    }

    /** Scissor rect in local UV space: (left, top, right, bottom), each in [0,1]. */
    public set scissorRect(value: Vector4) {
        this.shader.setUniformVector4(`scissorRect`, value);
    }

    public get scissorRect(): Vector4 {
        return this.shader.getUniformVector4(`scissorRect`);
    }

    public set scissorEnable(value: boolean) {
        this.shader.setUniformFloat(`scissorEnable`, value ? 1.0 : 0.0);
    }

    public get scissorEnable(): boolean {
        return this.shader.getUniformFloat(`scissorEnable`) > 0.5;
    }

    /** Corner rounding inside the scissor rect (in local UV). 0 = sharp corners. */
    public set scissorCornerRadius(value: number) {
        this.shader.setUniformFloat(`scissorCornerRadius`, value);
    }

    public get scissorCornerRadius(): number {
        return this.shader.getUniformFloat(`scissorCornerRadius`);
    }

    /** Fade-out width at the scissor edge in local UV (e.g. 0.02). 0 = hard clip. */
    public set scissorFadeOutSize(value: number) {
        this.shader.setUniformFloat(`scissorFadeOutSize`, value);
    }

    public get scissorFadeOutSize(): number {
        return this.shader.getUniformFloat(`scissorFadeOutSize`);
    }

    /** Toggle the video-texture code path. Sprite component sets this automatically when the texture is a `VideoTexture`. */
    public set useVideoTexture(value: boolean) {
        this.shader.setDefine(`USE_VIDEO_TEXTURE`, value);
    }

    public get useVideoTexture(): boolean {
        return this.shader.getDefine(`USE_VIDEO_TEXTURE`);
    }

    public set envMap(_texture: Texture) {
        // sprites don't sample environment
    }

    public set shadowMap(_texture: Texture) {
        // sprites don't receive shadow
    }
}
