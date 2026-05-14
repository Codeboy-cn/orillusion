import {
    AtmosphericComponent, BoxGeometry, CameraUtil, Color, ComponentBase, DirectLight, Engine3D,
    ForwardRendererJob, HoverCameraController, KelvinUtil, LitMaterial, Matrix4,
    MeshRenderer, Object3D, PassType, Quaternion, RenderGraphBuilder, RenderGraphPass,
    RenderGraphPassContext, RenderStage, RenderTexture, Scene3D, SphereGeometry, Vector3, View3D,
    // Built-in graph resource keys we depend on.
    COLOR_BUFFER, MAIN_DEPTH_TEXTURE,
} from "@orillusion/core";

/* ════════════════════════════════════════════════════════════════════
 * Sample_DecalShadowVolume —— RenderGraph custom decal rendering example
 *
 * Approach:
 *   Scene: a large sphere + several bumps on its surface to simulate terrain relief.
 *   Decal volume: each decal's footprint is extruded along the sphere normal into a
 *   box-shaped Volume. The **Z-fail stencil algorithm** (Carmack's Reverse) marks,
 *   in screen space, "pixels whose surface lies inside the Volume", and that stencil
 *   mask is then used to composite the decal texture into ColorBuffer.
 *
 * Pipeline insertion point: ForwardRendererJob's AfterOpaque (stage=50),
 *   after ColorPass and before PostPass. This way the decal applies directly to
 *   the opaque scene.
 *
 * Because the engine's `RenderShaderPass / Material` currently does not expose
 * stencil state, this Pass bypasses the engine material system entirely and
 * builds its own pipelines / manages its own resources directly via the low-level
 * WebGPU API inside execute(). This also showcases the extreme use of
 * RenderGraphPass as a "custom render node".
 *
 * Rendering steps (per frame):
 *   ┌── Pass A: Depth Blit
 *   │     Sample _MainDepthTexture into the depth aspect of our managed
 *   │     depth24plus-stencil8 texture; clear stencil=0 at the same time.
 *   │
 *   ├── For each Decal Volume:
 *   │     Pass B (per-decal): Stencil Mark
 *   │        - cullMode=none (rasterize both front and back faces)
 *   │        - depthCompare=less, depthWriteEnabled=false
 *   │        - stencilLoadOp=clear (each decal counts independently)
 *   │        - stencilFront.depthFailOp = 'decrement-wrap'
 *   │        - stencilBack .depthFailOp = 'increment-wrap'
 *   │        Z-fail rule: on surface pixels "enclosed" by the Volume, stencil != 0.
 *   │
 *   │     Pass C (per-decal): Decal Composite
 *   │        - Render Volume back faces (cullMode='front'), depthCompare='always'
 *   │        - Stencil test: stencilCompare='not_equal', reference=0
 *   │        - In the FS, reconstruct the pixel's world position from sceneDepth,
 *   │          project into Decal local space to obtain UV → sample decal →
 *   │          alpha-blend into COLOR_BUFFER.
 *   └──
 * ──────────────────────────────────────────────────────────────────── */

/** Format of the Color target we render decals into; matches ColorPass.COLOR_BUFFER. */
const COLOR_FORMAT: GPUTextureFormat = 'rgba16float';
/** Format of the depth+stencil scratch texture we manage ourselves. */
const DS_FORMAT: GPUTextureFormat = 'depth24plus-stencil8';

/** Cache of GPU handles used by a single decal during one frame (owned by the pass, keyed by component). */
type DecalGpu = {
    uniformBuffer: GPUBuffer;
    textureView: GPUTextureView;
    boundTexture: GPUTexture;
};

/* ════════════════════════════════════════════════════════════════════
 * DecalComponent —— engine-style component API
 *
 * Usage (consistent with MeshRenderer / DirectLight):
 *     const obj = new Object3D();
 *     obj.localPosition = ...;                    // Volume center in world space
 *     obj.localScale = new Vector3(w, depth, w);  // xz = footprint, y = extrusion depth
 *     DecalComponent.alignTopToward(obj, normal); // align local +Y with the normal
 *     const dc = obj.addComponent(DecalComponent);
 *     dc.texture = ...;
 *     dc.tint    = new Color(1, 1, 1, 1);
 *     scene.addChild(obj);
 *
 * Implementation notes:
 *   - Inherits ComponentBase; adds/removes itself to/from a static registry in onEnable/onDisable.
 *   - `transform.worldMatrix` is used directly as the decal's model matrix (the unit cube
 *     has vertices with |xyz| ≤ 0.5 and is stretched to the desired size by scale).
 *   - GPU resources owned by the decal (uniform buffer + texture view) are held by the pass,
 *     keyed by this component.
 *   - The registry is cross-view / cross-engine: a simple global Set is enough here. If multiple
 *     Views are needed, it could be bucketed per view3D — not required for this sample.
 * ════════════════════════════════════════════════════════════════════ */
class DecalComponent extends ComponentBase {
    /** Decal texture. Assigning takes effect immediately (the next frame's pass rebuilds the BG with the new view). */
    public texture: GPUTexture | null = null;

    /** Decal tint + alpha multiplier. */
    public tint: Color = new Color(1, 1, 1, 1);

    /** Maximum angle (optional) at which a surface still accepts the decal. Default 90° = no filtering
     *  (any orientation is accepted → "wraps" minor relief).
     *  Setting a smaller value such as 60° restricts the decal to surfaces roughly facing decal-up
     *  (suitable for rigid "stamp"-style decals).
     *  Note: to precisely exclude tall buildings, use DecalBlockerComponent — it culls based on
     *  the actual geometry. */
    public maxAngleDeg: number = 90;

    /** All currently enabled decal components. pass.execute iterates this set directly. */
    public static readonly activeRegistry: Set<DecalComponent> = new Set();

    /** Orient an Object3D's local +Y axis to point along the given world direction
     *  (used to stand the Volume up on a curved surface). */
    public static alignTopToward(obj: Object3D, normal: Vector3): void {
        const n = TMP_VEC3_A.copy(normal);
        if (n.length < 1e-6) return;
        n.normalize();
        const q = TMP_QUAT_A.setFromUnitVectors(VEC3_UP, n);
        obj.localQuaternion = q;
    }

