import { RenderTexture } from '../../../../textures/RenderTexture';
import { Texture } from '../../../graphics/webGpu/core/texture/Texture';
import { Context3D } from '../../../graphics/webGpu/Context3D';
import { TextureDesc } from './ResourceDesc';
import { ResourceLifetime } from './LifetimeAnalyzer';

/**
 * One physical {@link RenderTexture} slot held by the
 * {@link TransientTexturePool}. The wrapper persists across compile
 * windows; only its `inUseUntilIdx` / `inUseByName` debug fields
 * change per compile.
 *
 * @internal
 * @group Graph
 */
export interface PooledTexture {
    rt: RenderTexture;
    bucketKey: string;
    /** Last topo index in the current compile window at which the
     *  currently-assigned logical resource is alive. `-1` if free —
     *  i.e. eligible for reuse by a logical resource whose
     *  `firstUseIdx > inUseUntilIdx`. */
    inUseUntilIdx: number;
    inUseByName: string | null;
    estimatedBytes: number;
}

/**
 * Snapshot of one assign() call's resource-to-physical mapping.
 *
 * @group Graph
 */
export interface TransientTextureAssignment {
    /** logical resource name → the {@link RenderTexture} that
     *  `ctx.getTexture(name)` should return for this compile window. */
    bindings: Map<string, RenderTexture>;
    /** Per-name debug info: which bucket key the resource landed in
     *  and whether it aliased an existing entry. */
    debug: Map<string, { bucketKey: string; aliased: boolean; dedicated: boolean }>;
}

/**
 * Physical pool for transient render-graph textures with lifetime-aware
 * aliasing.
 *
 * Lifecycle:
 *
 *   compile() → LifetimeAnalyzer.analyze() → ResourceLifetime[]
 *             → pool.assign(lifetimes) → bindings Map
 *             → RenderGraphResourcePool registers () => binding
 *   execute() → ctx.getTexture(name) → pool-resolved RenderTexture
 *
 * Aliasing happens **inside one compile window**: lifetimes are sorted
 * by `firstUseIdx` ascending; for each one the pool finds a same-bucket
 * entry whose `inUseUntilIdx < firstUseIdx` and reuses it, otherwise
 * allocates a fresh {@link RenderTexture}. Across compile windows the
 * pool retains every allocated wrapper — the next assign() reshuffles
 * which logical name maps to which physical slot. Dedicated slots
 * (`aliasable: false`, mip pyramids, etc.) keep their `RenderTexture`
 * identity stable across windows by binding to a per-name slot that
 * lives outside the bucket reuse pool.
 *
 * On device-lost the pool calls `RenderTexture.destroy()` /
 * `Texture.delayDestroyTexture()` on every slot and clears the buckets;
 * the next compile re-allocates from scratch on the new device.
 *
 * @group Graph
 */
export class TransientTexturePool {
    private readonly _ctx: Context3D;
    private readonly _buckets = new Map<string, PooledTexture[]>();
    /** Per-name dedicated slots for aliasable:false resources. These
     *  bypass bucket reuse so consumers can cache bind groups against
     *  a stable `GPUTexture` identity across compiles. */
    private readonly _dedicatedByName = new Map<string, PooledTexture>();
    private _currentBytes = 0;
    private _peakBytes = 0;

    constructor(ctx: Context3D) {
        this._ctx = ctx;
    }

