import { Context3D } from '../../../graphics/webGpu/Context3D';
import { GPUTextureFormat } from '../../../graphics/webGpu/WebGPUConst';
import { RenderTexture } from '../../../../textures/RenderTexture';
import { RTResourceMap } from '../../frame/RTResourceMap';
import { FeatureContext, RenderFeature } from '../RenderFeature';
import { RenderStage } from '../RenderStage';

export const MOTION_VECTOR = '_MotionVector';

/**
 * Per-pixel screen-space motion vector pass.
 *
 * **MVP status — skeleton**: allocates the `_MotionVector` (rg16float)
 * RT and registers the graph handle; the per-frame compute that
 * computes `currUv - prevUv` from depth + prevViewProj is the
 * follow-up. The TAA upgrade in Phase 3.1 will fall back to its
 * existing reverse-reproject path until this lands.
 *
 * Once implemented, the compute pass will:
 *   1. Read GBufferFrame.depthTexture per pixel.
 *   2. Reconstruct world position from currInvViewProj * (uv, depth).
 *   3. Project world position with `prevViewProj` (added to GlobalUniform
 *      as a separate field — needs std140 padding audit, see RTE history).
 *   4. Output `currUv - prevUv` to `_MotionVector`.
 *
 * Limitation: this is a screen-space static-only motion vector.
 * Skinned mesh / animated geometry need per-vertex prev-clip-pos
 * which requires a vertex shader change. Tagged as a Phase 3+
 * upgrade in the roadmap.
 *
 * @group Graph
 */
export class MotionVectorFeature extends RenderFeature {
    public readonly name = 'MotionVectorFeature';
    public readonly stage = RenderStage.MotionVector;
    public readonly reads: readonly string[] = [];
    public readonly writes = [MOTION_VECTOR];

    private readonly _ctx: Context3D;
    private _mv: RenderTexture | null = null;

    constructor(ctx: Context3D) {
        super();
        this._ctx = ctx;
    }

    public registerResources(pool: { registerExternal<T>(name: string, getter: () => T): void }): void {
        pool.registerExternal<RenderTexture>(MOTION_VECTOR, () => this._getOrAllocate());
    }

    private _getOrAllocate(): RenderTexture {
        const [w, h] = this._ctx.presentationSize;
        if (this._mv && this._mv.width === w && this._mv.height === h) return this._mv;
        this._mv = RTResourceMap.createRTTexture(
            this._ctx, MOTION_VECTOR, w, h,
            GPUTextureFormat.rg16float,
            false, 0,
        );
        this._mv.name = MOTION_VECTOR;
        return this._mv;
    }

    public execute(_ctx: FeatureContext): void {
        this._getOrAllocate();
        // Compute generation deferred — see class doc.
    }
}