    public init(param?: { texture?: GPUTexture; tint?: Color; maxAngleDeg?: number }): void {
        if (param?.texture) this.texture = param.texture;
        if (param?.tint) this.tint = param.tint;
        if (param?.maxAngleDeg !== undefined) this.maxAngleDeg = param.maxAngleDeg;
    }

    public onEnable(_view?: View3D): void {
        DecalComponent.activeRegistry.add(this);
    }

    public onDisable(_view?: View3D): void {
        DecalComponent.activeRegistry.delete(this);
    }
}

/* ════════════════════════════════════════════════════════════════════
 * DecalBlockerComponent —— "I do not accept decals, and I occlude decals"
 *
 * Usage: tag geometry such as tall buildings, which "should not have decals stuck to them",
 * with this component:
 *     const building = new Object3D();
 *     building.localPosition = ...;
 *     DecalComponent.alignTopToward(building, normal);
 *     const mr = building.addComponent(MeshRenderer);
 *     mr.geometry = new BoxGeometry(w, h, d);
 *     mr.material = new LitMaterial();
 *     ...
 *     building.addComponent(DecalBlockerComponent);
 *     scene.addChild(building);
 *
 * Implementation idea — use the engine's built-in render-order mechanism with no
 * screen-space filtering at all:
 *   - In addRenderNode, the engine's EntityCollect buckets a node into opaqueList
 *     or transparentList based on `renderOrder >= 3000`.
 *   - opaqueList is drawn by ColorPass in RenderStage.Opaque (40);
 *     transparentList is drawn by SortedTransparentPass in RenderStage.Transparent (60).
 *   - Our decal pass runs at AfterOpaque (50) — **exactly between the two**.
 *   - So bumping the blocker node's material.colorPass.renderOrder to ≥ 3000 makes
 *     SortedTransparentPass draw it after the decal pass →
 *     the building naturally renders on top of the decal = the building occludes
 *     the decal + the decal cannot paint on the building.
 *   - alphaMode remains 'OPAQUE' (blendMode=NONE, depthWriteEnabled=true), so the
 *     building is still opaque and writes depth normally; the engine simply moves
 *     it to the "transparent bucket" to defer its draw — an "opaque object disguised
 *     as transparent".
 *   - This is the "strict render-order control" pattern the user suggested:
 *     terrain → decals → tall buildings.
 * ════════════════════════════════════════════════════════════════════ */
class DecalBlockerComponent extends ComponentBase {
    public static readonly activeRegistry: Set<DecalBlockerComponent> = new Set();

    public onEnable(_view?: View3D): void {
        DecalBlockerComponent.activeRegistry.add(this);
        this._bumpRenderOrder();
    }

    public onDisable(_view?: View3D): void {
        DecalBlockerComponent.activeRegistry.delete(this);
    }

    /** Bump the color pass of every material on the host's MeshRenderer into the transparent bucket.
     *  Callers should addComponent(DecalBlockerComponent) after addComponent(MeshRenderer). */
    private _bumpRenderOrder(): void {
        const mr = this.object3D.getComponent(MeshRenderer);
        if (!mr) return;
        for (const mat of mr.materials) {
            const passes = mat.getPass(PassType.COLOR);
            if (!passes) continue;
            for (const p of passes) {
                /* The engine's EntityCollect uses >= 3000 to classify as transparent;
                 * 3001 puts it unambiguously into transparentList. */
                if (p.renderOrder < 3000) p.renderOrder = 3001;
            }
        }
        /* Have the RenderNode re-bucket using the new renderOrder (move it into transparentList). */
        mr.refreshRenderClassification();
    }
}

/* Reusable temporaries (Vector3 / Quaternion are pure JS; module-level new is side-effect-free). */
const TMP_VEC3_A = new Vector3();
const VEC3_UP = new Vector3(0, 1, 0);
const TMP_QUAT_A = new Quaternion();

/** Spherical parameters (latitude θ, longitude φ) → unit vector (x, y, z), with y = sin(θ). */
function sphericalDir(theta: number, phi: number): [number, number, number] {
    const cosT = Math.cos(theta);
    return [cosT * Math.cos(phi), Math.sin(theta), cosT * Math.sin(phi)];
}

/* ─────────────── Unit cube geometry (position only) ────────────────
 * 8 vertices / 12 triangles (36 indices), centered at the origin, edge length 1.
 * (We scale by decal.size in the model matrix, so local coords with |xyz| <= 0.5 mean
 * "inside the Volume".) */
function buildUnitCubeGeometry() {
    const v = new Float32Array([
        -0.5, -0.5, -0.5,
        0.5, -0.5, -0.5,
        0.5, 0.5, -0.5,
        -0.5, 0.5, -0.5,
        -0.5, -0.5, 0.5,
        0.5, -0.5, 0.5,
        0.5, 0.5, 0.5,
        -0.5, 0.5, 0.5,
    ]);
    // CCW outward (WebGPU default frontFace='ccw')
    const i = new Uint16Array([
        0, 2, 1, 0, 3, 2, // -Z
        4, 5, 6, 4, 6, 7, // +Z
        0, 1, 5, 0, 5, 4, // -Y
        3, 6, 2, 3, 7, 6, // +Y
        1, 2, 6, 1, 6, 5, // +X
        0, 4, 7, 0, 7, 3, // -X
    ]);
    return { vertices: v, indices: i, indexCount: i.length };
}

/* ─────────────── Procedurally generated decal texture ────────────────
 * Simple approach: draw a geometric pattern on an OffscreenCanvas/HTMLCanvas, then
 * upload it to a GPUTexture with copyExternalImageToTexture. */
