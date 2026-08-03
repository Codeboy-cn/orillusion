import { Engine3D } from '../../../../Engine3D';
import { Time } from '../../../../util/Time';
import { BitmapTexture2D } from '../../../../textures/BitmapTexture2D';
import { BitmapTexture2DArray } from '../../../../textures/BitmapTexture2DArray';
import { MeshRenderer } from '../../../../components/renderer/MeshRenderer';
import { SkyRenderer } from '../../../../components/renderer/SkyRenderer';
import { GIProbeMaterial } from '../../../../materials/GIProbeMaterial';
import { View3D } from '../../../../core/View3D';
import { Object3D } from '../../../../core/entities/Object3D';
import { VertexAttributeName } from '../../../../core/geometry/VertexAttributeName';
import { RenderTexture } from '../../../../textures/RenderTexture';
import { Context3D } from '../../../graphics/webGpu/Context3D';
import { GlobalBindGroup } from '../../../graphics/webGpu/core/bindGroups/GlobalBindGroup';
import { StorageGPUBuffer } from '../../../graphics/webGpu/core/buffer/StorageGPUBuffer';
import { UniformGPUBuffer } from '../../../graphics/webGpu/core/buffer/UniformGPUBuffer';
import { ComputeShader } from '../../../graphics/webGpu/shader/ComputeShader';
import { DDGITrace_shader } from '../../../../assets/shader/compute/DDGITrace_Cs';
import { DDGITraceBlend_shader } from '../../../../assets/shader/compute/DDGITraceBlend_Cs';
import { EntityCollect } from '../../collect/EntityCollect';
import { DDGIIrradianceVolume } from './DDGIIrradianceVolume';
import { BVHBuilder, BVH_NODE_STRIDE } from './bvh/BVHBuilder';

/**
 * Software-ray-traced DDGI probe update path (BVH tracing instead of the
 * cube-capture GBuffer). Flattens the scene into a world-space triangle
 * soup on the CPU, builds a skip-link BVH, and runs two compute kernels
 * per frame: DDGITrace_Cs (one thread per probe ray) and
 * DDGITraceBlend_Cs (octahedral integration into the SAME irradiance /
 * depth atlas the raster path writes, so the material sampling side is
 * unchanged).
 *
 * The BVH rebuilds lazily when the collected triangle count changes
 * (mesh added/removed). Transform-only changes currently require a
 * manual `markDirty()` — the target scenes for the probe volume are
 * mostly static.
 *
 * @internal
 */
export class DDGITracePass {
    private _ctx: Context3D;
    private _volume: DDGIIrradianceVolume;

    private _traceShader: ComputeShader | null = null;
    private _blendShader: ComputeShader | null = null;

    private _bvhNodesBuffer: StorageGPUBuffer | null = null;
    private _bvhTrianglesBuffer: StorageGPUBuffer | null = null;
    private _bvhMaterialsBuffer: StorageGPUBuffer | null = null;
    private _rayHitBuffer: StorageGPUBuffer | null = null;
    private _irradianceBuffer: StorageGPUBuffer | null = null;
    private _depthBuffer: StorageGPUBuffer | null = null;
    private _traceUniform: UniformGPUBuffer | null = null;

    private _irradianceColorMap: RenderTexture;
    private _irradianceDepthMap: RenderTexture;

    private _nodeCount = 0;
    private _lastMeshFingerprint = -1;
    private _dirty = true;
    private _rayHitBufferFloats = 0;
    private _probeCursor = 0;
    // First sweep after a (re)build ignores the per-frame budget so every
    // probe gets data immediately — paired with the blend kernel's
    // history bootstrap this makes GI appear at full brightness on the
    // first traced frame instead of fading in over a full sweep.
    private _fullSweepPending = true;
    // Frame-time driven budget scale (speedball-style throttle): shrinks
    // when the frame runs long, recovers when there is headroom.
    private _budgetScale = 1;
    // Per-material albedo textures downscaled into a 2d-array (layer =
    // material index) so hit shading bounces COLORED light. Built async
    // after each rebuild; the trace shader is (re)created once it lands.
    private _albedoAtlas: BitmapTexture2DArray | null = null;
    private _atlasBuildId = 0;
    private _needShaderRecreate = false;

