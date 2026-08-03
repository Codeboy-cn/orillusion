import { Engine3D } from '../../../../Engine3D';
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
        }
        if (!this._traceShader || !this._blendShader || this._nodeCount === 0) return;

        const setting = this._volume.setting;
        const probeCount = setting.probeXCount * setting.probeYCount * setting.probeZCount;
        const lights = EntityCollect.instance.getLights(view.scene);

        this._traceUniform!.setFloat('nodeCount', this._nodeCount);
        this._traceUniform!.setFloat('lightCount', lights.length);
        this._traceUniform!.setFloat('skyIntensity', setting.rtSkyIntensity ?? 1.0);
        this._traceUniform!.setFloat('retain0', 0);
        this._traceUniform!.apply();

        const totalRays = probeCount * setting.rayNumber;
        this._traceShader.workerSizeX = Math.ceil(totalRays / 64);
        this._traceShader.workerSizeY = 1;
        this._traceShader.workerSizeZ = 1;

        this._blendShader.workerSizeX = setting.octRTSideSize / 8;
        this._blendShader.workerSizeY = setting.octRTSideSize / 8;
        this._blendShader.workerSizeZ = probeCount;

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

    private rebuild(view: View3D): void {
        const triPositions: number[] = [];
        const triMaterialIds: number[] = [];
        const materials: number[] = [];

        this.forEachRenderer(view, (renderer) => {
            const geometry = renderer.geometry;
            const posAttr = geometry.getAttribute(VertexAttributeName.position);
            const indexAttr = geometry.getAttribute(VertexAttributeName.indices);
            if (!posAttr || !posAttr.data || posAttr.data.length < 9) return;

            const matIndex = materials.length / 8;
            let albedoR = 0.7, albedoG = 0.7, albedoB = 0.7;
            let emissiveR = 0, emissiveG = 0, emissiveB = 0;
            const material = renderer.material as any;
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
            } catch (e) {
                // Materials without these uniforms fall back to gray.
            }
            materials.push(albedoR, albedoG, albedoB, 0, emissiveR, emissiveG, emissiveB, 0);

            const m = renderer.transform.worldMatrix.rawData;
            const pos = posAttr.data as Float32Array;
            const pushVertex = (vi: number) => {
                const x = pos[vi * 3], y = pos[vi * 3 + 1], z = pos[vi * 3 + 2];
                // Column-major world transform (translation at 12/13/14).
                triPositions.push(
                    m[0] * x + m[4] * y + m[8] * z + m[12],
                    m[1] * x + m[5] * y + m[9] * z + m[13],
                    m[2] * x + m[6] * y + m[10] * z + m[14],
                );
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

        // Triangles reordered into BVH leaf order: 3 vec4 per triangle,
        // material index in [0].w.
        const triData = new Float32Array(triCount * 12);
        for (let i = 0; i < triCount; i++) {
            const src = triOrder[i] * 9;
            const dst = i * 12;
            triData[dst] = soup[src]; triData[dst + 1] = soup[src + 1]; triData[dst + 2] = soup[src + 2];
            triData[dst + 3] = triMaterialIds[triOrder[i]];
            triData[dst + 4] = soup[src + 3]; triData[dst + 5] = soup[src + 4]; triData[dst + 6] = soup[src + 5];
            triData[dst + 8] = soup[src + 6]; triData[dst + 9] = soup[src + 7]; triData[dst + 10] = soup[src + 8];
        }

        const materialData = new Float32Array(materials);

        this._bvhNodesBuffer = new StorageGPUBuffer(nodeData.length, 0, nodeData);
        this._bvhTrianglesBuffer = new StorageGPUBuffer(triData.length, 0, triData);
        this._bvhMaterialsBuffer = new StorageGPUBuffer(materialData.length, 0, materialData);

        const setting = this._volume.setting;
        const probeCount = setting.probeXCount * setting.probeYCount * setting.probeZCount;
        if (!this._rayHitBuffer) {
            this._rayHitBuffer = new StorageGPUBuffer(probeCount * setting.rayNumber * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        }
        if (!this._irradianceBuffer) {
            const pixelCount = setting.octRTMaxSize * setting.octRTMaxSize;
            this._irradianceBuffer = new StorageGPUBuffer(pixelCount * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
            this._depthBuffer = new StorageGPUBuffer(pixelCount * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        }
        if (!this._traceUniform) {
            this._traceUniform = new UniformGPUBuffer(8);
        }

        // Bind-group layouts cache buffer objects, so the shaders are
        // recreated whenever the BVH buffers are (rebuilds are rare).
        this.createShaders(view);
    }

    private createShaders(view: View3D): void {
        const lightEntries = GlobalBindGroup.getLightEntries(view.scene);
        const modelMatrixBuffer = GlobalBindGroup.getModelMatrixBindGroup(this._ctx).matrixBufferDst;
        const defaultSky = Engine3D.resFor(this._ctx).defaultSky;

        const trace = new ComputeShader(DDGITrace_shader);
        trace.setStorageBuffer('bvhNodes', this._bvhNodesBuffer!);
        trace.setStorageBuffer('bvhTriangles', this._bvhTrianglesBuffer!);
        trace.setStorageBuffer('bvhMaterials', this._bvhMaterialsBuffer!);
        trace.setStorageBuffer('rayHitBuffer', this._rayHitBuffer!);
        trace.setUniformBuffer('uniformData', this._volume.irradianceVolumeBuffer);
        trace.setUniformBuffer('traceUniform', this._traceUniform!);
        trace.setSamplerTexture('irradianceMap', this._irradianceColorMap);
        trace.setSamplerTexture('prefilterMap', defaultSky);
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
        blend.setStorageBuffer('models', modelMatrixBuffer);
        this._blendShader = blend;
    }
}