function makeCanvasTexture(device: GPUDevice, size: number, draw: (c: CanvasRenderingContext2D) => void): GPUTexture {
    const canvas = (typeof OffscreenCanvas !== 'undefined')
        ? new OffscreenCanvas(size, size)
        : Object.assign(document.createElement('canvas'), { width: size, height: size });
    const ctx2d = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx2d.clearRect(0, 0, size, size);
    draw(ctx2d);
    const tex = device.createTexture({
        size: [size, size, 1],
        format: 'rgba8unorm-srgb',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
        { source: canvas as any },
        { texture: tex },
        [size, size, 1],
    );
    return tex;
}

/* ─────────────── Load an image from a URL into a GPUTexture ────────────────
 * Decode with createImageBitmap, then upload via copyExternalImageToTexture.
 * Note: decals may not be square, so the texture size follows the source image. */
async function loadImageTexture(device: GPUDevice, url: string): Promise<GPUTexture> {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`loadImageTexture: ${url} → ${resp.status}`);
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
    const tex = device.createTexture({
        label: `decal:${url.split('/').pop()}`,
        size: [bitmap.width, bitmap.height, 1],
        format: 'rgba8unorm-srgb',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture: tex },
        [bitmap.width, bitmap.height, 1],
    );
    bitmap.close();
    return tex;
}

/* ════════════════════════════════════════════════════════════════════
 * The custom RenderGraphPass.
 * ════════════════════════════════════════════════════════════════════ */
class DecalShadowVolumePass extends RenderGraphPass {
    public readonly name = 'DecalShadowVolumePass';
    public readonly stage = RenderStage.AfterOpaque;

    /* ── Device / persistent GPU resources ── */
    private _device!: GPUDevice;
    private _cubeVB!: GPUBuffer;
    private _cubeIB!: GPUBuffer;
    private _cubeIdxCount!: number;
    private _depthSampler!: GPUSampler;     // Used for textureSample (shared with the decal texture)
    private _decalSampler!: GPUSampler;
    private _depthStencilTex!: GPUTexture | null;
    private _depthStencilSize: [number, number] = [0, 0];

    /* ── Pipeline objects ── */
    private _blitPipeline!: GPURenderPipeline;
    private _markPipeline!: GPURenderPipeline;
    private _compositePipeline!: GPURenderPipeline;
    private _blitBGLayout!: GPUBindGroupLayout;
    private _markBGLayout!: GPUBindGroupLayout;
    private _compositeBGLayout!: GPUBindGroupLayout;

    /* GPU handles per DecalComponent, cached with the component as key.
     * The WeakMap is released automatically when the component is GC'd
     * (the WebGPU handles lose their references with it). */
    private _decalGpu: WeakMap<DecalComponent, DecalGpu> = new WeakMap();

    /* ── Input/output resource handles (declared in setup) ── */
    private _ctx3d: any; // Context3D — typed as any to avoid an additional import

    /* Matrix4 uses the wasm backend and can only be constructed after Engine3D.init(),
     * so we keep them as member variables and lazy-allocate. */
    private _mVP!: Matrix4;
    private _mInvVP!: Matrix4;
    private _mModel!: Matrix4;
    private _mInvModel!: Matrix4;