    /**
     * Allocate (or reuse) physical wrappers for every transient
     * lifetime. Persistent (imported) lifetimes are ignored — those
     * are registered directly by the builder when the external
     * texture is imported.
     */
    public assign(lifetimes: readonly ResourceLifetime[]): TransientTextureAssignment {
        // Reset bucket occupancy for the new compile window. The
        // wrappers themselves stay alive; their inUse markers reset.
        for (const list of this._buckets.values()) {
            for (const pt of list) {
                pt.inUseUntilIdx = -1;
                pt.inUseByName = null;
            }
        }

        const bindings = new Map<string, RenderTexture>();
        const debug = new Map<string, { bucketKey: string; aliased: boolean; dedicated: boolean }>();

        // Pool only handles transient textures. Persistent (imported)
        // entries are registered directly by the builder and never
        // enter the bucket map.
        const texLifetimes = lifetimes.filter(lt => lt.kind === 'texture' && !lt.persistent);

        // Sort by firstUseIdx ascending — earliest-starting lifetimes
        // pick first, leaving later-starting ones to reuse the freed
        // slots. Tie-break by name for determinism.
        const sorted = [...texLifetimes].sort((a, b) => {
            if (a.firstUseIdx !== b.firstUseIdx) return a.firstUseIdx - b.firstUseIdx;
            return a.name < b.name ? -1 : 1;
        });

        for (const lt of sorted) {
            const desc = lt.desc as TextureDesc;
            const w = lt.resolvedWidth!;
            const h = lt.resolvedHeight!;
            const usage = lt.resolvedUsage;
            if (!usage) {
                console.warn(
                    `[RenderGraph] transient texture '${lt.name}' resolved to usage=0 — ` +
                    `no read/write access hints recorded and no explicit usage on the desc. ` +
                    `Allocating with TEXTURE_BINDING as a safe default.`,
                );
            }
            const finalUsage = usage || GPUTextureUsage.TEXTURE_BINDING;
            const bucketKey = computeBucketKey(desc, w, h, finalUsage);
            const aliasable = desc.aliasable !== false;

            let slot: PooledTexture;
            let aliased = false;
            let dedicated = false;

            if (!aliasable) {
                // Stable identity across compile windows. The slot lives
                // outside the bucket reuse map.
                const existing = this._dedicatedByName.get(lt.name);
                if (existing && existing.bucketKey === bucketKey) {
                    slot = existing;
                } else {
                    if (existing) this._destroySlot(existing);
                    slot = this._allocateSlot(lt, desc, w, h, finalUsage, bucketKey);
                    this._dedicatedByName.set(lt.name, slot);
                }
                dedicated = true;
            } else {
                // Try to reuse a same-bucket entry whose previous
                // logical resource has finished before this one starts.
                let bucket = this._buckets.get(bucketKey);
                if (!bucket) {
                    bucket = [];
                    this._buckets.set(bucketKey, bucket);
                }
                slot = this._findReusableSlot(bucket, lt.firstUseIdx)
                    ?? this._appendNewSlot(bucket, lt, desc, w, h, finalUsage, bucketKey);
                aliased = slot.inUseByName !== null && slot.inUseByName !== lt.name;
                slot.inUseUntilIdx = lt.lastUseIdx;
                slot.inUseByName = lt.name;
            }

            bindings.set(lt.name, slot.rt);
            debug.set(lt.name, { bucketKey, aliased, dedicated });
        }

        // Sweep dedicated slots whose name disappeared from the active
        // declaration set — those represent passes that were removed
        // or replaced. Destroying them here keeps memory in line with
        // the live graph.
        const liveDedicated = new Set(sorted.filter(lt => (lt.desc as TextureDesc).aliasable === false).map(lt => lt.name));
        for (const [name, slot] of this._dedicatedByName) {
            if (!liveDedicated.has(name)) {
                this._destroySlot(slot);
                this._dedicatedByName.delete(name);
            }
        }

        return { bindings, debug };
    }

    /** Destroy every pooled wrapper. Called on graph destroy and
     *  device-lost. */
    public dispose(): void {
        for (const list of this._buckets.values()) {
            for (const slot of list) this._destroySlot(slot);
        }
        this._buckets.clear();
        for (const slot of this._dedicatedByName.values()) this._destroySlot(slot);
        this._dedicatedByName.clear();
        this._currentBytes = 0;
    }

    public stats(): { currentBytes: number; peakBytes: number; bucketCount: number; slotCount: number } {
        let slotCount = this._dedicatedByName.size;
        for (const list of this._buckets.values()) slotCount += list.length;
        return {
            currentBytes: this._currentBytes,
            peakBytes: this._peakBytes,
            bucketCount: this._buckets.size,
            slotCount,
        };
    }

    private _findReusableSlot(bucket: PooledTexture[], firstUseIdx: number): PooledTexture | null {
        // Prefer the slot whose previous run ended longest ago — gives
        // a deterministic packing that minimizes thrash across compiles.
        // Linear scan is fine: buckets are bounded by max-concurrent
        // resources of one shape (typically < 8 in real frame graphs).
        let best: PooledTexture | null = null;
        for (const slot of bucket) {
            if (slot.inUseByName !== null) continue;     // currently held by another lifetime
            if (slot.inUseUntilIdx >= firstUseIdx) continue; // last assignment overlaps
            if (best === null || slot.inUseUntilIdx < best.inUseUntilIdx) best = slot;
        }
        return best;
    }

    private _appendNewSlot(
        bucket: PooledTexture[],
        lt: ResourceLifetime,
        desc: TextureDesc,
        w: number,
        h: number,
        usage: number,
        bucketKey: string,
    ): PooledTexture {
        const slot = this._allocateSlot(lt, desc, w, h, usage, bucketKey);
        bucket.push(slot);
        return slot;
    }

