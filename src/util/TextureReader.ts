import { Context3D } from '../gfx/graphics/webGpu/Context3D';
import { Texture } from '../gfx/graphics/webGpu/core/texture/Texture';

/** Row pitch required by `copyTextureToBuffer` / `copyBufferToTexture`. */
const BYTES_PER_ROW_ALIGNMENT = 256;

/** How the raw bytes of a texture format should be viewed on the CPU. */
type FormatLayout = {
    /** Bytes occupied by one texel. */
    bytesPerPixel: number;
    /** Typed-array view to wrap the unpadded bytes in. */
    view: 'u8' | 'u16' | 'f32';
};

/**
 * Byte layout of the formats the engine can hand back to JS. Compressed and
 * depth/stencil formats are intentionally absent — `copyTextureToBuffer`
 * either rejects them or needs an aspect selector, so they are rejected with
 * a clear message rather than silently mis-decoded.
 */
const FORMAT_LAYOUTS: { [format: string]: FormatLayout } = {
    'r8unorm': { bytesPerPixel: 1, view: 'u8' },
    'r8uint': { bytesPerPixel: 1, view: 'u8' },
    'rg8unorm': { bytesPerPixel: 2, view: 'u8' },
    'rgba8unorm': { bytesPerPixel: 4, view: 'u8' },
    'rgba8unorm-srgb': { bytesPerPixel: 4, view: 'u8' },
    'bgra8unorm': { bytesPerPixel: 4, view: 'u8' },
    'bgra8unorm-srgb': { bytesPerPixel: 4, view: 'u8' },
    'r16float': { bytesPerPixel: 2, view: 'u16' },
    'rg16float': { bytesPerPixel: 4, view: 'u16' },
    'rgba16float': { bytesPerPixel: 8, view: 'u16' },
    'r32float': { bytesPerPixel: 4, view: 'f32' },
    'rg32float': { bytesPerPixel: 8, view: 'f32' },
    'rgba32float': { bytesPerPixel: 16, view: 'f32' },
    'depth32float': { bytesPerPixel: 4, view: 'f32' },
};

/** A rectangular region of a texture; defaults to the whole texture. */
export type ReadPixelsRegion = {
    /** Left edge in texels. Default 0. */
    x?: number;
    /** Top edge in texels. Default 0. */
    y?: number;
    /** Width in texels. Defaults to the rest of the texture. */
    width?: number;
    /** Height in texels. Defaults to the rest of the texture. */
    height?: number;
    /** Array layer / cube face to read. Default 0. */
    layer?: number;
    /** Mip level to read. Default 0. */
    mipLevel?: number;
};

/** Result of {@link readTexturePixels}: tightly packed rows, no row padding. */
export type ReadPixelsResult = {
    /**
     * The texel data, row-major from the top-left of the requested region,
     * with no padding between rows. `Uint16Array` for `*16float` formats
     * holds raw half-float bits — use {@link halfToFloat} to decode.
     */
    data: Uint8Array | Uint16Array | Float32Array;
    /** Width of the returned region in texels. */
    width: number;
    /** Height of the returned region in texels. */
    height: number;
    /** The source texture's format. */
    format: GPUTextureFormat;
};

/**
 * Decode an IEEE-754 half-float (as stored in a `Uint16Array` from a
 * `*16float` readback) into a JS number.
 *
 * @param bits the raw 16 bits of the half-float.
 * @returns the decoded value.
 */
export function halfToFloat(bits: number): number {
    const sign = (bits & 0x8000) ? -1 : 1;
    const exponent = (bits & 0x7c00) >> 10;
    const fraction = bits & 0x03ff;
    if (exponent === 0) return sign * Math.pow(2, -14) * (fraction / 1024);
    if (exponent === 0x1f) return fraction ? NaN : sign * Infinity;
    return sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
}

/**
 * Copy a region of a GPU texture back into CPU memory.
 *
 * The texture must have been created with `GPUTextureUsage.COPY_SRC`. Render
 * targets allocated by the engine (`RenderTexture`, `VirtualTexture`) already
 * are; a plain `BitmapTexture2D` uploaded from an image is not, and is
 * reported as such instead of failing inside WebGPU.
 *
 * @param texture the texture to read from.
 * @param region optional sub-rectangle / layer / mip to read. Defaults to the
 *        whole level-0 layer-0 image.
 * @param ctx the Context3D owning the texture; defaults to the texture's own
 *        bound context.
 * @returns a promise resolving to the unpadded texel data plus its extent.
 */