    public setup(b: RenderGraphBuilder): void {
        const ctx3d = b.context3D;
        this._ctx3d = ctx3d;
        const device = this._device = ctx3d.device as GPUDevice;

        this._mVP = new Matrix4();
        this._mInvVP = new Matrix4();
        this._mModel = new Matrix4();
        this._mInvModel = new Matrix4();

        /* Resource dependencies: we write to COLOR_BUFFER and sample _MainDepthTexture.
         * b.write(COLOR_BUFFER) registers us as a mutator — the AfterOpaque stage runs
         * after ColorPass and before PostPass. */
        b.read(MAIN_DEPTH_TEXTURE);
        b.write(COLOR_BUFFER);

        /* ── Upload the unit cube geometry ── */
        const geo = buildUnitCubeGeometry();
        this._cubeIdxCount = geo.indexCount;
        this._cubeVB = device.createBuffer({
            size: geo.vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(this._cubeVB, 0, geo.vertices);
        this._cubeIB = device.createBuffer({
            size: geo.indices.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(this._cubeIB, 0, geo.indices);

        /* ── Samplers ── */
        this._depthSampler = device.createSampler({});
        this._decalSampler = device.createSampler({
            magFilter: 'linear', minFilter: 'linear',
            addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
        });

        /* ── Build the three BindGroupLayouts and corresponding pipelines ── */
        this._createPipelines();

        /* Note: the depth-stencil texture is lazily allocated in execute() based on the current
         * presentationSize, because the canvas size may change after setup (browser window resize). */
        this._depthStencilTex = null;
    }

    public destroy(): void {
        this._cubeVB?.destroy();
        this._cubeIB?.destroy();
        this._depthStencilTex?.destroy();
        this._depthStencilTex = null;
        /* Do not destroy the decal's own texture: it is owned by the component,
         * its lifetime is decided by the component / user. */
    }

    /* ─────────── execute: per-frame GPU work ─────────── */
    public execute(ctx: RenderGraphPassContext): void {
        if (DecalComponent.activeRegistry.size === 0) return;

        const device = this._device;
        const view = ctx.view;
        const camera = view.camera;
        const gpu = (view as any).engine3D.context3D.gpuContext;

        const colorTex = ctx.get<RenderTexture>(COLOR_BUFFER);
        const sceneDepthTex = ctx.get<RenderTexture>(MAIN_DEPTH_TEXTURE);
        if (!colorTex || !sceneDepthTex) return;

        const [W, H] = (view as any).engine3D.context3D.presentationSize as [number, number];
        const dsTex = this._ensureDepthStencil(W, H);
        const dsView = dsTex.createView({ aspect: 'all' });
        const dsViewDepthOnly = dsTex.createView({ aspect: 'depth-only' });
        const dsViewStencilOnly = dsTex.createView({ aspect: 'stencil-only' }); // Declare the full view only when used as readOnly
        void dsViewDepthOnly; void dsViewStencilOnly; // The combined view is sufficient for our use

        const sceneDepthView = sceneDepthTex.getGPUView() as GPUTextureView;
        const colorView = (colorTex.getGPUTexture() as GPUTexture).createView();

        /* Compute the view-projection matrix (CPU side, once per frame).
         * We use plain-JS multiplyMatrices rather than the wasm matrixMultiply, because the
         * static member `Matrix4.wasm` is not always installed in some builds (it's only
         * injected by packages/physics etc.). */
        const vp = this._mVP;
        vp.multiplyMatrices(camera.projectionMatrix, camera.viewMatrix);
        /* invVP is used in the FS to reconstruct world position. */
        const invVP = this._mInvVP.copy(vp);
        invVP.invert();

        /* Attach all GPU work to the engine's commandEncoder so it is submitted within the same frame as other passes. */
        const command = gpu.beginCommandEncoder();

        /* ────────── Pass A: Depth Blit ──────────
         * Copy scene depth into the depth aspect of our ds texture, clear stencil = 0. */
        {
            const blitBG = device.createBindGroup({
                layout: this._blitBGLayout,
                entries: [
                    { binding: 0, resource: sceneDepthView },
                ],
            });
            const enc = command.beginRenderPass({
                label: 'DecalShadowVolume:DepthBlit',
                colorAttachments: [],
                depthStencilAttachment: {
                    view: dsView,
                    depthLoadOp: 'clear', depthClearValue: 1.0, depthStoreOp: 'store',
                    stencilLoadOp: 'clear', stencilClearValue: 0, stencilStoreOp: 'store',
                },
            });
            enc.setPipeline(this._blitPipeline);
            enc.setBindGroup(0, blitBG);
            enc.draw(3); // full-screen triangle
            enc.end();
        }

        /* ────────── Per-decal: Stencil mark + Composite ──────────
         * Iterate the component registry; each decal independently clear stencil → mark → composite,
         * with no interference between them. */
        let drawIdx = 0;
        for (const decal of DecalComponent.activeRegistry) {
            if (!decal.enable || !decal.texture) continue;
            /* The component may be attached to a disabled Object3D → skip. */
            if (!decal.transform || !decal.transform.enable) continue;
            const gpuRes = this._updateDecalUniform(decal, vp, invVP);
            if (!gpuRes) continue;
            const label = decal.object3D?.name || `#${drawIdx++}`;

            /* Pass B: stencil-only render pass (no color, stencil clear=0, depth load) */
            {
                const bg = device.createBindGroup({
                    layout: this._markBGLayout,
                    entries: [
                        { binding: 0, resource: { buffer: gpuRes.uniformBuffer } },
                    ],
                });
                const enc = command.beginRenderPass({
                    label: `DecalShadowVolume:Mark[${label}]`,
                    colorAttachments: [],
                    depthStencilAttachment: {
                        view: dsView,
                        depthLoadOp: 'load', depthStoreOp: 'store',
                        stencilLoadOp: 'clear', stencilClearValue: 0, stencilStoreOp: 'store',
                    },
                });
                enc.setPipeline(this._markPipeline);
                enc.setBindGroup(0, bg);
                enc.setVertexBuffer(0, this._cubeVB);
                enc.setIndexBuffer(this._cubeIB, 'uint16');
                enc.setStencilReference(0);
                enc.drawIndexed(this._cubeIdxCount);
                enc.end();
            }

            /* Pass C: composite — write COLOR_BUFFER, stencil test != 0.
             * Note: this pass's depth-stencil is readOnly; WebGPU requires
             *       the loadOp/storeOp fields to be omitted when readOnly. */
            {
                const bg = device.createBindGroup({
                    layout: this._compositeBGLayout,
                    entries: [
                        { binding: 0, resource: { buffer: gpuRes.uniformBuffer } },
                        { binding: 1, resource: sceneDepthView },
                        { binding: 2, resource: gpuRes.textureView },
                        { binding: 3, resource: this._decalSampler },
                    ],
                });
                const enc = command.beginRenderPass({
                    label: `DecalShadowVolume:Composite[${label}]`,
                    colorAttachments: [{
                        view: colorView,
                        loadOp: 'load', storeOp: 'store',
                    }],
                    depthStencilAttachment: {
                        view: dsView,
                        depthReadOnly: true,
                        stencilReadOnly: true,
                    },
                });
                enc.setPipeline(this._compositePipeline);
                enc.setBindGroup(0, bg);
                enc.setVertexBuffer(0, this._cubeVB);
                enc.setIndexBuffer(this._cubeIB, 'uint16');
                enc.setStencilReference(0);
                enc.drawIndexed(this._cubeIdxCount);
                enc.end();
            }
        }

        /* Finish and submit this pass's own command encoder. Subsequent passes will begin a new one. */
        gpu.endCommandEncoder(command);
    }

    /* ─────────── Private: lazy-allocate / reallocate the depth-stencil texture ─────────── */
    private _ensureDepthStencil(w: number, h: number): GPUTexture {
        if (this._depthStencilTex
            && this._depthStencilSize[0] === w
            && this._depthStencilSize[1] === h) {
            return this._depthStencilTex;
        }
        this._depthStencilTex?.destroy();
        this._depthStencilTex = this._device.createTexture({
            label: 'DecalShadowVolume:DS',
            size: [w, h, 1],
            format: DS_FORMAT,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        this._depthStencilSize = [w, h];
        return this._depthStencilTex;
    }

    /* ─────────── Private: upload / fetch a decal's uniform data ─────────── */
    private _updateDecalUniform(decal: DecalComponent, vp: Matrix4, invVP: Matrix4): DecalGpu | null {
        const device = this._device;
        const tex = decal.texture;
        if (!tex) return null;

        /* The model matrix comes straight from the Object3D's world transform. The unit cube
         * has |xyz| ≤ 0.5; the user stretches it to the actual Volume size via localScale,
         * while localPosition + localRotQuat control position and orientation
         * (local +Y is the extrusion direction). */
        const worldMat = decal.transform.worldMatrix;
        const m = this._mModel.copy(worldMat);
        const invM = this._mInvModel.copy(m);
        invM.invert();

        let gpuRes = this._decalGpu.get(decal);
        /* texture may be swapped at runtime → the texture view must be updated too. */
        if (gpuRes && gpuRes.boundTexture !== tex) {
            gpuRes.textureView = tex.createView();
            gpuRes.boundTexture = tex;
        }
        if (!gpuRes) {
            const uniformBuffer = device.createBuffer({
                size: UNIFORM_BYTES,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            gpuRes = {
                uniformBuffer,
                textureView: tex.createView(),
                boundTexture: tex,
            };
            this._decalGpu.set(decal, gpuRes);
        }

        /* Uniform data layout (order / byte offset):
         *   0   .. 64   : vp        : mat4x4f
         *   64  .. 128  : invVP     : mat4x4f
         *   128 .. 192  : model     : mat4x4f
         *   192 .. 256  : invModel  : mat4x4f
         *   256 .. 272  : tint      : vec4f
         *   272 .. 288  : params    : vec4f (x: maxAngleCos) */
        const cpu = TMP_UNIFORM_F32;
        cpu.set(vp.rawData, 0);
        cpu.set(invVP.rawData, 16);
        cpu.set(m.rawData, 32);
        cpu.set(invM.rawData, 48);
        cpu[64] = decal.tint.r; cpu[65] = decal.tint.g; cpu[66] = decal.tint.b; cpu[67] = decal.tint.a;
        /* When maxAngleDeg >= 90, explicitly write -2 (outside the valid range of dot) so that
         * `dot < params.x` in the FS is always FALSE and never triggers filtering. We do not rely
         * on Math.cos(π/2) ≈ 0 to "effectively disable" it — that value is actually 6e-17, and
         * dot fluctuating near 0 in the FS would hit it irregularly, causing patchy missing
         * decals on the sides of bumps. */
        cpu[68] = decal.maxAngleDeg >= 89.99
            ? -2.0
            : Math.cos(decal.maxAngleDeg * Math.PI / 180);
        cpu[69] = 0; cpu[70] = 0; cpu[71] = 0;
        device.queue.writeBuffer(gpuRes.uniformBuffer, 0, cpu.buffer, cpu.byteOffset, UNIFORM_BYTES);

        return gpuRes;
    }

    /* ─────────── Private: build the three GPURenderPipelines ─────────── */
    private _createPipelines(): void {
        const device = this._device;

        /* ── A. Depth Blit ── */
        this._blitBGLayout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
            ],
        });
        const blitShader = device.createShaderModule({ code: BLIT_WGSL });
        this._blitPipeline = device.createRenderPipeline({
            label: 'DecalShadowVolume:BlitPipeline',
            layout: device.createPipelineLayout({ bindGroupLayouts: [this._blitBGLayout] }),
            vertex: { module: blitShader, entryPoint: 'vs' },
            fragment: { module: blitShader, entryPoint: 'fs', targets: [] },
            primitive: { topology: 'triangle-list', cullMode: 'none' },
            depthStencil: {
                format: DS_FORMAT,
                depthCompare: 'always',
                depthWriteEnabled: true,
            },
        });

        /* ── B. Stencil Mark ── */
        this._markBGLayout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
            ],
        });
        const markShader = device.createShaderModule({ code: MARK_WGSL });
        this._markPipeline = device.createRenderPipeline({
            label: 'DecalShadowVolume:MarkPipeline',
            layout: device.createPipelineLayout({ bindGroupLayouts: [this._markBGLayout] }),
            vertex: {
                module: markShader, entryPoint: 'vs',
                buffers: [{
                    arrayStride: 12,
                    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
                }],
            },
            fragment: { module: markShader, entryPoint: 'fs', targets: [] },
            /* Key: cullMode='none' lets both stencilFront / stencilBack get hit. */
            primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
            depthStencil: {
                format: DS_FORMAT,
                /* Z-fail: depthCompare='less' → depth fails when the pixel's NDC z >= stored z. */
                depthCompare: 'less',
                depthWriteEnabled: false,
                stencilReadMask: 0xFF,
                stencilWriteMask: 0xFF,
                /* Front-facing triangles: depth fail → decrement */
                stencilFront: {
                    compare: 'always',
                    failOp: 'keep',
                    depthFailOp: 'decrement-wrap',
                    passOp: 'keep',
                },
                /* Back-facing triangles: depth fail → increment */
                stencilBack: {
                    compare: 'always',
                    failOp: 'keep',
                    depthFailOp: 'increment-wrap',
                    passOp: 'keep',
                },
            },
        });

        /* ── C. Composite ── */
        this._compositeBGLayout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
            ],
        });
        const compositeShader = device.createShaderModule({ code: COMPOSITE_WGSL });
        this._compositePipeline = device.createRenderPipeline({
            label: 'DecalShadowVolume:CompositePipeline',
            layout: device.createPipelineLayout({ bindGroupLayouts: [this._compositeBGLayout] }),
            vertex: {
                module: compositeShader, entryPoint: 'vs',
                buffers: [{
                    arrayStride: 12,
                    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
                }],
            },
            fragment: {
                module: compositeShader, entryPoint: 'fs',
                targets: [{
                    format: COLOR_FORMAT,
                    blend: {
                        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                    },
                    writeMask: GPUColorWrite.ALL,
                }],
            },
            /* Key: render Volume back faces → covers the full screen region even when the camera enters the Volume. */
            primitive: { topology: 'triangle-list', cullMode: 'front', frontFace: 'ccw' },
            depthStencil: {
                format: DS_FORMAT,
                depthCompare: 'always',
                depthWriteEnabled: false,
                stencilReadMask: 0xFF,
                stencilWriteMask: 0x00,
                /* stencil != 0 → the surface behind this screen pixel is enclosed by the Volume. */
                stencilFront: { compare: 'not-equal', failOp: 'keep', depthFailOp: 'keep', passOp: 'keep' },
                stencilBack: { compare: 'not-equal', failOp: 'keep', depthFailOp: 'keep', passOp: 'keep' },
            },
        });
    }
}

