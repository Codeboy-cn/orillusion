/**
 * CPU-side BVH builder for the software-ray-traced DDGI path.
 *
 * Input is a world-space triangle soup (positions are pre-transformed on
 * collection, so the traversal kernel needs no instance transforms — a
 * single-level BVH keeps the WGSL walk simple and fits the mostly-static
 * scenes the probe volume targets).
 *
 * Output is a flat pre-order node array with skip links ("miss links"),
 * so the GPU traversal is stackless: on AABB hit advance to node+1 (the
 * first child is always the next node in pre-order), on miss jump to the
 * skip link; a leaf always continues at its skip link. The walk ends when
 * the next index reaches nodeCount.
 *
 * Node stride is 12 floats, every payload value stored as an exact small
 * integer in f32 (no bit-casts — uint payloads bit-cast through float
 * buffers can be flushed/canonicalized by some drivers):
 *   [0..2] bounds min   [3] skip link (node index)
 *   [4..6] bounds max   [7] triangle offset (leaf) / -1 (interior)
 *   [8]    triangle count (leaf) / 0 (interior)
 *   [9..11] reserved
 */

export const BVH_NODE_STRIDE = 12;

/** Max triangles per leaf. Small leaves keep the Möller–Trumbore loop short. */
const LEAF_TRI_COUNT = 4;
/** Number of SAH bins per axis. */
const SAH_BINS = 16;

export type BVHBuildResult = {
    /** Flat pre-order node array, BVH_NODE_STRIDE floats per node. */
    nodes: Float32Array;
    nodeCount: number;
    /** Triangle order after partitioning: index into the ORIGINAL triangle list. */
    triOrder: Uint32Array;
};

export class BVHBuilder {
    /**
     * Build from a world-space triangle soup.
     * @param positions 9 floats per triangle (v0.xyz, v1.xyz, v2.xyz)
     * @param triCount  triangle count
     */
    public static build(positions: Float32Array, triCount: number): BVHBuildResult {
        const centroids = new Float32Array(triCount * 3);
        const triMin = new Float32Array(triCount * 3);
        const triMax = new Float32Array(triCount * 3);
        for (let t = 0; t < triCount; t++) {
            const o = t * 9;
            for (let a = 0; a < 3; a++) {
                const v0 = positions[o + a], v1 = positions[o + 3 + a], v2 = positions[o + 6 + a];
                const mn = Math.min(v0, v1, v2);
                const mx = Math.max(v0, v1, v2);
                triMin[t * 3 + a] = mn;
                triMax[t * 3 + a] = mx;
                centroids[t * 3 + a] = (mn + mx) * 0.5;
            }
        }

        const triOrder = new Uint32Array(triCount);
        for (let i = 0; i < triCount; i++) triOrder[i] = i;

        // Worst case is 2N-1 nodes for a fully split tree.
        const maxNodes = Math.max(1, 2 * triCount - 1) + 1;
        const nodes = new Float32Array(maxNodes * BVH_NODE_STRIDE);
        const builder = new BVHBuilder(positions, centroids, triMin, triMax, triOrder, nodes);
        builder.buildRecursive(0, triCount);
        // Skip links are patched in a second pass over the recorded ranges.
        builder.assignSkipLinks(0, builder._nodeCount);
        return { nodes: nodes.subarray(0, builder._nodeCount * BVH_NODE_STRIDE), nodeCount: builder._nodeCount, triOrder };
    }

    private _positions: Float32Array;
    private _centroids: Float32Array;
    private _triMin: Float32Array;
    private _triMax: Float32Array;
    private _order: Uint32Array;
    private _nodes: Float32Array;
    private _nodeCount = 0;
    /** Per-node subtree size (node count including self), used to derive skip links. */
    private _subtreeSize: number[] = [];