export async function readTexturePixels(texture: Texture, region?: ReadPixelsRegion, ctx?: Context3D): Promise<ReadPixelsResult> {
    const context = ctx ?? (texture as any)._boundCtx as Context3D;
    if (!context || !context.device) {
        throw new Error(`readTexturePixels: texture "${texture.name ?? '<unnamed>'}" is not bound to a Context3D yet — render it once, or pass the context explicitly.`);
    }

    const gpuTexture = texture.getGPUTexture();
    if (!gpuTexture) {
        throw new Error(`readTexturePixels: texture "${texture.name ?? '<unnamed>'}" has no GPU texture yet.`);
    }
    if ((gpuTexture.usage & GPUTextureUsage.COPY_SRC) === 0) {
        throw new Error(`readTexturePixels: texture "${texture.name ?? '<unnamed>'}" was created without GPUTextureUsage.COPY_SRC, so the GPU cannot copy out of it. Add COPY_SRC to its usage flags.`);
    }

    const format = texture.format as GPUTextureFormat;
    const layout = FORMAT_LAYOUTS[format as string];
    if (!layout) {
        throw new Error(`readTexturePixels: format '${format}' is not supported for readback. Supported: ${Object.keys(FORMAT_LAYOUTS).join(', ')}.`);
    }

    const mipLevel = region?.mipLevel ?? 0;
    const mipScale = 1 << mipLevel;
    const levelWidth = Math.max(1, Math.floor(texture.width / mipScale));
    const levelHeight = Math.max(1, Math.floor(texture.height / mipScale));

    const x = Math.max(0, region?.x ?? 0);
    const y = Math.max(0, region?.y ?? 0);
    const width = Math.min(region?.width ?? (levelWidth - x), levelWidth - x);
    const height = Math.min(region?.height ?? (levelHeight - y), levelHeight - y);
    if (width <= 0 || height <= 0) {
        throw new Error(`readTexturePixels: empty region (x=${x} y=${y} w=${width} h=${height}) for a ${levelWidth}x${levelHeight} mip ${mipLevel}.`);
    }

    // copyTextureToBuffer requires bytesPerRow to be a multiple of 256, so the
    // staging buffer is over-allocated and the padding is stripped below. The
    // original implementation passed no bytesPerRow at all and sized the
    // buffer from the unpadded pitch, which is why it never worked.
    const unpaddedBytesPerRow = width * layout.bytesPerPixel;
    const paddedBytesPerRow = Math.ceil(unpaddedBytesPerRow / BYTES_PER_ROW_ALIGNMENT) * BYTES_PER_ROW_ALIGNMENT;

    const device = context.device;
    const stagingBuffer = device.createBuffer({
        label: `readTexturePixels(${texture.name ?? format})`,
        size: paddedBytesPerRow * height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    try {
        const encoder = device.createCommandEncoder({ label: 'readTexturePixels' });
        encoder.copyTextureToBuffer(
            {
                texture: gpuTexture,
                mipLevel,
                origin: { x, y, z: region?.layer ?? 0 },
            },
            {
                buffer: stagingBuffer,
                bytesPerRow: paddedBytesPerRow,
                rowsPerImage: height,
            },
            { width, height, depthOrArrayLayers: 1 }
        );
        device.queue.submit([encoder.finish()]);

        await stagingBuffer.mapAsync(GPUMapMode.READ);
        const padded = new Uint8Array(stagingBuffer.getMappedRange());

        // Strip the per-row padding into a tightly packed copy. The mapped
        // range is invalidated by unmap(), so this must be a copy, not a view.
        const tight = new Uint8Array(unpaddedBytesPerRow * height);
        for (let row = 0; row < height; row++) {
            tight.set(
                padded.subarray(row * paddedBytesPerRow, row * paddedBytesPerRow + unpaddedBytesPerRow),
                row * unpaddedBytesPerRow
            );
        }
        stagingBuffer.unmap();

        const data = layout.view === 'u8' ? tight
            : layout.view === 'u16' ? new Uint16Array(tight.buffer)
                : new Float32Array(tight.buffer);

        return { data, width, height, format };
    } finally {
        stagingBuffer.destroy();
    }
}
