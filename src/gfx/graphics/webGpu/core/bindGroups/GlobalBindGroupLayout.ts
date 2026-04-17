import { webGPUContext, perContextResource } from "../../Context3D";

export class GlobalBindGroupLayout {

    private static _cache = perContextResource<GPUBindGroupLayout>();

    public static getGlobalDataBindGroupLayout(): GPUBindGroupLayout {
        return this._cache(() => {
            let entries: GPUBindGroupLayoutEntry[] = [];
            entries.push({
                binding: 0,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                buffer: {
                    type: 'uniform',
                },
            });

            entries.push({
                binding: 1,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                buffer: {
                    type: 'read-only-storage',
                },
            });

            return webGPUContext.device.createBindGroupLayout({ entries });
        });
    }
}
