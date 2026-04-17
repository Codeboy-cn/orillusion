import { Camera3D } from "../../core/Camera3D";
import { GeometryBase } from "../../core/geometry/GeometryBase";
import { ProfilerUtil } from "../../util/ProfilerUtil";
import { Context3D, webGPUContext } from "../graphics/webGpu/Context3D";
import { GlobalBindGroup } from "../graphics/webGpu/core/bindGroups/GlobalBindGroup";
import { Texture } from "../graphics/webGpu/core/texture/Texture";
import { ComputeShader } from "../graphics/webGpu/shader/ComputeShader";
import { RenderShaderPass } from "../graphics/webGpu/shader/RenderShaderPass";
import { RendererPassState } from "./passRenderer/state/RendererPassState";

/**
 * Per-Context3D state for GPUContext. Swapped automatically based on the
 * currently-active `webGPUContext` so multiple engines don't cross-talk
 * through `lastGeometry` / `LastCommand` etc.
 * @internal
 */
class GPUContextState {
    public lastGeometry: GeometryBase = null;
    public lastPipeline: GPURenderPipeline = null;
    public lastShader: RenderShaderPass = null;
    public drawCount: number = 0;
    public renderPassCount: number = 0;
    public geometryCount: number = 0;
    public pipelineCount: number = 0;
    public matrixCount: number = 0;
    public lastRenderPassState: RendererPassState = null;
    public LastCommand: GPUCommandEncoder = null;
    public LastCommandDevice: GPUDevice = null;
}

const _states: WeakMap<Context3D, GPUContextState> = new WeakMap();

function _state(ctx: Context3D = webGPUContext): GPUContextState {
    let s = _states.get(ctx);
    if (!s) {
        s = new GPUContextState();
        _states.set(ctx, s);
    }
    return s;
}

/**
 * WebGPU api use context. All mutable fields are per-Context3D so multiple
 * Engine3D instances do not share `lastGeometry` / `LastCommand` etc.
 */
export class GPUContext {
    public static get lastGeometry(): GeometryBase { return _state().lastGeometry; }
    public static set lastGeometry(v: GeometryBase) { _state().lastGeometry = v; }

    public static get lastPipeline(): GPURenderPipeline { return _state().lastPipeline; }
    public static set lastPipeline(v: GPURenderPipeline) { _state().lastPipeline = v; }

    public static get lastShader(): RenderShaderPass { return _state().lastShader; }
    public static set lastShader(v: RenderShaderPass) { _state().lastShader = v; }

    public static get drawCount(): number { return _state().drawCount; }
    public static set drawCount(v: number) { _state().drawCount = v; }

    public static get renderPassCount(): number { return _state().renderPassCount; }
    public static set renderPassCount(v: number) { _state().renderPassCount = v; }

    public static get geometryCount(): number { return _state().geometryCount; }
    public static set geometryCount(v: number) { _state().geometryCount = v; }

    public static get pipelineCount(): number { return _state().pipelineCount; }
    public static set pipelineCount(v: number) { _state().pipelineCount = v; }

    public static get matrixCount(): number { return _state().matrixCount; }
    public static set matrixCount(v: number) { _state().matrixCount = v; }

    public static get lastRenderPassState(): RendererPassState { return _state().lastRenderPassState; }
    public static set lastRenderPassState(v: RendererPassState) { _state().lastRenderPassState = v; }

    public static get LastCommand(): GPUCommandEncoder { return _state().LastCommand; }
    public static set LastCommand(v: GPUCommandEncoder) { _state().LastCommand = v; }

    public static get LastCommandDevice(): GPUDevice { return _state().LastCommandDevice; }
    public static set LastCommandDevice(v: GPUDevice) { _state().LastCommandDevice = v; }