    /** True once the auto-fit grid has been computed and written back
     *  into setting.gi (probe counts / spacing / offsets). Debug tooling
     *  (probe spheres) should be created only after this. */
    public autoFitDone = false;

    constructor(ctx: Context3D, volume: DDGIIrradianceVolume, irradianceColorMap: RenderTexture, irradianceDepthMap: RenderTexture) {
        this._ctx = ctx;
        this._volume = volume;
        this._irradianceColorMap = irradianceColorMap;
        this._irradianceDepthMap = irradianceDepthMap;
    }

    /** Force a BVH rebuild on the next frame (e.g. after moving meshes). */
    public markDirty(): void {
        this._dirty = true;
    }

    public compute(view: View3D): void {
        const fingerprint = this.sceneFingerprint(view);
        if (this._dirty || fingerprint !== this._lastMeshFingerprint) {
            this._lastMeshFingerprint = fingerprint;
            this._dirty = false;
            this.rebuild(view);
            // Auto-fit may have rewritten the grid settings AFTER this
            // frame's volume upload; re-upload now so the kernels never
            // run one frame against stale (possibly zero-count) uniforms.
            this._volume.uploadBuffer();
        }
        if (this._needShaderRecreate && this._albedoAtlas) {
            this._needShaderRecreate = false;
            this.createShaders(view);
        }
        if (!this._traceShader || !this._blendShader || this._nodeCount === 0) return;

        const setting = this._volume.setting;
        const probeCount = setting.probeXCount * setting.probeYCount * setting.probeZCount;
        if (probeCount === 0) return;
        const lights = EntityCollect.instance.getLights(view.scene);

        // Budget: rtRaysPerFrame (ray budget / frame, speedball-style)
        // wins over rtProbeCountPerFrame (probe budget / frame); both 0 =
        // every probe each frame. The frame-time throttle scales whichever
        // budget is active; the unbudgeted mode stays untouched so the
        // Cornell bench keeps its all-probes behavior.
        const rayBudget = Math.floor(setting.rtRaysPerFrame ?? 0);
        const probeBudget = Math.floor(setting.rtProbeCountPerFrame ?? 0);
        let budget = rayBudget > 0 ? Math.max(1, Math.floor(rayBudget / setting.rayNumber)) : probeBudget;
        if (budget > 0) {
            const dt = Time.delta;
            if (dt > 22) this._budgetScale = Math.max(0.1, this._budgetScale * 0.85);
            else if (dt < 13) this._budgetScale = Math.min(1, this._budgetScale * 1.05);
            budget = Math.max(1, Math.floor(budget * this._budgetScale));
        }
        let updateCount = budget > 0 ? Math.min(budget, probeCount) : probeCount;
        if (this._fullSweepPending) {
            this._fullSweepPending = false;
            this._probeCursor = 0;
            updateCount = probeCount;
        }
        if (this._probeCursor >= probeCount) this._probeCursor = 0;

        this._traceUniform!.setFloat('nodeCount', this._nodeCount);
        this._traceUniform!.setFloat('lightCount', lights.length);
        this._traceUniform!.setFloat('skyIntensity', setting.rtSkyIntensity ?? 1.0);
        this._traceUniform!.setFloat('probeCursor', this._probeCursor);
        this._traceUniform!.setFloat('updateCount', updateCount);
        this._traceUniform!.apply();

        this._probeCursor = (this._probeCursor + updateCount) % probeCount;

        const totalRays = updateCount * setting.rayNumber;
        this._traceShader.workerSizeX = Math.ceil(totalRays / 64);
        this._traceShader.workerSizeY = 1;
        this._traceShader.workerSizeZ = 1;

        this._blendShader.workerSizeX = setting.octRTSideSize / 8;
        this._blendShader.workerSizeY = setting.octRTSideSize / 8;
        this._blendShader.workerSizeZ = updateCount;

        const gpu = view.engine3D.context3D.gpuContext;
        const command = gpu.beginCommandEncoder();
        // Two dispatches in one pass: WebGPU orders storage access between
        // dispatch calls, so the blend sees this frame's rayHitBuffer.
        gpu.computeCommand(command, [this._traceShader, this._blendShader]);
        gpu.endCommandEncoder(command);
    }

