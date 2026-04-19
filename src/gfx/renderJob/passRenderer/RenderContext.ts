import { Context3D } from "../../graphics/webGpu/Context3D";
import { WebGPUDescriptorCreator } from "../../graphics/webGpu/descriptor/WebGPUDescriptorCreator";
import { GPUContextInstance } from "../GPUContext";
import { RTFrame } from "../frame/RTFrame";
import { RendererPassState } from "./state/RendererPassState";

export class RenderContext {
    public command: GPUCommandEncoder;
    public encoder: GPURenderPassEncoder;
    public gpu: GPUContextInstance;
    private ctx: Context3D;
    private rendererPassStates: RendererPassState[];
    private rtFrame: RTFrame;

    constructor(ctx: Context3D, rtFrame: RTFrame) {
        this.ctx = ctx;
        this.rtFrame = rtFrame;
        this.rendererPassStates = [];
    }

    public clean() {
        this.rendererPassStates.length = 0;
        this.gpu.cleanCache();
    }

    /**
     * continue renderer pass state
     * @returns
     */
    public beginContinueRendererPassState(color_loadOp: GPULoadOp = 'load', depth_loadOp: GPULoadOp = 'load') {
        if (this.rendererPassStates.length > 0) {
            let splitRtFrame = this.rtFrame.clone();
            for (const iterator of splitRtFrame.rtDescriptors) {
                iterator.loadOp = `load`;
            }
            splitRtFrame.depthLoadOp = depth_loadOp;
            let splitRendererPassState = WebGPUDescriptorCreator.createRendererPassState(this.ctx, splitRtFrame, color_loadOp);
            this.rendererPassStates.push(splitRendererPassState);
            return splitRendererPassState;
        } else {
            this.rtFrame.depthLoadOp = depth_loadOp;
            let splitRendererPassState = WebGPUDescriptorCreator.createRendererPassState(this.ctx, this.rtFrame, color_loadOp);
            if (splitRendererPassState.renderPassDescriptor?.colorAttachments?.[0]) {
                (splitRendererPassState.renderPassDescriptor.colorAttachments[0] as any).loadOp = color_loadOp;
            }
            this.rendererPassStates.push(splitRendererPassState);
            return splitRendererPassState;
        }
    }

    public get rendererPassState() {
        return this.rendererPassStates[this.rendererPassStates.length - 1];
    }

    public beginOpaqueRenderPass() {
        this.beginContinueRendererPassState('clear', 'clear');
        this.begineNewCommand();
        this.beginNewEncoder();
    }

    public beginTransparentRenderPass() {
        this.beginContinueRendererPassState('load', 'load');
        this.begineNewCommand();
        this.beginNewEncoder();
    }

    public specialtRenderPass() {
        this.beginContinueRendererPassState('load', 'load');
        this.begineNewCommand();
        this.beginNewEncoder();
    }

    public endRenderPass() {
        this.endEncoder();
        this.endCommand();
    }

    public begineNewCommand(): GPUCommandEncoder {
        this.command = this.gpu.beginCommandEncoder();
        return this.command;
    }

    public endCommand() {
        this.gpu.endCommandEncoder(this.command);
        this.command = null;
    }

    public beginNewEncoder() {
        this.encoder = this.gpu.beginRenderPass(this.command, this.rendererPassState);
        return this.encoder;
    }

    public endEncoder() {
        this.gpu.endPass(this.encoder);
        this.encoder = null;
    }

}