    /**
     * renderPipeline before render need bind pipeline
     * @param encoder current GPURenderPassEncoder {@link GPURenderPassEncoder } {@link GPURenderBundleEncoder }
     * @param renderShader render pass shader {@link RenderShaderPass }
     * @returns
     */
    public static bindPipeline(encoder: GPURenderPassEncoder | GPURenderBundleEncoder, renderShader: RenderShaderPass) {
        const s = _state();
        if (s.lastShader != renderShader) {
            s.lastShader = renderShader;
        } else {
            return false;
        }

        if (s.lastPipeline != renderShader.pipeline) {
            s.lastPipeline = renderShader.pipeline;
            encoder.setPipeline(renderShader.pipeline);
        }

        for (let i = 1; i < renderShader.bindGroups.length; i++) {
            const bindGroup = renderShader.bindGroups[i];
            if (bindGroup) {
                encoder.setBindGroup(i, bindGroup);
            }
        }
        return true;
    }

    /**
     * render before need make sure use camera
     * @param encoder current GPURenderPassEncoder {@link GPURenderPassEncoder } {@link GPURenderBundleEncoder }
     * @param camera use camera {@link Camera3D}
     */
    public static bindCamera(encoder: GPURenderPassEncoder | GPURenderBundleEncoder, camera: Camera3D) {
        let cameraBindGroup = GlobalBindGroup.getCameraGroup(camera);
        encoder.setBindGroup(0, cameraBindGroup.globalBindGroup);
    }

    /**
     * bind geometry vertex buffer to current render pipeline
     * @param encoder current GPURenderPassEncoder {@link GPURenderPassEncoder } {@link GPURenderBundleEncoder }
     * @param geometry engine geometry
     * @param offset geometry buffer bytes offset
     * @param size geometry buffer bytes length
     */
    public static bindGeometryBuffer(encoder: GPURenderPassEncoder | GPURenderBundleEncoder, geometry: GeometryBase) {
        const s = _state();
        if (s.lastGeometry != geometry) {
            s.lastGeometry = geometry;

            if (geometry.indicesBuffer)
                encoder.setIndexBuffer(geometry.indicesBuffer.indicesGPUBuffer.buffer, geometry.indicesBuffer.indicesFormat);

            let vertexBuffer = geometry.vertexBuffer.vertexGPUBuffer;
            let vertexBufferLayouts = geometry.vertexBuffer.vertexBufferLayouts;
            for (let i = 0; i < vertexBufferLayouts.length; i++) {
                const vbLayout = vertexBufferLayouts[i];
                encoder.setVertexBuffer(i, vertexBuffer.buffer, vbLayout.offset, vbLayout.size);
            }
        }
    }

    /**
     * begin or end clean all use cache
     */
    public static cleanCache() {
        const s = _state();
        s.lastGeometry = null;
        s.lastPipeline = null;
        s.lastShader = null;
    }

    /**
     * create a render pipeline
     * @param gpuRenderPipeline {@link GPURenderPipelineDescriptor}
     * @returns
     */
    public static createPipeline(gpuRenderPipeline: GPURenderPipelineDescriptor) {
        ProfilerUtil.countStart("GPUContext", "pipeline");
        let pipeline: GPURenderPipeline = webGPUContext.device.createRenderPipeline(gpuRenderPipeline);
        return pipeline;
    }

    /**
     * auto get webgpu commandEncoder and start a command encoder
     * @returns commandEncoder {@link GPUCommandEncoder}
     */
    public static beginCommandEncoder(): GPUCommandEncoder {
        ProfilerUtil.countStart("GPUContext", "beginCommandEncoder");
        const s = _state();
        if (s.LastCommand) {
            s.LastCommandDevice.queue.submit([s.LastCommand.finish()]);
        }
        s.LastCommandDevice = webGPUContext.device;
        s.LastCommand = s.LastCommandDevice.createCommandEncoder();
        return s.LastCommand;
    }

    /**
     * end CommandEncoder record and submit
     * @param command {@link GPUCommandEncoder}
     */
    public static endCommandEncoder(command: GPUCommandEncoder) {
        const s = _state();
        if (s.LastCommand == command) {
            s.LastCommandDevice.queue.submit([s.LastCommand.finish()]);
            s.LastCommand = null;
            s.LastCommandDevice = null;
            ProfilerUtil.countStart("GPUContext", "endCommandEncoder");
        }
    }

