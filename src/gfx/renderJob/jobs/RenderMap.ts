import { RendererBase } from "../passRenderer/RendererBase";
import { PassType } from "../passRenderer/state/PassType";

export class RendererMap {

    private map: Map<PassType, RendererBase>;
    private passRendererList: RendererBase[];

    constructor() {
        this.map = new Map<PassType, RendererBase>();
        this.passRendererList = [];
    }

    public addRenderer(renderer: RendererBase) {
        if (!this.map.has(renderer.passType)) {
            this.map.set(renderer.passType, renderer);
            // Phase D: the historical `passType <= (1 << 3)` filter
            // was a hack that hid any renderer with PassType >=
            // GI (16) / Cluster (32) / SHADOW (64) / POINT_SHADOW (128)
            // / POST (256) / DEPTH (512) from the per-frame
            // `getAllPassRenderer` loop — their dispatch was hand-
            // written directly in `RendererJob.renderFrame`. With
            // the Frame Graph owning all render ordering, the filter
            // is dead weight: pass renderers now run exclusively
            // through `RenderFeature.execute`, and the passList
            // is only used by the legacy path.
            this.passRendererList.push(renderer);
        } else {
            console.error("same renderer pass repeat!");
        }
    }

    public getRenderer(passType: PassType): RendererBase {
        return this.map.get(passType);
    }

    public getAllRenderer(): Map<PassType, RendererBase> {
        return this.map;
    }

    public getAllPassRenderer(): RendererBase[] {
        return this.passRendererList;
    }
}