/* ─────────── Simple reusable temporaries (to avoid GC jitter) ─────────── */
/* Per-decal uniform byte count = 4 mat4 (256) + vec4 tint (16) + vec4 params (16) = 288 */
const UNIFORM_BYTES = 4 * 64 + 16 + 16;
const TMP_UNIFORM_F32 = new Float32Array(UNIFORM_BYTES / 4);

/* ════════════════════════════════════════════════════════════════════
 * WGSL Shaders
 * ════════════════════════════════════════════════════════════════════ */

/** Pass A: read the depth from _MainDepthTexture (depth32float) and write it directly into frag_depth.
 *  Vertices use the "fullscreen triangle" trick: 3 vertices that cover NDC. */
const BLIT_WGSL = /* wgsl */`
@group(0) @binding(0) var srcDepth: texture_depth_2d;

struct VOut {
    @builtin(position) pos: vec4f,
};

@vertex
fn vs(@builtin(vertex_index) idx: u32) -> VOut {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    var out: VOut;
    out.pos = vec4f(p[idx], 0.0, 1.0);
    return out;
}

@fragment
fn fs(in: VOut) -> @builtin(frag_depth) f32 {
    let coord = vec2i(i32(in.pos.x), i32(in.pos.y));
    return textureLoad(srcDepth, coord, 0);
}
`;

