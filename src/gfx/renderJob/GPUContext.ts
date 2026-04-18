import { Camera3D } from "../../core/Camera3D";
import { GeometryBase } from "../../core/geometry/GeometryBase";
import { ProfilerUtil } from "../../util/ProfilerUtil";
import { bindCtx, Context3D, _registerGpuContextFactory } from "../graphics/webGpu/Context3D";
import { GlobalBindGroup } from "../graphics/webGpu/core/bindGroups/GlobalBindGroup";
import { Texture } from "../graphics/webGpu/core/texture/Texture";
import { ComputeShader } from "../graphics/webGpu/shader/ComputeShader";
import { RenderShaderPass } from "../graphics/webGpu/shader/RenderShaderPass";
import { RendererPassState } from "./passRenderer/state/RendererPassState";

/**
 * Per-Context3D GPU command/pipeline state. Owned by exactly one Context3D
 * via `Context3D.gpuContext`. Multi-engine isolation: no mutable state is
 * shared across engines. Access via `ctx.gpuContext.foo()`.
 */
export class GPUContextInstance {
    public readonly ctx: Context3D;

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

    constructor(ctx: Context3D) {
        this.ctx = ctx;
    }

    public bindPipeline(encoder: GPURenderPassEncoder | GPURenderBundleEncoder, renderShader: RenderShaderPass) {
        if (this.lastShader != renderShader) {
            this.lastShader = renderShader;
        } else {
            return false;
        }

        if (this.lastPipeline != renderShader.pipeline) {
            this.lastPipeline = renderShader.pipeline;
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

    public bindCamera(encoder: GPURenderPassEncoder | GPURenderBundleEncoder, camera: Camera3D) {
        let cameraBindGroup = GlobalBindGroup.getCameraGroup(camera);
        encoder.setBindGroup(0, cameraBindGroup.globalBindGroup);
    }

    public bindGeometryBuffer(encoder: GPURenderPassEncoder | GPURenderBundleEncoder, geometry: GeometryBase) {
        if (this.lastGeometry != geometry) {
            this.lastGeometry = geometry;

            if (geometry.indicesBuffer) {
                const idx = geometry.indicesBuffer.indicesGPUBuffer;
                if (!idx._boundCtx) bindCtx(idx, this.ctx);
                encoder.setIndexBuffer(idx.buffer, geometry.indicesBuffer.indicesFormat);
            }

            let vertexBuffer = geometry.vertexBuffer.vertexGPUBuffer;
            if (vertexBuffer && !vertexBuffer._boundCtx) bindCtx(vertexBuffer, this.ctx);
            let vertexBufferLayouts = geometry.vertexBuffer.vertexBufferLayouts;
            for (let i = 0; i < vertexBufferLayouts.length; i++) {
                const vbLayout = vertexBufferLayouts[i];
                encoder.setVertexBuffer(i, vertexBuffer.buffer, vbLayout.offset, vbLayout.size);
            }
        }
    }

    public cleanCache() {
        this.lastGeometry = null;
        this.lastPipeline = null;
        this.lastShader = null;
    }

    public createPipeline(gpuRenderPipeline: GPURenderPipelineDescriptor) {
        ProfilerUtil.countStart("GPUContext", "pipeline");
        return this.ctx.device.createRenderPipeline(gpuRenderPipeline);
    }

    public beginCommandEncoder(): GPUCommandEncoder {
        ProfilerUtil.countStart("GPUContext", "beginCommandEncoder");
        if (this.LastCommand) {
            this.LastCommandDevice.queue.submit([this.LastCommand.finish()]);
        }
        this.LastCommandDevice = this.ctx.device;
        this.LastCommand = this.LastCommandDevice.createCommandEncoder();
        return this.LastCommand;
    }

    public endCommandEncoder(command: GPUCommandEncoder) {
        if (this.LastCommand == command) {
            this.LastCommandDevice.queue.submit([this.LastCommand.finish()]);
            this.LastCommand = null;
            this.LastCommandDevice = null;
            ProfilerUtil.countStart("GPUContext", "endCommandEncoder");
        }
    }

    public recordBundleEncoder(des: GPURenderBundleEncoderDescriptor): GPURenderBundleEncoder {
        return this.ctx.device.createRenderBundleEncoder(des);
    }

    public beginRenderPass(command: GPUCommandEncoder, renderPassState: RendererPassState): GPURenderPassEncoder {
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
                    att0.resolveTarget = this.ctx.context.getCurrentTexture().createView();
                } else {
                    att0.view = this.ctx.context.getCurrentTexture().createView();
                }
            }
            return command.beginRenderPass(renderPassState.renderPassDescriptor);
        }
    }

    public drawIndexed(encoder: GPURenderPassEncoder, indexCount: GPUSize32,
        instanceCount?: GPUSize32,
        firstIndex?: GPUSize32,
        baseVertex?: GPUSignedOffset32,
        firstInstance?: GPUSize32) {
        encoder.drawIndexed(indexCount, instanceCount, firstIndex, baseVertex, firstInstance);
        this.drawCount++;
    }

    public draw(encoder: GPURenderPassEncoder, vertexCount: GPUSize32,
        instanceCount?: GPUSize32,
        firstVertex?: GPUSize32,
        firstInstance?: GPUSize32) {
        encoder.draw(vertexCount, instanceCount, firstVertex, firstInstance);
        this.drawCount++;
    }

    public endPass(encoder: GPURenderPassEncoder) {
        encoder.insertDebugMarker("end")
        encoder.end();
    }

    public computeCommand(command: GPUCommandEncoder, computes: ComputeShader[]) {
        let computePass = command.beginComputePass();
        for (let i = 0; i < computes.length; i++) {
            const compute = computes[i];
            compute.compute(computePass);
        }
        computePass.end();
    }

    public copyTexture(command: GPUCommandEncoder, source: Texture, dest: Texture) {
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

// Register the instance factory so Context3D.ts can lazy-materialize
// `gpuContext` without statically importing this module (circular).
_registerGpuContextFactory((ctx) => new GPUContextInstance(ctx));
