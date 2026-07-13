

//TODO dynamic lights need fixed

import { View3D } from "../../../../../../core/View3D";
import { RenderTexture } from "../../../../../../textures/RenderTexture";
import { EntityCollect } from "../../../../../renderJob/collect/EntityCollect";
import { StorageGPUBuffer } from "../../buffer/StorageGPUBuffer";
import { Texture } from "../../texture/Texture";

/**
 * @internal
 * @group GFX
 */
export class ReflectionEntries {
    /** Max probe slots; must cover globalUniform.reflectionProbeMaxCount. */
    private static readonly MAX_PROBES = 128;
    /**
     * Floats per probe, matching the WGSL `ReflectionInfo` struct in
     * ReflectionCG.ts. WGSL std430-style layout math:
     *   gid:f32            -> byte offset 0   (float 0)
     *   (12 pad bytes: the following vec3f aligns to 16)   (floats 1..3)
     *   worldPosition:vec3f -> byte offset 16 (floats 4..6)
     *   radius:f32          -> byte offset 28 (float 7, packs after vec3f)
     *   worldPosition2:vec3f-> byte offset 32 (floats 8..10)
     *   (4 pad bytes: struct size rounds up to align(16))   (float 11)
     * => stride 48 bytes = 12 floats per array element.
     */
    private static readonly PROBE_STRIDE_FLOATS = 12;

    public storageGPUBuffer: StorageGPUBuffer;
    public reflectionMap: Texture;

    public sourceReflectionMap: RenderTexture;
    count: number;
    constructor() {
        this.storageGPUBuffer = new StorageGPUBuffer(ReflectionEntries.PROBE_STRIDE_FLOATS * ReflectionEntries.MAX_PROBES);
        // Pre-allocate one memory node per probe slot, in index order, so
        // node i sits exactly at byte offset i * 48 — matching the WGSL
        // array stride regardless of how many probes a given frame writes.
        for (let i = 0; i < ReflectionEntries.MAX_PROBES; i++) {
            this.storageGPUBuffer.allocMemoryNode(`reflection_${i}`, ReflectionEntries.PROBE_STRIDE_FLOATS * 4);
        }
    }

    public update(view: View3D) {
        // let command = GPUContext.beginCommandEncoder();
        // GPUContext.copyTexture(command, this.sourceReflectionMap, this.reflectionMap);
        // GPUContext.endCommandEncoder(command);

        this.storageGPUBuffer.clean();
        let reflections = EntityCollect.instance.getReflections(view.scene);
        let count = Math.min(reflections.length, ReflectionEntries.MAX_PROBES);
        for (let i = 0; i < count; i++) {
            const reflection = reflections[i];
            reflection.gid = i;
            const node = this.storageGPUBuffer.getMemoryNode(`reflection_${i}`);
            const p = reflection.transform.worldPosition;
            // Write the full 48-byte ReflectionInfo element (padding included);
            // see PROBE_STRIDE_FLOATS for the layout math.
            node.setArray(0, [
                reflection.gid, 0, 0, 0,        // gid + vec3f alignment padding
                p.x, p.y, p.z,                  // worldPosition
                reflection.radius,              // radius (packs into vec3f pad)
                p.x, p.y, p.z,                  // worldPosition2 (bound)
                0,                              // struct tail padding
            ]);
        }
        this.count = count;
        this.storageGPUBuffer.apply();
    }
}