/** Pass B: transform Volume vertices into clip space; the FS outputs no color. */
const MARK_WGSL = /* wgsl */`
struct Uniforms {
    vp:       mat4x4f,
    invVP:    mat4x4f,
    model:    mat4x4f,
    invModel: mat4x4f,
    tint:     vec4f,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex
fn vs(@location(0) pos: vec3f) -> @builtin(position) vec4f {
    return u.vp * (u.model * vec4f(pos, 1.0));
}

@fragment
fn fs() {
    /* No color output — stencil updates happen in the fixed-function stage. */
}
`;

/** Pass C: reconstruct world position from screen depth → project into Decal local space →
 *  UV → sample texture → output.
 *  The decal wraps all terrain inside its footprint (sphere, sides and tops of bumps); there
 *  is no screen-space filtering at all. Occlusion by "tall buildings" is handled by
 *  DecalBlockerComponent, which defers buildings to be drawn after the decal pass (render order). */
const COMPOSITE_WGSL = /* wgsl */`
struct Uniforms {
    vp:       mat4x4f,
    invVP:    mat4x4f,
    model:    mat4x4f,
    invModel: mat4x4f,
    tint:     vec4f,
    params:   vec4f,   /* reserved (kept for compatibility with the old uniform layout, unused) */
};

@group(0) @binding(0) var<uniform>      u:           Uniforms;
@group(0) @binding(1) var               sceneDepth:  texture_depth_2d;
@group(0) @binding(2) var               decalTex:    texture_2d<f32>;
@group(0) @binding(3) var               decalSamp:   sampler;

struct VOut {
    @builtin(position) pos: vec4f,
};

@vertex
fn vs(@location(0) pos: vec3f) -> VOut {
    var out: VOut;
    out.pos = u.vp * (u.model * vec4f(pos, 1.0));
    return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
    let dim   = textureDimensions(sceneDepth);
    let pixel = vec2i(i32(in.pos.x), i32(in.pos.y));
    if (pixel.x < 0 || pixel.y < 0 || pixel.x >= i32(dim.x) || pixel.y >= i32(dim.y)) {
        discard;
    }
    let depth = textureLoad(sceneDepth, pixel, 0);

    /* WebGPU framebuffer coords: origin top-left, y goes down. Flip y when converting to NDC.
     * z is the [0..1] depth value directly. */
    let uvScreen = (vec2f(in.pos.xy) + vec2f(0.5)) / vec2f(dim);
    let ndc = vec4f(uvScreen.x * 2.0 - 1.0, 1.0 - uvScreen.y * 2.0, depth, 1.0);
    let worldH = u.invVP * ndc;
    let world  = worldH.xyz / worldH.w;

    /* Convert to Decal local space; the local cube spans |x|, |y|, |z| < 0.5. */
    let localH = u.invModel * vec4f(world, 1.0);
    let local  = localH.xyz;
    if (abs(local.x) > 0.5 || abs(local.y) > 0.5 || abs(local.z) > 0.5) {
        /* The stencil has already done the main culling; this is just a protective fallback. */
        discard;
    }

    /* Top-down projection along the local Y axis (extrusion direction) → take XZ as UV. */
    let uv = vec2f(local.x + 0.5, 1.0 - (local.z + 0.5));
    let texCol = textureSample(decalTex, decalSamp, uv);

    /* Edge falloff: soft-fade along the extrusion depth to reduce z-fighting / hard-cut artifacts. */
    let edgeFade = 1.0 - smoothstep(0.35, 0.5, abs(local.y));

    let rgb = texCol.rgb * u.tint.rgb;
    let a   = texCol.a * u.tint.a * edgeFade;
    return vec4f(rgb * a, a);  /* Premultiplied alpha, matching blend = src-alpha / (1-src-alpha) */
}
`;

/* ════════════════════════════════════════════════════════════════════
 * Custom RendererJob —— reuses the full ForwardRendererJob pipeline and only inserts the decal pass.
 * ════════════════════════════════════════════════════════════════════ */
class DecalRendererJob extends ForwardRendererJob {
    constructor(view: View3D) {
        super(view);
        /* AfterOpaque + b.write(COLOR_BUFFER) + b.read(MAIN_DEPTH_TEXTURE) lets the topology
         * automatically schedule it after ColorPass and before PostPass.
         * The pass itself has no external API; all decal configuration goes through DecalComponent. */
        this.graph.add(DecalShadowVolumePass);
        this.graph.compile();
        console.log('[DecalRendererJob] pass order:\n  ' +
            this.graph.passes.map(p => p.name).join(' → '));
    }
}

/* ════════════════════════════════════════════════════════════════════
 * Sample entry point
 * ════════════════════════════════════════════════════════════════════ */
export class Sample_DecalShadowVolume {
    engine!: Engine3D;
    scene!: Scene3D;

    async run() {
        this.engine = await Engine3D.init({
            setting: {
                shadow: { autoUpdate: true, updateFrameRate: 1 },
                /* zPrePass defaults to true; our pass depends on _MainDepthTexture, so we declare the intent explicitly. */
                render: { zPrePass: true } as any,
            },
        });

        this.scene = new Scene3D();
        this.scene.addComponent(AtmosphericComponent);

        const camera = CameraUtil.createCamera3DObject(this.scene);
        camera.perspective(60, this.engine.aspect, 0.5, 5000);
        /* HoverCameraController.setCamera(roundAngle, upAngle, distance):
         * Position the camera on the +X side looking slightly down at the sphere, so the
         * decals clustered around phi≈0 are visible. */
        camera.object3D.addComponent(HoverCameraController).setCamera(90, -10, 72);

        const view = new View3D();
        view.scene = this.scene;
        view.camera = camera;
        this.engine.startRenderView(view, DecalRendererJob);

        await this.initScene();
        await this.setupDecals();
    }

