import { RenderTexture } from '../../../textures/RenderTexture';

/**
 * Logical resource kind carried by a {@link ResourceHandle}. Texture and
 * buffer are resolved through different pool lookup paths; `external`
 * flags a resource produced by foreign code (GUI canvas, OS swapchain
 * view, user-supplied GPUTexture) whose lifetime the pool does not own.
 *
 * @group Graph
 */
export type ResourceKind = 'texture' | 'buffer' | 'external';

/**
 * Descriptor variants a handle can carry. Texture descriptors are a
 * superset of `GPUTextureDescriptor` — we add `arrayLayers` / `mipLevels`
 * explicitly so Frame Graph callers do not have to reconstruct the
 * WebGPU value shape from RTResourceMap's overloaded arg list.
 *
 * The `external` case carries no descriptor — the resource is resolved
 * through a caller-registered getter.
 *
 * @group Graph
 */
export type ResourceDesc =
    | ({ kind: 'texture' } & TextureResourceDesc)
    | ({ kind: 'buffer' } & BufferResourceDesc)
    | { kind: 'external' };

export interface TextureResourceDesc {
    width: number;
    height: number;
    format: GPUTextureFormat;
    arrayLayers?: number;
    mipLevels?: number;
    sampleCount?: number;
    usage?: GPUTextureUsageFlags;
}

export interface BufferResourceDesc {
    size: number;
    usage: GPUBufferUsageFlags;
}

/**
 * Logical identifier for a Frame Graph resource. Handles are cheap
 * value objects — they carry the **name** and **shape** of a resource
 * but never the GPU object itself. The concrete `RenderTexture` /
 * `GPUBuffer` is produced at execute time by {@link RenderGraphResourcePool}
 * via `pool.resolveTexture(handle)` / `pool.resolveBuffer(handle)`.
 *
 * Two handles with the same `name` refer to the same physical resource
 * across the whole graph — this is how features declare ingoing
 * dependencies (reads) against outgoing productions (writes).
 *
 * Handles do not own device resources and can be safely shared across
 * features; constructing one is free.
 *
 * @group Graph
 */
export class ResourceHandle<_T = RenderTexture | GPUBuffer> {
    /** Registry key. Matches the string used in `feature.reads` / `writes`. */
    public readonly name: string;

    /** Texture vs buffer vs caller-managed external resource. */
    public readonly kind: ResourceKind;

    /** Shape used by the pool when lazily allocating the resource. */
    public readonly desc: ResourceDesc;

    /** Optional free-form tag for visualization (e.g. a feature name). */
    public readonly producer?: string;

    constructor(name: string, desc: ResourceDesc, producer?: string) {
        this.name = name;
        this.kind = desc.kind;
        this.desc = desc;
        this.producer = producer;
    }

    /**
     * Shorthand for a texture handle. Defaults mirror RTResourceMap
     * behavior (1 layer, no mipmaps, no MSAA) so simple features can
     * omit optional fields.
     */
    public static texture(
        name: string,
        width: number,
        height: number,
        format: GPUTextureFormat,
        opts: Partial<TextureResourceDesc> = {},
        producer?: string,
    ): ResourceHandle<RenderTexture> {
        return new ResourceHandle(name, {
            kind: 'texture',
            width,
            height,
            format,
            arrayLayers: opts.arrayLayers ?? 1,
            mipLevels: opts.mipLevels ?? 1,
            sampleCount: opts.sampleCount ?? 0,
            usage: opts.usage,
        }, producer);
    }

    /** Shorthand for a buffer handle. */
    public static buffer(
        name: string,
        size: number,
        usage: GPUBufferUsageFlags,
        producer?: string,
    ): ResourceHandle<GPUBuffer> {
        return new ResourceHandle(name, { kind: 'buffer', size, usage }, producer);
    }

    /** Shorthand for a resource whose lifetime the pool does not own. */
    public static external<T>(name: string, producer?: string): ResourceHandle<T> {
        return new ResourceHandle<T>(name, { kind: 'external' }, producer);
    }
}
