import { Matrix4 } from '../../../../../math/Matrix4';
import { UUID } from '../../../../../util/Global';
import { bindCtx, Context3D } from '../../Context3D';
import { MatrixGPUBuffer } from '../buffer/MatrixGPUBuffer';
/**
 * @author sirxu
 * @internal
 * @group GFX
 */
export class MatrixBindGroup {
    public uuid: string;
    public index: number;
    public usage: number;
    public groupBufferSize: number;
    public matrixBufferDst: MatrixGPUBuffer;
    constructor(ctx: Context3D) {
        this.uuid = UUID();
        this.groupBufferSize = 0;
        this.usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
        this.cacheWorldMatrix(ctx);
    }


    private cacheWorldMatrix(ctx: Context3D) {
        this.groupBufferSize = Matrix4.maxCount * Matrix4.blockBytes;
        this.matrixBufferDst = new MatrixGPUBuffer(this.groupBufferSize / 4);
        bindCtx(this.matrixBufferDst, ctx);
        this.matrixBufferDst.visibility = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE
        this.matrixBufferDst.buffer.label = this.groupBufferSize.toString();
    }

    writeBuffer(len: number) {
        const matBytes = Matrix4.dynamicMatrixBytes;
        this.matrixBufferDst.mapAsyncWrite(matBytes, len);
    }

}
