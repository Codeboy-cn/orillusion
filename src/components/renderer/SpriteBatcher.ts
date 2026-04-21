import { BoundingBox } from '../../core/bound/BoundingBox';
import { View3D } from '../../core/View3D';
import { GeometryBase } from '../../core/geometry/GeometryBase';
import { VertexAttributeName } from '../../core/geometry/VertexAttributeName';
import { Context3D } from '../../gfx/graphics/webGpu/Context3D';
import { Texture } from '../../gfx/graphics/webGpu/core/texture/Texture';
import { PassType } from '../../gfx/renderJob/passRenderer/state/PassType';
import { Color } from '../../math/Color';
import { Vector2 } from '../../math/Vector2';
import { Vector3 } from '../../math/Vector3';
import { Vector4 } from '../../math/Vector4';
import { UnLitMaterial } from '../../materials/UnLitMaterial';
import { GetCountInstanceID } from '../../util/Global';
import { RegisterComponent } from '../../util/SerializeDecoration';
import { RenderNode } from './RenderNode';

/** Single entry inside a `SpriteBatcher`. Treat as opaque — mutate only via `batcher.update(entry, ...)`. */
export class SpriteBatchEntry {
    public readonly id: number;
    public position: Vector2 = new Vector2(0, 0);
    public size: Vector2 = new Vector2(32, 32);
    public pivot: Vector2 = new Vector2(0.5, 0.5);
    public uvRect: Vector4 = new Vector4(0, 0, 1, 1);

    constructor(id: number) {
        this.id = id;
    }
}

/**
 * Static vertex-baked sprite batcher — renders N sprite quads in a single
 * draw call. Covers the UIImageGroup / UIPerformance2 use case: many
 * uniform-style sprites sharing one texture and global color.
 *
 * **Tradeoffs vs. per-Sprite `Sprite` component:**
 * - Only position/size/pivot/uvRect are per-entry; color/fillRatio/cornerRadius
 *   are global to the whole batch. Split batches by those if you need variety.
 * - No `Interactive` hit test per entry — the batcher is one Object3D; build
 *   your own hit resolution against `SpriteBatchEntry.position + size` if needed.
 * - Geometry is rebuilt on dirty; suitable for static or low-frequency change
 *   (hundreds of Hz is fine; per-frame update of 10k entries will stall).
 *
 * Coordinate space: (position.x, position.y) in local space of the batcher's
 * Object3D. Attach the batcher to an overlay camera for screen-space.
 *
 * @group Components
 */
@RegisterComponent(SpriteBatcher, 'SpriteBatcher')
export class SpriteBatcher extends RenderNode {
    private _entries: SpriteBatchEntry[] = [];
    private _dirty: boolean = true;
    private _nextId: number = 0;
    private _pendingTexture: Texture | null = null;
    private _pendingColor: Color | null = null;
    /** Owned UnLitMaterial. Color applies to every sprite in the batch. */
    private _batcherMaterial: UnLitMaterial | null = null;
    /** Owned geometry (recreated as the entry count grows). */
    private _batcherGeometry: GeometryBase | null = null;
    private _capacity: number = 0;

    public init(param?: any): void {
        super.init(param);
        this.renderOrder = 3000;
    }

    public onEnable(): void {
        if (!this._batcherMaterial) this._ensureResources();
        this._rebuildIfDirty();
        super.onEnable();
    }

    public onUpdate(_view?: View3D): void {
        if (this._dirty) this._rebuildIfDirty();
    }

    private _ensureResources() {
        const ctx = this.transform?.view3D?.engine3D?.context3D;
        if (!ctx) return;
        if (!this._batcherMaterial) {
            this._batcherMaterial = new UnLitMaterial(ctx);
            if (this._pendingTexture) this._batcherMaterial.baseMap = this._pendingTexture;
            if (this._pendingColor) this._batcherMaterial.baseColor = this._pendingColor;
            this.materials = [this._batcherMaterial];
        }
    }

    // ---------- API ----------

    /** Set the single texture shared by every entry in the batch. */
    public set texture(tex: Texture) {
        if (this._batcherMaterial) this._batcherMaterial.baseMap = tex;
        else this._pendingTexture = tex;
    }

    public get texture(): Texture | null {
        return this._batcherMaterial?.baseMap ?? this._pendingTexture;
    }

    /** Global tint applied to every entry in the batch. */
    public set color(c: Color) {
        if (this._batcherMaterial) this._batcherMaterial.baseColor = c;
        else this._pendingColor = c;
    }

    public get color(): Color | null {
        return this._batcherMaterial?.baseColor ?? this._pendingColor;
    }

    public get entries(): readonly SpriteBatchEntry[] {
        return this._entries;
    }