    private constructor(positions: Float32Array, centroids: Float32Array, triMin: Float32Array, triMax: Float32Array, order: Uint32Array, nodes: Float32Array) {
        this._positions = positions;
        this._centroids = centroids;
        this._triMin = triMin;
        this._triMax = triMax;
        this._order = order;
        this._nodes = nodes;
    }

    /** Build the subtree for triangles [start, end), returns its node count. */
    private buildRecursive(start: number, end: number): number {
        const nodeIndex = this._nodeCount++;
        const o = nodeIndex * BVH_NODE_STRIDE;
        const nodes = this._nodes;

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let i = start; i < end; i++) {
            const t = this._order[i] * 3;
            minX = Math.min(minX, this._triMin[t]); maxX = Math.max(maxX, this._triMax[t]);
            minY = Math.min(minY, this._triMin[t + 1]); maxY = Math.max(maxY, this._triMax[t + 1]);
            minZ = Math.min(minZ, this._triMin[t + 2]); maxZ = Math.max(maxZ, this._triMax[t + 2]);
        }
        nodes[o] = minX; nodes[o + 1] = minY; nodes[o + 2] = minZ;
        nodes[o + 4] = maxX; nodes[o + 5] = maxY; nodes[o + 6] = maxZ;

        const count = end - start;
        if (count <= LEAF_TRI_COUNT) {
            nodes[o + 7] = start;
            nodes[o + 8] = count;
            this._subtreeSize[nodeIndex] = 1;
            return 1;
        }

