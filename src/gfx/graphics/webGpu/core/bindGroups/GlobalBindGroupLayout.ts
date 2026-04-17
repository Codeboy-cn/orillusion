import { Context3D, webGPUContext, perContextResource } from "../../Context3D";

export class GlobalBindGroupLayout {

    // eslint-disable-next-line @typescript-eslint/no-deprecated
    private static _cache = perContextResource<GPUBindGroupLayout>();

    public static getGlobalDataBindGroupLayout(ctx?: Context3D): GPUBindGroupLayout {
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        let resolved = ctx ?? webGPUContext;
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

            return resolved.device.createBindGroupLayout({ entries });
        }, resolved);
    }
}
