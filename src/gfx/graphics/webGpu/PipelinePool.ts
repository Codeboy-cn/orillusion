import { perContextResource } from "./Context3D";

export class PipelinePool {
    private static _mapStore = perContextResource<Map<string, GPURenderPipeline>>();

    private static map() {
        return this._mapStore(() => new Map<string, GPURenderPipeline>());
    }

    public static getSharePipeline(shaderVariant: string) {
        let pipeline = this.map().get(shaderVariant);
        if (pipeline) {
            return pipeline;
        } else {
            return null;
        }
    }

    public static setSharePipeline(shaderVariant: string, pipeline: GPURenderPipeline) {
        this.map().set(shaderVariant, pipeline);
    }
}