    /** Cheap change detector: renderer count + total vertex count. */
    private sceneFingerprint(view: View3D): number {
        let fingerprint = 0;
        this.forEachRenderer(view, (renderer) => {
            const posAttr = renderer.geometry?.getAttribute(VertexAttributeName.position);
            fingerprint += 1000003 + (posAttr ? posAttr.data.length : 0);
        });
        return fingerprint;
    }

    private forEachRenderer(view: View3D, callback: (renderer: MeshRenderer) => void): void {
        // getComponents recurses the scene tree and matches the exact class,
        // so SkyRenderer / SkinnedMeshRenderer subclasses never enter the
        // static BVH. Probe-debug spheres are plain MeshRenderers and are
        // filtered by material.
        const renderers = (view.scene as unknown as Object3D).getComponents(MeshRenderer);
        for (const renderer of renderers) {
            if (!renderer || !renderer.enable || !renderer.geometry) continue;
            if (renderer instanceof SkyRenderer) continue;
            if (renderer.material instanceof GIProbeMaterial) continue;
            callback(renderer);
        }
    }

    /** Auto-fit the probe grid to the collected scene AABB (speedball-style):
     *  pad the bounds by 6% per side, spacing = longest axis / rtDivisions,
     *  per-axis counts derived so cells stay roughly cubic. Active when
     *  setting.rtAutoFit is true OR all three probe counts are 0. The result
     *  is written back into setting.gi and the volume uniform re-uploads. */
    private applyAutoFit(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): void {
        const setting = this._volume.setting;
        const wantsAutoFit = setting.rtAutoFit === true
            || (setting.probeXCount === 0 && setting.probeYCount === 0 && setting.probeZCount === 0);
        if (!wantsAutoFit) return;

        const pad = 0.06;
        let sizeX = Math.max(maxX - minX, 1e-3);
        let sizeY = Math.max(maxY - minY, 1e-3);
        let sizeZ = Math.max(maxZ - minZ, 1e-3);
        sizeX *= 1 + 2 * pad; sizeY *= 1 + 2 * pad; sizeZ *= 1 + 2 * pad;

        const divisions = Math.min(32, Math.max(2, Math.round(setting.rtDivisions ?? 12)));
        const longest = Math.max(sizeX, sizeY, sizeZ);
        const spacing = longest / divisions;
        const axis = (s: number) => Math.min(32, Math.max(2, Math.round(s / spacing) + 1));

        setting.probeXCount = axis(sizeX);
        setting.probeYCount = axis(sizeY);
        setting.probeZCount = axis(sizeZ);
        setting.probeSpace = spacing;
        // calcPosition centers the grid on the offset, so the offset is
        // simply the AABB center.
        setting.offsetX = (minX + maxX) * 0.5;
        setting.offsetY = (minY + maxY) * 0.5;
        setting.offsetZ = (minZ + maxZ) * 0.5;

        this._volume.setVolumeDataChange();
        this._probeCursor = 0;
        this._fullSweepPending = true;
        this.autoFitDone = true;
    }