    /**
     * create a renderBundle gpu object by GPURenderBundleEncoderDescriptor
     * @param des {@link GPURenderBundleEncoderDescriptor}
     * @returns renderBundleEncoder {@link GPURenderBundleEncoder}
     */
    public static recordBundleEncoder(des: GPURenderBundleEncoderDescriptor): GPURenderBundleEncoder {
        let bundleEncoder: GPURenderBundleEncoder = webGPUContext.device.createRenderBundleEncoder(des);
        return bundleEncoder;
    }

    /**
     * render pass start return current use gpu renderPassEncoder
     * @param command {@link GPUCommandEncoder}
     * @param renderPassState {@link RendererPassState}
     * @returns encoder {@link GPURenderPassEncoder}
     */
    public static beginRenderPass(command: GPUCommandEncoder, renderPassState: RendererPassState): GPURenderPassEncoder {
        this.cleanCache();
        const s = _state();
        s.renderPassCount++;
        s.lastRenderPassState = renderPassState;
        if (renderPassState.depthTexture) {
            let depth = renderPassState.renderPassDescriptor.depthStencilAttachment;
            depth.view = renderPassState.depthTexture.getGPUView() as any;
        }
        if (renderPassState.renderTargets && renderPassState.renderTargets.length > 0) {
            for (let i = 0; i < renderPassState.renderTargets.length; ++i) {
                const renderTarget = renderPassState.renderTargets[i];
                let att = renderPassState.renderPassDescriptor.colorAttachments[i];
                if (renderPassState.multisample > 0 && renderPassState.renderTargets.length == 1) {
                    att.view = renderPassState.multiTexture.createView();
                    att.resolveTarget = renderTarget.getGPUView();
                } else {
                    att.view = renderTarget.getGPUTexture().createView();
                }
            }
            return command.beginRenderPass(renderPassState.renderPassDescriptor);
        } else {
            let att0 = renderPassState.renderPassDescriptor.colorAttachments[0];
            if (att0) {
                if (renderPassState.multisample > 0) {
                    att0.view = renderPassState.multiTexture.createView();
                    att0.resolveTarget = webGPUContext.context.getCurrentTexture().createView();
                } else {
                    att0.view = webGPUContext.context.getCurrentTexture().createView();
                }
            }
            return command.beginRenderPass(renderPassState.renderPassDescriptor);
        }
    }

    /**
     * Start the rendering process to draw any pipes
     * @param encoder
     * @param indexCount
     * @param instanceCount
     * @param firstIndex
     * @param baseVertex
     * @param firstInstance
     */
    public static drawIndexed(encoder: GPURenderPassEncoder, indexCount: GPUSize32,
        instanceCount?: GPUSize32,
        firstIndex?: GPUSize32,
        baseVertex?: GPUSignedOffset32,
        firstInstance?: GPUSize32) {
        encoder.drawIndexed(indexCount, instanceCount, firstIndex, baseVertex, firstInstance);
        _state().drawCount++;
    }

    public static draw(encoder: GPURenderPassEncoder, vertexCount: GPUSize32,
        instanceCount?: GPUSize32,
        firstVertex?: GPUSize32,
        firstInstance?: GPUSize32) {
        encoder.draw(vertexCount, instanceCount, firstVertex, firstInstance);
        _state().drawCount++;
    }

    /**
     * The GPU must be informed of the end of encoder recording
     * @param encoder
     */
    public static endPass(encoder: GPURenderPassEncoder) {
        encoder.insertDebugMarker("end")
        encoder.end();
    }

    /**
     * Perform the final calculation and submit the Shader to the GPU
     * @param command
     * @param computes
     */
    public static computeCommand(command: GPUCommandEncoder, computes: ComputeShader[]) {
        let computePass = command.beginComputePass();
        for (let i = 0; i < computes.length; i++) {
            const compute = computes[i];
            compute.compute(computePass);
        }
        computePass.end();
    }

    public static copyTexture(command: GPUCommandEncoder, source: Texture, dest: Texture) {
        command.copyTextureToTexture(
            {
                texture: source.getGPUTexture(),
                mipLevel: 0,
                origin: { x: 0, y: 0, z: 0 },
            },
            {
                texture: dest.getGPUTexture(),
                mipLevel: 0,
                origin: { x: 0, y: 0, z: 0 },
            },
            {
                width: dest.width,
                height: dest.height,
                depthOrArrayLayers: 1,
            },
        );
    }
}