    private async initScene() {
        /* Directional light */
        const light = new Object3D();
        light.rotationX = 55;
        light.rotationY = 320;
        const dl = light.addComponent(DirectLight);
        dl.lightColor = KelvinUtil.color_temperature_to_rgb(5500);
        dl.intensity = 3;
        dl.castShadow = true;
        dl.enableCSM = true;
        this.scene.addChild(light);

        /* Large sphere (substitute for ground) */
        const sphere = new Object3D();
        const sphereMat = new LitMaterial();
        sphereMat.baseColor = new Color(0.32, 0.38, 0.30, 1);
        sphereMat.roughness = 0.85;
        const sphereMr = sphere.addComponent(MeshRenderer);
        sphereMr.geometry = new SphereGeometry(30, 64, 64);
        sphereMr.material = sphereMat;
        sphereMr.receiveShadow = true;
        this.scene.addChild(sphere);

        const sphereR = 30;

        /* "Bumps" on the sphere — simulate minor terrain relief and demonstrate
         * "decals wrapping the relief".
         * Placed at the center of each decal: no DecalBlockerComponent → fully accepts
         * decals, including the sides → verifies that the bump curves naturally within
         * the decal's local space. */
        const bumpPositions: Array<[number, number, number, number]> = [
            // [theta, phi, scale, hue]
            [0.55, -0.15, 1.2, 0.10],  // Center of the crosshair
            [0.40, 0.45, 1.1, 0.55],   // Center of the pad
            [-0.45, 0.25, 1.2, 0.30],  // Center of the stripes
            [-0.45, -0.30, 1.1, 0.78], // Center of the procedural arrow
            [0.00, -0.42, 1.4, 0.05],  // Center of the grid (large bump)
            [0.00, 0.45, 1.1, 0.92],   // Center of arrow.png
        ];
        for (let i = 0; i < bumpPositions.length; i++) {
            const [t, p, s, hue] = bumpPositions[i];
            const [nx, ny, nz] = sphericalDir(t, p);
            const bump = new Object3D();
            /* Place the bottom of the box against the sphere surface, extruding s/2 outward. */
            bump.x = nx * (sphereR + s * 0.4);
            bump.y = ny * (sphereR + s * 0.4);
            bump.z = nz * (sphereR + s * 0.4);
            const mr = bump.addComponent(MeshRenderer);
            mr.geometry = new BoxGeometry(s * 2, s * 2, s * 2);
            const mat = new LitMaterial();
            const c = this._hueToRgb(hue);
            mat.baseColor = new Color(c[0], c[1], c[2], 1);
            mat.roughness = 0.65;
            mat.metallic = 0.05;
            mr.material = mat;
            mr.castShadow = true;
            mr.receiveShadow = true;
            this.scene.addChild(bump);
        }

        /* —— Tall buildings ——
         * Slender boxes standing along the sphere normal, height >> the decal volume's extrusion depth.
         * Expected behavior:
         *   - The building **occludes** the decal (the building geometry wrote ColorBuffer + Depth in ColorPass).
         *   - The building **itself is not affected by the decal**: wall normals are nearly 90° to decal-up,
         *     so dot < maxAngleCos in the FS discards them; the building's top is outside the volume and is
         *     culled by the stencil. */
        const buildings: Array<[number, number, number, number, number]> = [
            // [theta, phi, footprintW, footprintD, height]
            [0.50, -0.20, 1.4, 1.4, 12],  // Building 1: stands in the center of the crosshair
            [0.40, 0.50, 1.2, 1.2, 10],   // Building 2: stands at the edge of the pad
            [-0.42, 0.30, 1.0, 1.6, 14],  // Building 3: stands in the stripes, tall and slim
            [0.00, -0.40, 1.6, 1.0, 11],  // Building 4: stands in the grid
            [-0.10, 0.55, 1.0, 1.0, 3],   // Building 5: stands next to arrow.png
        ];
        for (let i = 0; i < buildings.length; i++) {
            const [t, p, fw, fd, h] = buildings[i];
            const [nx, ny, nz] = sphericalDir(t, p);
            const obj = new Object3D();
            obj.name = `Building_${i}`;
            /* Place the base against the sphere surface: the center sits h/2 outside the sphere. */
            obj.x = nx * (sphereR + h * 0.5);
            obj.y = ny * (sphereR + h * 0.5);
            obj.z = nz * (sphereR + h * 0.5);
            /* Orient local +Y along the sphere normal (so the building stands upright). */
            DecalComponent.alignTopToward(obj, new Vector3(nx, ny, nz));
            const mr = obj.addComponent(MeshRenderer);
            mr.geometry = new BoxGeometry(fw, h, fd);
            const mat = new LitMaterial();
            mat.baseColor = new Color(0.85, 0.85, 0.88, 1);
            mat.roughness = 0.4;
            mat.metallic = 0.2;
            mr.material = mat;
            mr.castShadow = true;
            mr.receiveShadow = true;
            /* Key: tag the building as a decal blocker. The component automatically bumps the material
             * renderOrder to 3001, so the engine buckets it into transparentList → SortedTransparentPass
             * draws it after the decal pass → the building covers the decal and naturally isn't painted by it. */
            obj.addComponent(DecalBlockerComponent);
            this.scene.addChild(obj);
        }
    }


