import { Camera3D } from "../../core/Camera3D";
import { GeometryBase } from "../../core/geometry/GeometryBase";
import { ProfilerUtil } from "../../util/ProfilerUtil";
import { webGPUContext } from "../graphics/webGpu/Context3D";
import { GlobalBindGroup } from "../graphics/webGpu/core/bindGroups/GlobalBindGroup";
import { Texture } from "../graphics/webGpu/core/texture/Texture";
import { ComputeShader } from "../graphics/webGpu/shader/ComputeShader";
import { RenderShaderPass } from "../graphics/webGpu/shader/RenderShaderPass";
import { RendererPassState } from "./passRenderer/state/RendererPassState";

/**
 * WebGPU api use context
 */
export class GPUContext {
    public static lastGeometry: GeometryBase;
    public static lastPipeline: GPURenderPipeline;
    public static lastShader: RenderShaderPass;
    public static drawCount: number = 0;
    public static renderPassCount: number = 0;
    public static geometryCount: number = 0;
    public static pipelineCount: number = 0;
    public static matrixCount: number = 0;
    public static lastRenderPassState: RendererPassState;
    public static LastCommand: GPUCommandEncoder;
    /** Device that owns LastCommand. Used to submit to the correct queue when
     *  multiple engines share this static facade. */
    public static LastCommandDevice: GPUDevice;

    /**
     * renderPipeline before render need bind pipeline
     * @param encoder current GPURenderPassEncoder {@link GPURenderPassEncoder } {@link GPURenderBundleEncoder }
     * @param renderShader render pass shader {@link RenderShaderPass }
     * @returns 
     */
    public static bindPipeline(encoder: GPURenderPassEncoder | GPURenderBundleEncoder, renderShader: RenderShaderPass) {
        if (GPUContext.lastShader != renderShader) {
            GPUContext.lastShader = renderShader;
        } else {
            return false;
        }

        if (GPUContext.lastPipeline != renderShader.pipeline) {
            GPUContext.lastPipeline = renderShader.pipeline;
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
        if (this.lastGeometry != geometry) {
            this.lastGeometry = geometry;

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
        this.lastGeometry = null;
        this.lastPipeline = null;
        this.lastShader = null;
    }

    /**
     * create a render pipeline
     * @param gpuRenderPipeline {@link GPURenderPipelineDescriptor}
     * @returns 
     */
    public static createPipeline(gpuRenderPipeline: GPURenderPipelineDescriptor) {
        ProfilerUtil.countStart("GPUContext", "pipeline");
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        let pipeline: GPURenderPipeline = webGPUContext.device.createRenderPipeline(gpuRenderPipeline);
        return pipeline;
    }

    /**
     * auto get webgpu commandEncoder and start a command encoder 
     * @returns commandEncoder {@link GPUCommandEncoder}
     */
    public static beginCommandEncoder(): GPUCommandEncoder {
        ProfilerUtil.countStart("GPUContext", "beginCommandEncoder");
        if (this.LastCommand) {
            // Submit to the device that created LastCommand, not the
            // currently-active shim — the two can differ when multiple
            // engines share this static facade.
            this.LastCommandDevice.queue.submit([this.LastCommand.finish()]);
        }
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        this.LastCommandDevice = webGPUContext.device;
        this.LastCommand = this.LastCommandDevice.createCommandEncoder();
        return this.LastCommand;
    }

    /**
     * end CommandEncoder record and submit
     * @param command {@link GPUCommandEncoder}
     */
    public static endCommandEncoder(command: GPUCommandEncoder) {
        if (this.LastCommand == command) {
            this.LastCommandDevice.queue.submit([this.LastCommand.finish()]);
            this.LastCommand = null;
            this.LastCommandDevice = null;
            ProfilerUtil.countStart("GPUContext", "endCommandEncoder");
        }
    }

    /**
     * create a renderBundle gpu object by GPURenderBundleEncoderDescriptor 
     * @param des {@link GPURenderBundleEncoderDescriptor}
     * @returns renderBundleEncoder {@link GPURenderBundleEncoder}
     */
    public static recordBundleEncoder(des: GPURenderBundleEncoderDescriptor): GPURenderBundleEncoder {
        // eslint-disable-next-line @typescript-eslint/no-deprecated
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
        this.renderPassCount++;
        this.lastRenderPassState = renderPassState;
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
                    // eslint-disable-next-line @typescript-eslint/no-deprecated
                    att0.resolveTarget = webGPUContext.context.getCurrentTexture().createView();
                } else {
                    // eslint-disable-next-line @typescript-eslint/no-deprecated
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
        this.drawCount++;
    }

    public static draw(encoder: GPURenderPassEncoder, vertexCount: GPUSize32,
        instanceCount?: GPUSize32,
        firstVertex?: GPUSize32,
        firstInstance?: GPUSize32) {
        encoder.draw(vertexCount, instanceCount, firstVertex, firstInstance);
        this.drawCount++;
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