    private _allocateSlot(
        lt: ResourceLifetime,
        desc: TextureDesc,
        w: number,
        h: number,
        usage: number,
        bucketKey: string,
    ): PooledTexture {
        // autoResize=false: the pool drives resize by re-running
        // analyze + assign whenever presentationSize changes (which
        // the graph schedules via markDirty on the canvas-resize
        // event). Letting the texture install its own listener would
        // double-resize and clobber the pool's lifetime bookkeeping.
        const rt = new RenderTexture(
            w,
            h,
            desc.format,
            (desc.mipLevelCount ?? 1) > 1,
            usage,
            desc.numberLayer ?? 1,
            desc.sampleCount ?? 0,
            /*clear*/ true,
            /*autoResize*/ false,
            this._ctx,
        );
        rt.name = desc.label ?? lt.name;
        // Force the GPUTextureDescriptor's actual mip count — the
        // RenderTexture ctor + resize() path forces useMipmap=false
        // and rebuilds the descriptor with mipLevelCount=1. Phase 4
        // removes this workaround at the RenderTexture level.
        //
        // Patch only `textureDescriptor.mipLevelCount` + null the
        // cached gpuTexture/view so the next materialize uses the new
        // mip count. Do NOT also touch `mipmapCount` / `viewDescriptor`
        // / `useMipmap` on the wrapper — those propagate into
        // `textureBindingLayout.sampleType` rebuilds that flip r32float
        // from `unfilterable-float` (correct) to filterable `float`
        // (rejected by validation). HiZ + downstream r32float consumers
        // bind via their own explicit views + bind-group layouts so the
        // wrapper-level sample-type defaults don't matter for them; for
        // rgba16float pyramids the defaults already match (filterable).
        const mips = desc.mipLevelCount ?? 1;
        if (mips > 1) {
            const rtAny = rt as unknown as {
                textureDescriptor?: GPUTextureDescriptor;
                gpuTexture: GPUTexture | null;
                view: GPUTextureView | null;
            };
            if (rtAny.textureDescriptor) {
                rtAny.textureDescriptor.mipLevelCount = mips;
            }
            rtAny.gpuTexture = null;
            rtAny.view = null;
        }
        const estimatedBytes = estimateTextureBytes(desc, w, h);
        this._currentBytes += estimatedBytes;
        if (this._currentBytes > this._peakBytes) this._peakBytes = this._currentBytes;
        return {
            rt,
            bucketKey,
            inUseUntilIdx: lt.lastUseIdx,
            inUseByName: lt.name,
            estimatedBytes,
        };
    }

    private _destroySlot(slot: PooledTexture): void {
        const gpu = (slot.rt as unknown as { gpuTexture: GPUTexture | null }).gpuTexture;
        if (gpu) Texture.delayDestroyTexture(this._ctx, gpu);
        (slot.rt as unknown as { gpuTexture: GPUTexture | null }).gpuTexture = null;
        (slot.rt as unknown as { view: GPUTextureView | null }).view = null;
        this._currentBytes -= slot.estimatedBytes;
        if (this._currentBytes < 0) this._currentBytes = 0;
    }
}

/**
 * Compose the bucket key. Two lifetimes can alias only when their keys
 * match exactly — any difference (format, size, sample/layer/mip count,
 * usage) routes them to separate buckets.
 *
 * @internal
 */
export function computeBucketKey(desc: TextureDesc, w: number, h: number, usage: number): string {
    const mip = desc.mipLevelCount ?? 1;
    const sample = desc.sampleCount ?? 0;
    const layers = desc.numberLayer ?? 1;
    return `${desc.format}|${w}x${h}|s${sample}|l${layers}|m${mip}|u${usage}`;
}

/**
 * Rough size estimate for HWM accounting. Treats every format as 4 bpp
 * unless we know better — the actual GPU footprint depends on driver
 * tiling and isn't observable from WebGPU.
 *
 * @internal
 */
export function estimateTextureBytes(desc: TextureDesc, w: number, h: number): number {
    const bpp = bytesPerPixel(desc.format);
    const layers = desc.numberLayer ?? 1;
    const samples = Math.max(1, desc.sampleCount ?? 0);
    const mips = desc.mipLevelCount ?? 1;
    let total = 0;
    let mw = w, mh = h;
    for (let m = 0; m < mips; m++) {
        total += mw * mh * bpp * layers * samples;
        mw = Math.max(1, mw >> 1);
        mh = Math.max(1, mh >> 1);
    }
    return total;
}

function bytesPerPixel(format: GPUTextureFormat): number {
    // Coarse classification — exact byte counts for the WebGPU formats
    // the engine actually uses for transient resources. Unknown formats
    // fall back to 4 bpp.
    switch (format) {
        case 'r8unorm': case 'r8snorm': case 'r8uint': case 'r8sint':
            return 1;
        case 'r16uint': case 'r16sint': case 'r16float':
        case 'rg8unorm': case 'rg8snorm': case 'rg8uint': case 'rg8sint':
            return 2;
        case 'r32uint': case 'r32sint': case 'r32float':
        case 'rg16uint': case 'rg16sint': case 'rg16float':
        case 'rgba8unorm': case 'rgba8unorm-srgb': case 'rgba8snorm':
        case 'rgba8uint': case 'rgba8sint':
        case 'bgra8unorm': case 'bgra8unorm-srgb':
        case 'rgb10a2unorm': case 'rg11b10ufloat':
        case 'depth24plus': case 'depth32float':
            return 4;
        case 'rg32uint': case 'rg32sint': case 'rg32float':
        case 'rgba16uint': case 'rgba16sint': case 'rgba16float':
        case 'depth32float-stencil8':
            return 8;
        case 'rgba32uint': case 'rgba32sint': case 'rgba32float':
            return 16;
        default:
            return 4;
    }
}
