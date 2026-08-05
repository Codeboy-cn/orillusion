/**
 * Pure index-array helpers for the glTF pipeline. Deliberately free of
 * engine imports so they can be unit-tested in isolation.
 * @internal
 */

/**
 * Build sequential triangle indices for a non-indexed primitive,
 * preserving the engine's per-triangle (2, 0, 1) winding. The element
 * type is chosen by the largest index that will be written: a primitive
 * with more than 65536 vertices needs 32-bit indices (the old code used
 * Uint8Array — every index above 255 wrapped modulo 256 and the
 * geometry collapsed).
 */
export function makeSequentialTriIndices(vertexCount: number): Uint16Array | Uint32Array {
    const triCount = Math.floor(vertexCount / 3);
    const out = vertexCount - 1 > 65535 ? new Uint32Array(triCount * 3) : new Uint16Array(triCount * 3);
    for (let i = 0; i < triCount; i++) {
        const a = i * 3;
        out[a + 0] = a + 2;
        out[a + 1] = a + 0;
        out[a + 2] = a + 1;
    }
    return out;
}

/**
 * Normalize an arbitrary numeric index container to the two element
 * types the renderer supports. Uint16Array/Uint32Array inputs are
 * returned BY REFERENCE (no pointless copy); anything else is widened
 * based on the MAXIMUM INDEX VALUE — not the element count: a short
 * index list that references vertex 70000 still needs 32 bits.
 */
export function normalizeIndexArray(data: ArrayLike<number>): Uint16Array | Uint32Array {
    if (data instanceof Uint16Array || data instanceof Uint32Array) {
        return data;
    }
    let max = 0;
    for (let i = 0; i < data.length; i++) {
        if (data[i] > max) max = data[i];
    }
    return max > 65535 ? new Uint32Array(data as ArrayLike<number>) : new Uint16Array(data as ArrayLike<number>);
}