    public add(spec: {
        position?: Vector2;
        size?: Vector2;
        pivot?: Vector2;
        uvRect?: Vector4;
    } = {}): SpriteBatchEntry {
        const e = new SpriteBatchEntry(this._nextId++);
        if (spec.position) e.position = spec.position.clone();
        if (spec.size) e.size = spec.size.clone();
        if (spec.pivot) e.pivot = spec.pivot.clone();
        if (spec.uvRect) e.uvRect = spec.uvRect.clone();
        this._entries.push(e);
        this._dirty = true;
        return e;
    }

    public remove(entry: SpriteBatchEntry): boolean {
        const i = this._entries.indexOf(entry);
        if (i < 0) return false;
        this._entries.splice(i, 1);
        this._dirty = true;
        return true;
    }

    public update(entry: SpriteBatchEntry, patch: {
        position?: Vector2;
        size?: Vector2;
        pivot?: Vector2;
        uvRect?: Vector4;
    }): void {
        if (patch.position) entry.position.copyFrom(patch.position);
        if (patch.size) entry.size.copyFrom(patch.size);
        if (patch.pivot) entry.pivot.copyFrom(patch.pivot);
        if (patch.uvRect) entry.uvRect.copyFrom(patch.uvRect);
        this._dirty = true;
    }

    public clear() {
        this._entries.length = 0;
        this._dirty = true;
    }

    /** Force a geometry rebuild on the next onUpdate. Call after a bulk mutation. */
    public markDirty() {
        this._dirty = true;
    }

    // ---------- Geometry build ----------

    private _rebuildIfDirty() {
        if (!this._dirty) return;
        const ctx = this.transform?.view3D?.engine3D?.context3D;
        if (!ctx) return;
        this._rebuild(ctx);
        this._dirty = false;
    }

    private _rebuild(_ctx: Context3D) {
        const n = this._entries.length;

        // Grow the backing store in generous steps so typical slider tweaks
        // (count 1000 → 1500 → 2500) keep reusing the same GeometryBase and
        // pipeline rather than swapping them every frame. A geometry swap on
        // a live RenderNode races the next draw: `_readyPipeline` flips but
        // `_passInit` stays true, so `apply()` skips the re-generate, the
        // new geometry's `vertexBufferLayouts` stays empty, and
        // `bindGeometryBuffer` binds zero slots to a cached pipeline that
        // still expects all 4 — WebGPU reports `slot N not set`.
        const growing = !this._batcherGeometry || n > this._capacity;
        if (growing) {
            const newCap = Math.max(n, this._capacity * 2, 1);
            this._allocArrays(newCap);
        }

        // Typed arrays are sized to `_capacity * 4` vertices after
        // `_allocArrays`. Populate them with entry data first — on a growth
        // path `_materializeGeometry` will read these arrays when it calls
        // `generate()`, so the GPU buffer lands fully populated in one shot.
        const positions = this._cpuPositions!;
        const uvs = this._cpuUVs!;
        const indices = this._cpuIndices!;

        for (let i = 0; i < n; i++) {
            const e = this._entries[i];
            // Corner positions in local 2D space (Z = 0). Pivot shifts the
            // quad so (position.x, position.y) is the pivot anchor.
            const left = e.position.x - e.pivot.x * e.size.x;
            const top = e.position.y - e.pivot.y * e.size.y;
            const right = left + e.size.x;
            const bottom = top + e.size.y;

            const vOff = i * 4 * 3;
            // TL, TR, BL, BR — matches PlaneGeometry-like layout.
            positions[vOff + 0] = left;  positions[vOff + 1] = top;    positions[vOff + 2] = 0;
            positions[vOff + 3] = right; positions[vOff + 4] = top;    positions[vOff + 5] = 0;
            positions[vOff + 6] = left;  positions[vOff + 7] = bottom; positions[vOff + 8] = 0;
            positions[vOff + 9] = right; positions[vOff + 10] = bottom;positions[vOff + 11] = 0;

            // uvRect stores (offsetX, offsetY, scaleX, scaleY). Bake per-corner UV.
            const u0 = e.uvRect.x;
            const v0 = e.uvRect.y;
            const u1 = e.uvRect.x + e.uvRect.z;
            const v1 = e.uvRect.y + e.uvRect.w;
            const uvOff = i * 4 * 2;
            uvs[uvOff + 0] = u0; uvs[uvOff + 1] = v0;   // TL
            uvs[uvOff + 2] = u1; uvs[uvOff + 3] = v0;   // TR
            uvs[uvOff + 4] = u0; uvs[uvOff + 5] = v1;   // BL
            uvs[uvOff + 6] = u1; uvs[uvOff + 7] = v1;   // BR

            // Two triangles: (TL, BL, TR), (TR, BL, BR).
            const iOff = i * 6;
            const baseV = i * 4;
            indices[iOff + 0] = baseV + 0;
            indices[iOff + 1] = baseV + 2;
            indices[iOff + 2] = baseV + 1;
            indices[iOff + 3] = baseV + 1;
            indices[iOff + 4] = baseV + 2;
            indices[iOff + 5] = baseV + 3;
        }

        if (growing) {
            // Build the new GeometryBase and eagerly generate its GPU layout
            // using the current shader reflection so its
            // `vertexBufferLayouts` is fully populated before the next draw
            // binds it.
            this._materializeGeometry();
        } else {
            // Same GeometryBase, same pipeline — just rewrite the GPU buffers
            // in place. `GeometryBase.setAttribute` would only mutate the CPU
            // map and silently skip GPU re-upload on subsequent calls, so we
            // go through the vertex / index buffer's `upload` methods
            // directly.
            const geom = this._batcherGeometry!;
            const vb = geom.vertexBuffer;
            vb.upload(VertexAttributeName.position, { attribute: VertexAttributeName.position, data: positions });
            vb.upload(VertexAttributeName.uv,       { attribute: VertexAttributeName.uv,       data: uvs });
            vb.upload(VertexAttributeName.TEXCOORD_1, { attribute: VertexAttributeName.TEXCOORD_1, data: uvs });
            geom.indicesBuffer.upload(indices);
        }

        // Only draw the real entries — the tail of the index buffer is stale
        // from previous rebuilds. Update the LOD descriptor so `drawIndexed`
        // stops at n*6.
        this._batcherGeometry!.subGeometries[0].lodLevels[0].indexCount = Math.max(n * 6, 0);
    }