    private rebuild(view: View3D): void {
        const triPositions: number[] = [];
        const triUVs: number[] = [];
        const triMaterialIds: number[] = [];
        const materials: number[] = [];
        const albedoSources: (CanvasImageSource | null)[] = [];
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        this.forEachRenderer(view, (renderer) => {
            const geometry = renderer.geometry;
            const posAttr = geometry.getAttribute(VertexAttributeName.position);
            const indexAttr = geometry.getAttribute(VertexAttributeName.indices);
            if (!posAttr || !posAttr.data || posAttr.data.length < 9) return;
            const uvAttr = geometry.getAttribute(VertexAttributeName.uv);
            const uvData = (uvAttr && uvAttr.data && uvAttr.data.length >= 2) ? (uvAttr.data as Float32Array) : null;

            const matIndex = materials.length / 8;
            let albedoR = 0.7, albedoG = 0.7, albedoB = 0.7;
            let emissiveR = 0, emissiveG = 0, emissiveB = 0;
            const material = renderer.material as any;
            let albedoSource: CanvasImageSource | null = null;
            try {
                const baseColor = material?.baseColor;
                if (baseColor) { albedoR = baseColor.r; albedoG = baseColor.g; albedoB = baseColor.b; }
                const emissiveColor = material?.emissiveColor;
                const emissiveIntensity = material?.emissiveIntensity ?? 0;
                if (emissiveColor && emissiveIntensity > 0) {
                    emissiveR = emissiveColor.r * emissiveIntensity;
                    emissiveG = emissiveColor.g * emissiveIntensity;
                    emissiveB = emissiveColor.b * emissiveIntensity;
                }
                albedoSource = material?.baseMap?.source ?? null;
            } catch (e) {
                // Materials without these uniforms fall back to gray.
            }
            materials.push(albedoR, albedoG, albedoB, 0, emissiveR, emissiveG, emissiveB, 0);
            albedoSources.push(albedoSource);

            const m = renderer.transform.worldMatrix.rawData;
            const pos = posAttr.data as Float32Array;
            const pushVertex = (vi: number) => {
                const x = pos[vi * 3], y = pos[vi * 3 + 1], z = pos[vi * 3 + 2];
                // Column-major world transform (translation at 12/13/14).
                const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
                const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
                const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
                if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
                if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
                if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
                triPositions.push(wx, wy, wz);
                if (uvData) {
                    triUVs.push(uvData[vi * 2] || 0, uvData[vi * 2 + 1] || 0);
                } else {
                    triUVs.push(0, 0);
                }
            };

            if (indexAttr && indexAttr.data && indexAttr.data.length >= 3) {
                const indices = indexAttr.data;
                const triCount = Math.floor(indices.length / 3);
                for (let t = 0; t < triCount; t++) {
                    pushVertex(indices[t * 3] as number);
                    pushVertex(indices[t * 3 + 1] as number);
                    pushVertex(indices[t * 3 + 2] as number);
                    triMaterialIds.push(matIndex);
                }
            } else {
                const triCount = Math.floor(pos.length / 9);
                for (let t = 0; t < triCount; t++) {
                    pushVertex(t * 3);
                    pushVertex(t * 3 + 1);
                    pushVertex(t * 3 + 2);
                    triMaterialIds.push(matIndex);
                }
            }
        });

        const triCount = triMaterialIds.length;
        this._nodeCount = 0;
        if (triCount === 0) return;

        this.applyAutoFit(minX, minY, minZ, maxX, maxY, maxZ);

        const soup = new Float32Array(triPositions);
        const { nodes, nodeCount, triOrder } = BVHBuilder.build(soup, triCount);
        this._nodeCount = nodeCount;

        // GPU node layout: 3 vec4 per node —
        // [min.xyz, skipLink] [max.xyz, triOffset|-1] [triCount, 0, 0, 0]
        const nodeData = new Float32Array(nodeCount * 12);
        for (let n = 0; n < nodeCount; n++) {
            const src = n * BVH_NODE_STRIDE;
            const dst = n * 12;
            nodeData[dst] = nodes[src]; nodeData[dst + 1] = nodes[src + 1]; nodeData[dst + 2] = nodes[src + 2];
            nodeData[dst + 3] = nodes[src + 3];
            nodeData[dst + 4] = nodes[src + 4]; nodeData[dst + 5] = nodes[src + 5]; nodeData[dst + 6] = nodes[src + 6];
            nodeData[dst + 7] = nodes[src + 7];
            nodeData[dst + 8] = nodes[src + 8];
        }

        // Triangles reordered into BVH leaf order: 4 vec4 per triangle —
        // [0]=v0.xyz,matId  [1]=v1.xyz,uv0.x  [2]=v2.xyz,uv0.y  [3]=uv1.xy,uv2.xy
        const triData = new Float32Array(triCount * 16);
        for (let i = 0; i < triCount; i++) {
            const tri = triOrder[i];
            const src = tri * 9;
            const uvSrc = tri * 6;
            const dst = i * 16;
            triData[dst] = soup[src]; triData[dst + 1] = soup[src + 1]; triData[dst + 2] = soup[src + 2];
            triData[dst + 3] = triMaterialIds[tri];
            triData[dst + 4] = soup[src + 3]; triData[dst + 5] = soup[src + 4]; triData[dst + 6] = soup[src + 5];
            triData[dst + 7] = triUVs[uvSrc];
            triData[dst + 8] = soup[src + 6]; triData[dst + 9] = soup[src + 7]; triData[dst + 10] = soup[src + 8];
            triData[dst + 11] = triUVs[uvSrc + 1];
            triData[dst + 12] = triUVs[uvSrc + 2]; triData[dst + 13] = triUVs[uvSrc + 3];
            triData[dst + 14] = triUVs[uvSrc + 4]; triData[dst + 15] = triUVs[uvSrc + 5];
        }

        const materialData = new Float32Array(materials);

        this._bvhNodesBuffer = new StorageGPUBuffer(nodeData.length, 0, nodeData);
        this._bvhTrianglesBuffer = new StorageGPUBuffer(triData.length, 0, triData);
        this._bvhMaterialsBuffer = new StorageGPUBuffer(materialData.length, 0, materialData);

        const setting = this._volume.setting;
        const probeCount = setting.probeXCount * setting.probeYCount * setting.probeZCount;
        const rayFloats = Math.max(4, probeCount * setting.rayNumber * 4);
        if (!this._rayHitBuffer || this._rayHitBufferFloats < rayFloats) {
            this._rayHitBuffer = new StorageGPUBuffer(rayFloats, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
            this._rayHitBufferFloats = rayFloats;
        }
        if (!this._irradianceBuffer) {
            const pixelCount = setting.octRTMaxSize * setting.octRTMaxSize;
            this._irradianceBuffer = new StorageGPUBuffer(pixelCount * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
            this._depthBuffer = new StorageGPUBuffer(pixelCount * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        }
        if (!this._traceUniform) {
            this._traceUniform = new UniformGPUBuffer(8);
        }

        // Kick the async albedo-atlas build. Until the FIRST atlas lands
        // the trace shader cannot exist (it binds the atlas), so the first
        // dispatch waits ~a frame for the downscale; later rebuilds keep
        // tracing with the previous atlas and swap when ready.
        void this.buildAlbedoAtlas(albedoSources);

        // Bind-group layouts cache buffer objects, so the shaders are
        // recreated whenever the BVH buffers are (rebuilds are rare).
        if (this._albedoAtlas) {
            this.createShaders(view);
        } else {
            this._needShaderRecreate = true;
        }
    }

    /** Downscale each material's albedo texture into one 128x128 layer of
     *  a texture_2d_array (white for untextured materials, sRGB so the
     *  sampler decodes to linear like the raster path's baseMap). */
    private async buildAlbedoAtlas(sources: (CanvasImageSource | null)[]): Promise<void> {
        const buildId = ++this._atlasBuildId;
        const SIZE = 128;
        const layerCount = Math.max(1, Math.min(sources.length, 256));
        const bitmaps: BitmapTexture2D[] = [];
        for (let i = 0; i < layerCount; i++) {
            const canvas = new OffscreenCanvas(SIZE, SIZE);
            const c2d = canvas.getContext('2d')!;
            c2d.fillStyle = '#ffffff';
            c2d.fillRect(0, 0, SIZE, SIZE);
            const src = sources[i];
            if (src) {
                try { c2d.drawImage(src, 0, 0, SIZE, SIZE); } catch (e) { /* decode-locked sources stay white */ }
            }
            // .source = OffscreenCanvas does NOT upload (known gap in
            // BitmapTexture2D); go through an ImageBitmap, which does.
            const bmp = await createImageBitmap(canvas);
            if (buildId !== this._atlasBuildId) return;
            const tex = new BitmapTexture2D(false, this._ctx, 'srgb');
            tex.source = bmp;
            bitmaps.push(tex);
        }
        if (buildId !== this._atlasBuildId) return;
        const atlas = new BitmapTexture2DArray(SIZE, SIZE, layerCount, this._ctx, 0, 'srgb');
        atlas.setTextures(bitmaps);
        this._albedoAtlas = atlas;
        this._needShaderRecreate = true;
    }

    private createShaders(view: View3D): void {
        const lightEntries = GlobalBindGroup.getLightEntries(view.scene);
        const modelMatrixBuffer = GlobalBindGroup.getModelMatrixBindGroup(this._ctx).matrixBufferDst;
        // Prefer the scene's actual sky cube (e.g. the atmospheric sky) so
        // sky-miss rays carry the radiance the camera also sees; fall back
        // to the default environment cube.
        const sceneSky = EntityCollect.instance.getSky(view.scene) as SkyRenderer | null;
        const defaultSky = (sceneSky && sceneSky.map) ? sceneSky.map : Engine3D.resFor(this._ctx).defaultSky;

        const trace = new ComputeShader(DDGITrace_shader);
        trace.setStorageBuffer('bvhNodes', this._bvhNodesBuffer!);
        trace.setStorageBuffer('bvhTriangles', this._bvhTrianglesBuffer!);
        trace.setStorageBuffer('bvhMaterials', this._bvhMaterialsBuffer!);
        trace.setStorageBuffer('rayHitBuffer', this._rayHitBuffer!);
        trace.setUniformBuffer('uniformData', this._volume.irradianceVolumeBuffer);
        trace.setUniformBuffer('traceUniform', this._traceUniform!);
        trace.setSamplerTexture('irradianceMap', this._irradianceColorMap);
        trace.setSamplerTexture('prefilterMap', defaultSky);
        trace.setSamplerTexture('albedoAtlas', this._albedoAtlas!);
        trace.setStorageBuffer('models', modelMatrixBuffer);
        trace.setStorageBuffer('lightBuffer', lightEntries.storageGPUBuffer);
        this._traceShader = trace;

        const blend = new ComputeShader(DDGITraceBlend_shader);
        blend.setStorageBuffer('irradianceBuffer', this._irradianceBuffer!);
        blend.setStorageBuffer('depthBuffer', this._depthBuffer!);
        blend.setUniformBuffer('uniformData', this._volume.irradianceVolumeBuffer);
        blend.setStorageTexture('probeIrradianceMap', this._irradianceColorMap);
        blend.setStorageTexture('probeDepthMap', this._irradianceDepthMap);
        blend.setStorageBuffer('rayHitBuffer', this._rayHitBuffer!);
        blend.setUniformBuffer('traceUniform', this._traceUniform!);
        blend.setStorageBuffer('models', modelMatrixBuffer);
        this._blendShader = blend;
    }
}
