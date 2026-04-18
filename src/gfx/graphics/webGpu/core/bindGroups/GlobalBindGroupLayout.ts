import { Context3D } from "../../Context3D";

export class GlobalBindGroupLayout {
    public static getGlobalDataBindGroupLayout(ctx: Context3D): GPUBindGroupLayout {
        return ctx.cache(GlobalBindGroupLayout, () => {
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

            return ctx.device.createBindGroupLayout({ entries });
        });
    }
}