    /* Configure decals: extrude a box along the sphere normal as the Volume. */
    private async setupDecals(): Promise<void> {
        const device = (this.engine.context3D as any).device as GPUDevice;
        const sphereR = 30;

        /* ── Procedural decals: drawn on the fly via Canvas ── */
        type ProcDecal = {
            kind: 'proc'; name: string; theta: number; phi: number;
            width: number; depth: number;
            tint: [number, number, number, number];
            paint: (g: CanvasRenderingContext2D, S: number) => void;
        };
        /* ── Image decals: loaded from public/textures/ ── */
        type ImgDecal = {
            kind: 'img'; name: string; theta: number; phi: number;
            width: number; depth: number;
            tint: [number, number, number, number];
            url: string;
        };
        type AnyDecal = ProcDecal | ImgDecal;

        const decals: AnyDecal[] = [
            {
                kind: 'proc', name: 'crosshair', theta: 0.55, phi: -0.15,
                width: 8, depth: 10,
                tint: [1.0, 0.85, 0.20, 1.0],
                paint: (g, S) => {
                    g.strokeStyle = '#fff';
                    g.lineWidth = S * 0.06;
                    g.beginPath();
                    g.arc(S / 2, S / 2, S * 0.4, 0, Math.PI * 2);
                    g.stroke();
                    g.beginPath();
                    g.moveTo(S / 2, S * 0.08); g.lineTo(S / 2, S * 0.92);
                    g.moveTo(S * 0.08, S / 2); g.lineTo(S * 0.92, S / 2);
                    g.stroke();
                },
            },
            {
                kind: 'proc', name: 'pad', theta: 0.4, phi: 0.45,
                width: 9, depth: 12,
                tint: [0.25, 0.85, 0.95, 0.9],
                paint: (g, S) => {
                    const grad = g.createRadialGradient(S / 2, S / 2, S * 0.05, S / 2, S / 2, S * 0.48);
                    grad.addColorStop(0, 'rgba(255,255,255,1)');
                    grad.addColorStop(0.6, 'rgba(120,220,255,0.7)');
                    grad.addColorStop(1, 'rgba(40,40,80,0)');
                    g.fillStyle = grad;
                    g.fillRect(0, 0, S, S);
                    g.strokeStyle = 'rgba(255,255,255,0.8)';
                    g.lineWidth = S * 0.04;
                    for (let k = 0; k < 4; k++) {
                        g.beginPath();
                        g.arc(S / 2, S / 2, S * (0.15 + k * 0.08), 0, Math.PI * 2);
                        g.stroke();
                    }
                },
            },
            {
                kind: 'proc', name: 'stripes', theta: -0.45, phi: 0.25,
                width: 8, depth: 10,
                tint: [1.0, 0.35, 0.30, 1.0],
                paint: (g, S) => {
                    g.fillStyle = 'rgba(255,255,255,0.95)';
                    const bands = 6;
                    for (let k = 0; k < bands; k++) {
                        if ((k & 1) === 0) g.fillRect(0, (k / bands) * S, S, S / bands);
                    }
                },
            },
            {
                kind: 'proc', name: 'arrowProc', theta: -0.45, phi: -0.30,
                width: 7, depth: 10,
                tint: [0.95, 0.95, 0.95, 1.0],
                paint: (g, S) => {
                    g.fillStyle = 'rgba(40,160,80,1)';
                    g.beginPath();
                    g.moveTo(S * 0.5, S * 0.08);
                    g.lineTo(S * 0.85, S * 0.55);
                    g.lineTo(S * 0.6, S * 0.55);
                    g.lineTo(S * 0.6, S * 0.92);
                    g.lineTo(S * 0.4, S * 0.92);
                    g.lineTo(S * 0.4, S * 0.55);
                    g.lineTo(S * 0.15, S * 0.55);
                    g.closePath();
                    g.fill();
                },
            },
            /* —— New: public/textures/grid.jpg —— */
            {
                kind: 'img', name: 'grid', theta: 0.0, phi: -0.42,
                width: 12, depth: 14,
                tint: [1.0, 1.0, 1.0, 1.0],
                url: 'textures/grid.jpg',
            },
            /* —— New: public/textures/arrow.png —— */
            {
                kind: 'img', name: 'arrowTex', theta: 0.0, phi: 0.45,
                width: 10, depth: 12,
                tint: [1.0, 1.0, 1.0, 1.0],
                url: 'textures/arrow.png',
            },
        ];

        /* Turn each config entry into an Object3D + DecalComponent and add it to the scene. */
        await Promise.all(decals.map(async d => {
            const ny = Math.sin(d.theta);
            const cosT = Math.cos(d.theta);
            const nx = cosT * Math.cos(d.phi);
            const nz = cosT * Math.sin(d.phi);
            const normal = new Vector3(nx, ny, nz);

            const tex = d.kind === 'proc'
                ? makeCanvasTexture(device, 256, (g) => d.paint(g, 256))
                : await loadImageTexture(device, d.url);

            /* 1) Create a plain Object3D as the decal's carrier. */
            const obj = new Object3D();
            obj.name = `Decal:${d.name}`;
            /* 2) Position: place the Volume center on the sphere surface. */
            obj.localPosition = new Vector3(nx * sphereR, ny * sphereR, nz * sphereR);
            /* 3) Scale: the unit cube has |xyz| ≤ 0.5, scale stretches it to the actual Volume size
             *    (x/z = decal footprint, y = extrusion depth along the normal). */
            obj.localScale = new Vector3(d.width, d.depth, d.width);
            /* 4) Rotation: align local +Y with the normal direction. */
            DecalComponent.alignTopToward(obj, normal);
            /* 5) Attach the component — same usage as MeshRenderer/DirectLight. */
            obj.addComponent(DecalComponent, {
                texture: tex,
                tint: new Color(d.tint[0], d.tint[1], d.tint[2], d.tint[3]),
            });
            /* 6) addChild → onEnable triggers → automatically added to the registry, visible to next frame's pass. */
            this.scene.addChild(obj);
        }));

        /* Note: DecalComponent.activeRegistry.size may still be 0 at this moment — onEnable only fires
         * on the next frame from the engine's waitStart queue, so we just report the source count here. */
        console.log(`[Sample_DecalShadowVolume] ${decals.length} decals added to scene.`);

        /* After a few frames, print the actual registry size to confirm the blockers are attached too. */
        setTimeout(() => {
            console.log(`[Sample_DecalShadowVolume] activeRegistry: ` +
                `${DecalComponent.activeRegistry.size} decals, ` +
                `${DecalBlockerComponent.activeRegistry.size} blockers`);
        }, 500);
    }

    private _hueToRgb(h: number): [number, number, number] {
        const c = 1;
        const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
        let r = 0, g = 0, b = 0;
        if (h < 1 / 6) { r = c; g = x; }
        else if (h < 2 / 6) { r = x; g = c; }
        else if (h < 3 / 6) { g = c; b = x; }
        else if (h < 4 / 6) { g = x; b = c; }
        else if (h < 5 / 6) { r = x; b = c; }
        else { r = c; b = x; }
        return [r * 0.6 + 0.2, g * 0.6 + 0.2, b * 0.6 + 0.2];
    }
}
