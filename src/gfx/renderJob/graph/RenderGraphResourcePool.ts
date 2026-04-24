import { Context3D } from '../../graphics/webGpu/Context3D';
import { RenderTexture } from '../../../textures/RenderTexture';
import { RTResourceMap } from '../frame/RTResourceMap';
import { ResourceHandle } from './ResourceHandle';

/**
 * Lazy allocator that resolves Frame Graph {@link ResourceHandle}
 * instances to physical GPU objects, backed by the existing
 * {@link RTResourceMap} for textures. Each Context3D owns one pool —
 * constructing a second one for the same context reuses the same
 * underlying `RTResourceMap.forContext(ctx)` registry, so textures
 * created via the pool remain reachable from legacy code during the
 * migration window.
 *
 * Lifetime model:
 * - **Persistent**: default. Resource stays allocated across frames,
 *   reused by name on next resolve. Matches today's RTResourceMap
 *   behavior. Suitable for color buffers, shadow maps, DDGI probes —
 *   anything whose size rarely changes.
 * - **Transient**: opt-in via `resolveTexture(handle, {transient: true})`.
 *   Eligible for LRU eviction between frames when the pool trims.
 *   Phase E will auto-infer transient-vs-persistent from lifetime
 *   analysis; for now features mark it explicitly.
 *
 * External handles (`desc.kind === 'external'`) must be registered
 * with `registerExternal(name, getter)` before any feature reads
 * them; the pool never allocates for these.
 *
 * @group Graph
 */
export class RenderGraphResourcePool {
    private readonly _ctx: Context3D;
    private readonly _rt: RTResourceMap;
    private readonly _buffers: Map<string, GPUBuffer> = new Map();
    private readonly _externalGetters: Map<string, () => unknown> = new Map();
    /** Insertion order = LRU: most recent resolve moves to the tail. */
    private readonly _transientOrder: string[] = [];

    constructor(ctx: Context3D) {
        this._ctx = ctx;
        this._rt = RTResourceMap.forContext(ctx);
    }

    public get context(): Context3D {
        return this._ctx;
    }

    /**
     * Resolve a texture handle to its concrete RenderTexture. Allocates
     * on first call, returns the cached instance on subsequent calls.
     * Re-creates the resource if the handle's size/format no longer
     * matches the cached one — the old RenderTexture is dropped and
     * WebGPU's resource-tracker collects it on its own cadence.
     */
    public resolveTexture(handle: ResourceHandle, opts: { transient?: boolean } = {}): RenderTexture {
        if (handle.desc.kind !== 'texture') {
            throw new Error(`ResourcePool.resolveTexture: handle '${handle.name}' is not a texture (kind=${handle.desc.kind})`);
        }
        const desc = handle.desc;
        const existing = this._rt.rtTextureMap.get(handle.name);
        if (existing && this._matches(existing, desc)) {
            if (opts.transient) this._touchTransient(handle.name);
            return existing;
        }

        let rt: RenderTexture;
        if ((desc.arrayLayers ?? 1) > 1) {
            rt = RTResourceMap.createRTTextureArray(
                this._ctx,
                handle.name,
                desc.width,
                desc.height,
                desc.format,
                desc.arrayLayers!,
                (desc.mipLevels ?? 1) > 1,
                desc.sampleCount ?? 0,
            );
        } else {
            rt = RTResourceMap.createRTTexture(
                this._ctx,
                handle.name,
                desc.width,
                desc.height,
                desc.format,
                (desc.mipLevels ?? 1) > 1,
                desc.sampleCount ?? 0,
            );
        }
        if (opts.transient) this._touchTransient(handle.name);
        return rt;
    }

    /** Resolve a buffer handle. Buffers are cached by name; changing
     *  size/usage invalidates the cache and a new GPUBuffer is created. */
    public resolveBuffer(handle: ResourceHandle): GPUBuffer {
        if (handle.desc.kind !== 'buffer') {
            throw new Error(`ResourcePool.resolveBuffer: handle '${handle.name}' is not a buffer (kind=${handle.desc.kind})`);
        }
        const desc = handle.desc;
        const existing = this._buffers.get(handle.name);
        if (existing && existing.size === desc.size && existing.usage === desc.usage) {
            return existing;
        }
        if (existing) existing.destroy();
        const buf = this._ctx.device.createBuffer({
            size: desc.size,
            usage: desc.usage,
            label: handle.name,
        });
        this._buffers.set(handle.name, buf);
        return buf;
    }

    /** Register a getter for a resource whose lifetime the pool does
     *  not own (e.g. canvas swapchain view, user-provided GPUTexture). */
    public registerExternal<T>(name: string, getter: () => T): void {
        this._externalGetters.set(name, getter as () => unknown);
    }

    /** Resolve a named resource, dispatching on handle kind. Falls
     *  back to the RTResourceMap lookup + external getter so legacy
     *  code paths that wrote into RTResourceMap remain observable. */
    public get<T>(name: string): T {
        const external = this._externalGetters.get(name);
        if (external) return external() as T;
        const tex = this._rt.rtTextureMap.get(name);
        if (tex) return tex as unknown as T;
        const buf = this._buffers.get(name);
        if (buf) return buf as unknown as T;
        throw new Error(`ResourcePool.get('${name}') — resource not allocated or registered. ` +
            `Has a feature declared writes:['${name}'] or was registerExternal('${name}', ...) called?`);
    }

    public has(name: string): boolean {
        return this._externalGetters.has(name) || this._rt.rtTextureMap.has(name) || this._buffers.has(name);
    }

    /** Drop everything the pool owns. Called from `graph.destroy()` and
     *  on `Context3D.DEVICE_LOST`. RenderTextures are owned by
     *  RTResourceMap and are released by its own lifecycle. */
    public dispose(): void {
        for (const [, buf] of this._buffers) buf.destroy();
        this._buffers.clear();
        this._externalGetters.clear();
        this._transientOrder.length = 0;
    }

    /** Trim transient resources when the pool grows past `limit`.
     *  Called optionally by the graph between frames. No-op for
     *  persistent resources. */
    public trimTransient(limit: number): void {
        while (this._transientOrder.length > limit) {
            const victim = this._transientOrder.shift()!;
            const rt = this._rt.rtTextureMap.get(victim);
            if (rt) {
                this._rt.rtTextureMap.delete(victim);
                // RenderTexture owns a GPUTexture; destroying it
                // releases the device allocation. We do not touch
                // the GPUTexture directly here because RenderTexture
                // may have derived views / samplers that need its
                // own destroy path.
                (rt as unknown as { destroy?: () => void }).destroy?.();
            }
        }
    }

    private _touchTransient(name: string): void {
        const idx = this._transientOrder.indexOf(name);
        if (idx >= 0) this._transientOrder.splice(idx, 1);
        this._transientOrder.push(name);
    }

    private _matches(rt: RenderTexture, desc: { width: number; height: number; format: GPUTextureFormat }): boolean {
        return rt.width === desc.width && rt.height === desc.height && rt.format === desc.format;
    }
}
