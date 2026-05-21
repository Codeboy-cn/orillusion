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

        // Stencil reference is render-pass state, not pipeline state — it
        // resets to 0 at every renderPassBegin and is not carried by
        // setPipeline. Issue it on every material switch (lastShader change)
        // so two materials sharing the same pipeline but different stencilRef
        // still get the right reference, and so the value survives the
        // per-pass reset after cleanCache(). GPURenderBundleEncoder does not
        // support setStencilReference — bundles inherit it from the outer
        // pass, so we skip it there.
        if ('setStencilReference' in encoder) {
            (encoder as GPURenderPassEncoder).setStencilReference(renderShader.shaderState.stencilRef ?? 0);
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
                if (renderPassState.multisample > 0 && renderPassState.multiTextures && renderPassState.multiTextures[i]) {
                    // Render into the MSAA side-band and resolve into
                    // the single-sample RT — but only for formats that
                    // WebGPU can actually resolve. rgba32float (compress
                    // g-buffer) isn't resolvable; in that case the
                    // multisample samples are discarded after the pass,
                    // which is acceptable because SSR / SSAO / the
                    // compress-gbuffer consumers are not used in the
                    // MSAA path.
                    att.view = renderPassState.multiTextures[i].createView();
                    const fmt = renderTarget.format;
                    const resolvable = (
                        fmt === 'rgba8unorm' || fmt === 'rgba8unorm-srgb' ||
                        fmt === 'bgra8unorm' || fmt === 'bgra8unorm-srgb' ||
                        fmt === 'rgba16float' || fmt === 'r16float' ||
                        fmt === 'rg16float' || fmt === 'r8unorm' || fmt === 'rg8unorm'
                    );
                    if (resolvable) {
                        att.resolveTarget = renderTarget.getGPUView();
                    } else {
                        att.resolveTarget = undefined;
                    }
                } else if (renderPassState.multisample > 0 && renderPassState.renderTargets.length == 1) {
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
                // Create the swapchain view in the publicized
                // `presentationFormat` (sRGB variant). The underlying
                // canvas texture is the non-sRGB configure format,
                // and `viewFormats` registered the sRGB variant so
                // the view does the linear→sRGB encode on write.
                // Match this format to what pipelines were built
                // against — pipelines use `ctx.presentationFormat`.
                const viewDesc: GPUTextureViewDescriptor = {
                    format: this.ctx.presentationFormat,
                };
                if (renderPassState.multisample > 0) {
                    att0.view = renderPassState.multiTexture.createView();
                    att0.resolveTarget = this.ctx.context.getCurrentTexture().createView(viewDesc);
                } else {
                    att0.view = this.ctx.context.getCurrentTexture().createView(viewDesc);
                }
            }
            return command.beginRenderPass(renderPassState.renderPassDescriptor);
        }
    }

    /**
     * Indirect indexed draw — the draw call counts (indexCount, instanceCount,
     * firstIndex, baseVertex, firstInstance) come from a GPU buffer at the
     * given offset. Companion of {@link drawIndexed}; used by GPU-driven
     * culling so the visibility decision and the draw submission both live
     * on the GPU.
     *
     * The `indirect-first-instance` adapter feature must be enabled if the
     * indirect buffer's `firstInstance` field is non-zero (Orillusion
     * requests it in Context3D init).
     */
    public drawIndexedIndirect(encoder: GPURenderPassEncoder, indirectBuffer: GPUBuffer, indirectOffset: GPUSize64) {
        encoder.drawIndexedIndirect(indirectBuffer, indirectOffset);
        this.drawCount++;
    }

    public drawIndexed(encoder: GPURenderPassEncoder, indexCount: GPUSize32,
        instanceCount?: GPUSize32,
        firstIndex?: GPUSize32,
        baseVertex?: GPUSignedOffset32,
        firstInstance?: GPUSize32) {
        // Dynamic geometry (Graphic3D, debug boxes, physics bodies, trails)
        // starts with empty index/instance buffers before any shapes are added,
        // and WebGPU correctly flags drawIndexed(0,...) / drawIndexed(_,0)
        // as "unusual". Nothing to draw is not a draw — skip the call.
        if (!indexCount || (instanceCount !== undefined && !instanceCount)) return;
        encoder.drawIndexed(indexCount, instanceCount, firstIndex, baseVertex, firstInstance);
        this.drawCount++;
    }

    public draw(encoder: GPURenderPassEncoder, vertexCount: GPUSize32,
        instanceCount?: GPUSize32,
        firstVertex?: GPUSize32,
        firstInstance?: GPUSize32) {
        if (!vertexCount || (instanceCount !== undefined && !instanceCount)) return;
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
