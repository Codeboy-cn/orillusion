import { Context3D } from "./Context3D";

export class PipelinePool {
    private static map(ctx: Context3D) {
        return ctx.cache(PipelinePool, () => new Map<string, GPURenderPipeline>());
    }

    public static getSharePipeline(ctx: Context3D, shaderVariant: string) {
        let pipeline = this.map(ctx).get(shaderVariant);
        if (pipeline) {
            return pipeline;
        } else {
            return null;
        }
    }

    public static setSharePipeline(ctx: Context3D, shaderVariant: string, pipeline: GPURenderPipeline) {
        this.map(ctx).set(shaderVariant, pipeline);
    }
}
