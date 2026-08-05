import { MemoryInfo } from './MemoryInfo';

/**
 * @internal
 * @group Core
 */
export class MemoryDO {
    public shareDataBuffer: ArrayBuffer;
    private _byteOffset: number = 0;

    public allocation(byteSize: number) {
        // The condition used to be inverted: a growth request kept the
        // too-small buffer (every later allocation_node returned null)
        // while an equal-size request orphaned the existing buffer.
        if (!this.shareDataBuffer) {
            this.shareDataBuffer = new ArrayBuffer(byteSize);
        } else if (this.shareDataBuffer.byteLength < byteSize) {
            // Grow: allocate the larger buffer and migrate existing data.
            const grown = new ArrayBuffer(byteSize);
            new Uint8Array(grown).set(new Uint8Array(this.shareDataBuffer));
            this.shareDataBuffer = grown;
        } else if (this.shareDataBuffer.byteLength > byteSize) {
            // Shrink: replace with an exact-size buffer — callers size
            // their GPU buffers from the requested byteSize and upload
            // the whole shareDataBuffer.
            this.shareDataBuffer = new ArrayBuffer(byteSize);
        }
        // Equal size: reuse the existing buffer, just reset the cursor.
        this._byteOffset = 0;
    }

    public allocation_node(byteSize: number): MemoryInfo {
        // Keep node starts 4-byte aligned: after 1/2-byte fields an
        // unaligned offset makes Float32Array/Int32Array views over the
        // node throw a RangeError.
        this._byteOffset = (this._byteOffset + 3) & ~3;
        if (this._byteOffset + byteSize > this.shareDataBuffer.byteLength) {
            console.error('memory not enough!', this._byteOffset, byteSize, this.shareDataBuffer.byteLength);
            return null;
        }

        let memoryInfo = new MemoryInfo();
        memoryInfo.byteOffset = this._byteOffset;
        memoryInfo.byteSize = byteSize;
        memoryInfo.dataBytes = new DataView(this.shareDataBuffer, this._byteOffset, memoryInfo.byteSize);
        this._byteOffset += memoryInfo.byteSize;
        return memoryInfo;
    }

    public allocation_memory(memoryInfo: MemoryInfo): MemoryInfo {
        this._byteOffset = (this._byteOffset + 3) & ~3;
        if (this._byteOffset + memoryInfo.byteSize > this.shareDataBuffer.byteLength) {
            console.error('memory not enough!', this._byteOffset, memoryInfo.byteSize, this.shareDataBuffer.byteLength);
            return null;
        }

        memoryInfo.byteOffset = this._byteOffset;
        memoryInfo.dataBytes = new DataView(this.shareDataBuffer, this._byteOffset, memoryInfo.byteSize);
        this._byteOffset += memoryInfo.byteSize;
        return memoryInfo;
    }

    public reset() {
        this._byteOffset = 0;
    }

    public destroy(force?: boolean) {
        this.shareDataBuffer = null;
        this._byteOffset = 0;
    }
}

// export let MemoryPool = new _MemoryPool();