    private _cpuPositions: Float32Array | null = null;
    private _cpuNormals: Float32Array | null = null;
    private _cpuUVs: Float32Array | null = null;
    private _cpuIndices: Uint16Array | Uint32Array | null = null;

    /** Allocate CPU-side typed arrays for a given capacity. No GPU work. */
    private _allocArrays(capacity: number) {
        const vCount = capacity * 4;
        const positions = new Float32Array(vCount * 3);
        const normals = new Float32Array(vCount * 3);
        const uvs = new Float32Array(vCount * 2);
        const indices = (vCount > 65535 ? new Uint32Array(capacity * 6) : new Uint16Array(capacity * 6)) as Uint16Array | Uint32Array;
        for (let k = 0; k < vCount; k++) normals[k * 3 + 2] = 1;

        this._capacity = capacity;
        this._cpuPositions = positions;
        this._cpuNormals = normals;
        this._cpuUVs = uvs;
        this._cpuIndices = indices;
    }

    /**
     * Materialize the CPU arrays into a fresh `GeometryBase` with a fully
     * populated GPU vertex buffer layout. Must be called AFTER entry data has
     * been written into the CPU arrays so the initial generate() uploads real
     * data and not zero-filled placeholders.
     */
    private _materializeGeometry() {
        const positions = this._cpuPositions!;
        const normals = this._cpuNormals!;
        const uvs = this._cpuUVs!;
        const indices = this._cpuIndices!;

        const geom = new GeometryBase();
        geom.bounds = new BoundingBox(new Vector3(0, 0, 0), new Vector3(1, 1, 0.1));
        geom.setIndices(indices);
        geom.setAttribute(VertexAttributeName.position, positions);
        geom.setAttribute(VertexAttributeName.normal, normals);
        geom.setAttribute(VertexAttributeName.uv, uvs);
        geom.setAttribute(VertexAttributeName.TEXCOORD_1, uvs);
        geom.addSubGeometry({
            indexStart: 0,
            indexCount: indices.length,
            vertexStart: 0,
            vertexCount: 0,
            firstStart: 0,
            index: 0,
            topology: 0,
        });
        geom.instanceID = `spriteBatcher_${GetCountInstanceID()}`;

        // Crucial: call generate() with the material's shader reflection
        // BEFORE assigning to `this.geometry`. Otherwise the new geometry's
        // `vertexBufferLayouts` stays empty until the render path's `apply()`
        // happens to re-run, but `apply()` guards on `_valueChange || !pipeline`
        // and neither flips on a geometry swap — so the first draw after the
        // swap binds zero vertex buffers against a pipeline that still expects
        // 4 slots, triggering `Vertex buffer slot 3 ... was not set`.
        const pass = this._batcherMaterial?.getPass(PassType.COLOR)?.[0];
        if (pass?.shaderReflection) {
            geom.generate(pass.shaderReflection);
        }

        this._batcherGeometry = geom;
        this.geometry = geom;
    }
}