        const mid = this.partition(start, end);
        nodes[o + 7] = -1;
        nodes[o + 8] = 0;
        const leftSize = this.buildRecursive(start, mid);
        const rightSize = this.buildRecursive(mid, end);
        const size = 1 + leftSize + rightSize;
        this._subtreeSize[nodeIndex] = size;
        return size;
    }

    /** Binned-SAH split; falls back to a median split when SAH degenerates. */
    private partition(start: number, end: number): number {
        const c = this._centroids;
        let cminX = Infinity, cminY = Infinity, cminZ = Infinity;
        let cmaxX = -Infinity, cmaxY = -Infinity, cmaxZ = -Infinity;
        for (let i = start; i < end; i++) {
            const t = this._order[i] * 3;
            cminX = Math.min(cminX, c[t]); cmaxX = Math.max(cmaxX, c[t]);
            cminY = Math.min(cminY, c[t + 1]); cmaxY = Math.max(cmaxY, c[t + 1]);
            cminZ = Math.min(cminZ, c[t + 2]); cmaxZ = Math.max(cmaxZ, c[t + 2]);
        }
        const extX = cmaxX - cminX, extY = cmaxY - cminY, extZ = cmaxZ - cminZ;
        let axis = 0, cmin = cminX, ext = extX;
        if (extY > ext) { axis = 1; cmin = cminY; ext = extY; }
        if (extZ > ext) { axis = 2; cmin = cminZ; ext = extZ; }

        if (ext < 1e-12) {
            // All centroids coincide: split by count.
            return (start + end) >> 1;
        }

        // Bin triangles along the chosen axis.
        const binCount = new Int32Array(SAH_BINS);
        const binMin = new Float32Array(SAH_BINS * 3).fill(Infinity);
        const binMax = new Float32Array(SAH_BINS * 3).fill(-Infinity);
        const scale = SAH_BINS / ext;
        for (let i = start; i < end; i++) {
            const tri = this._order[i];
            let b = Math.floor((c[tri * 3 + axis] - cmin) * scale);
            if (b >= SAH_BINS) b = SAH_BINS - 1;
            if (b < 0) b = 0;
            binCount[b]++;
            for (let a = 0; a < 3; a++) {
                binMin[b * 3 + a] = Math.min(binMin[b * 3 + a], this._triMin[tri * 3 + a]);
                binMax[b * 3 + a] = Math.max(binMax[b * 3 + a], this._triMax[tri * 3 + a]);
            }
        }

        // Sweep to find the cheapest split plane.
        const leftArea = new Float32Array(SAH_BINS);
        const leftCount = new Int32Array(SAH_BINS);
        let accMinX = Infinity, accMinY = Infinity, accMinZ = Infinity;
        let accMaxX = -Infinity, accMaxY = -Infinity, accMaxZ = -Infinity;
        let accN = 0;
        for (let b = 0; b < SAH_BINS - 1; b++) {
            accN += binCount[b];
            accMinX = Math.min(accMinX, binMin[b * 3]); accMaxX = Math.max(accMaxX, binMax[b * 3]);
            accMinY = Math.min(accMinY, binMin[b * 3 + 1]); accMaxY = Math.max(accMaxY, binMax[b * 3 + 1]);
            accMinZ = Math.min(accMinZ, binMin[b * 3 + 2]); accMaxZ = Math.max(accMaxZ, binMax[b * 3 + 2]);
            leftCount[b] = accN;
            leftArea[b] = accN > 0 ? surfaceArea(accMinX, accMinY, accMinZ, accMaxX, accMaxY, accMaxZ) : 0;
        }
        accMinX = Infinity; accMinY = Infinity; accMinZ = Infinity;
        accMaxX = -Infinity; accMaxY = -Infinity; accMaxZ = -Infinity;
        accN = 0;
        let bestCost = Infinity, bestBin = -1;
        for (let b = SAH_BINS - 1; b >= 1; b--) {
            accN += binCount[b];
            accMinX = Math.min(accMinX, binMin[b * 3]); accMaxX = Math.max(accMaxX, binMax[b * 3]);
            accMinY = Math.min(accMinY, binMin[b * 3 + 1]); accMaxY = Math.max(accMaxY, binMax[b * 3 + 1]);
            accMinZ = Math.min(accMinZ, binMin[b * 3 + 2]); accMaxZ = Math.max(accMaxZ, binMax[b * 3 + 2]);
            const rightArea = surfaceArea(accMinX, accMinY, accMinZ, accMaxX, accMaxY, accMaxZ);
            const nl = leftCount[b - 1], nr = accN;
            if (nl === 0 || nr === 0) continue;
            const cost = leftArea[b - 1] * nl + rightArea * nr;
            if (cost < bestCost) { bestCost = cost; bestBin = b; }
        }

        if (bestBin < 0) return (start + end) >> 1;

        // In-place partition by bin index.
        let i = start, j = end - 1;
        while (i <= j) {
            const tri = this._order[i];
            let b = Math.floor((c[tri * 3 + axis] - cmin) * scale);
            if (b >= SAH_BINS) b = SAH_BINS - 1;
            if (b < 0) b = 0;
            if (b < bestBin) {
                i++;
            } else {
                const tmp = this._order[i];
                this._order[i] = this._order[j];
                this._order[j] = tmp;
                j--;
            }
        }
        // Guard against degenerate partitions from float edge cases.
        if (i <= start || i >= end) return (start + end) >> 1;
        return i;
    }

    /** Pre-order skip links: node's skip target = index right after its subtree. */
    private assignSkipLinks(nodeIndex: number, endIndex: number): void {
        let index = nodeIndex;
        this.assignSubtree(index, endIndex);
    }

    private assignSubtree(nodeIndex: number, skipTo: number): void {
        const o = nodeIndex * BVH_NODE_STRIDE;
        this._nodes[o + 3] = skipTo;
        if (this._nodes[o + 7] >= 0) return; // leaf
        const left = nodeIndex + 1;
        const leftSize = this._subtreeSize[left];
        const right = left + leftSize;
        this.assignSubtree(left, right);
        this.assignSubtree(right, skipTo);
    }
}

function surfaceArea(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): number {
    const dx = Math.max(0, maxX - minX);
    const dy = Math.max(0, maxY - minY);
    const dz = Math.max(0, maxZ - minZ);
    return dx * dy + dy * dz + dz * dx;
}
