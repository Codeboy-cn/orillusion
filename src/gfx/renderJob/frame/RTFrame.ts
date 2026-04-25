import { RenderTexture } from "../../../textures/RenderTexture";
import { RTDescriptor } from "../../graphics/webGpu/descriptor/RTDescriptor";

export class RTFrame {
    public label: string;
    public customSize: boolean = false;
    public renderTargets: RenderTexture[];
    public rtDescriptors: RTDescriptor[];

    public zPreTexture: RenderTexture;
    public depthTexture: RenderTexture;

    public depthViewIndex: number = 0;
    public depthCleanValue: number = 1;
    public depthLoadOp: GPULoadOp = `clear`;
    public isOutTarget: boolean = true;
    /** MSAA sample count — 0 disables MSAA (default). When non-zero,
     *  {@link WebGPUDescriptorCreator} allocates side-band multisample
     *  textures and flags the pass state so pipelines compile with the
     *  matching sample count. */
    public sampleCount: number = 0;

    constructor(attachments: RenderTexture[], rtDescriptors: RTDescriptor[], depthTexture?: RenderTexture, zPreTexture?: RenderTexture, isOutTarget: boolean = true) {
        this.renderTargets = attachments;
        this.rtDescriptors = rtDescriptors;
        this.depthTexture = depthTexture;
        this.zPreTexture = zPreTexture;
        this.isOutTarget = isOutTarget;
    }

    public clone2Frame(rtFrame: RTFrame) {
        rtFrame.renderTargets.push(...this.renderTargets.concat());
        for (let i = 0; i < this.rtDescriptors.length; i++) {
            const des = this.rtDescriptors[i];
            let rtDes = new RTDescriptor();
            rtDes.loadOp = des.loadOp;
            rtDes.storeOp = des.storeOp;
            rtDes.clearValue = des.clearValue;
            rtFrame.rtDescriptors.push(rtDes);
        }
        rtFrame.depthTexture = this.depthTexture;
        rtFrame.zPreTexture = this.zPreTexture;
        rtFrame.customSize = this.customSize;
    }

    public clone() {
        let rtFrame = new RTFrame([], []);
        this.clone2Frame(rtFrame);
        return rtFrame;
    }
}