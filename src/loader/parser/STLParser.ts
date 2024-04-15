import { GeometryBase, MeshRenderer, Object3D, Quaternion, LitMaterial, Vector2, Vector3, VertexAttributeName } from '../..';
import { ParserBase } from './ParserBase';
import { ParserFormat } from './ParserFormat';

/**
 * STL file parser
 * @internal
 * @group Loader
 */
export class STLParser extends ParserBase {
    static format: ParserFormat = ParserFormat.BIN;

    public parseBuffer(buffer: ArrayBuffer) {
        console.warn(buffer.byteLength);

        let reader = new BinaryReader(buffer);

        if (this.isBinaryFile(reader)) {
            this.data = this.parserBinary(reader);
        } else {
            this.data = this.parserASCII(reader);
        }
    }

    /**
     * Verify parsing validity
     * @param ret
     * @returns
     */
    public verification(): boolean {
        if (this.data) {
            return true;
        }
        throw new Error('Method not implemented.');
    }

    protected isBinaryFile(reader: BinaryReader): boolean {
        let flag = reader.readString(6);
        return flag !== "solid ";
    }

    protected parserBinary(reader: BinaryReader): Object3D {
        reader.reset();

        let header = reader.readUint8Array(80)

        let numTriangle = reader.readUint32();

        let normalArray = new Float32Array(3 * 3 * numTriangle);
        let vertexArray = new Float32Array(3 * 3 * numTriangle);
        let colorArray = new Float32Array(4 * 3 * numTriangle);

        let indicesCount = numTriangle * 3;
        let indicesArray = indicesCount > 65535 ? new Uint32Array(indicesCount) : new Uint16Array(indicesCount);

        for (let i = 0; i < numTriangle; i++) {
            let normal = reader.readVector3(Vector3.HELP_0);
            let vertex1 = reader.readVector3(Vector3.HELP_1);
            let vertex2 = reader.readVector3(Vector3.HELP_2);
            let vertex3 = reader.readVector3(Vector3.HELP_3);
            let attributeByteCount = reader.readUint16();

            let normalIndex = i * 9;
            normalArray[normalIndex + 0] = normal.x;
            normalArray[normalIndex + 1] = normal.y;
            normalArray[normalIndex + 2] = normal.z;

            normalArray[normalIndex + 3] = normal.x;
            normalArray[normalIndex + 4] = normal.y;
            normalArray[normalIndex + 5] = normal.z;

            normalArray[normalIndex + 6] = normal.x;
            normalArray[normalIndex + 7] = normal.y;
            normalArray[normalIndex + 8] = normal.z;

            let vertexIndex = i * 9;
            vertexArray[vertexIndex + 0] = vertex1.x;
            vertexArray[vertexIndex + 1] = vertex1.y;
            vertexArray[vertexIndex + 2] = vertex1.z;

            vertexArray[vertexIndex + 3] = vertex2.x;
            vertexArray[vertexIndex + 4] = vertex2.y;
            vertexArray[vertexIndex + 5] = vertex2.z;

            vertexArray[vertexIndex + 6] = vertex3.x;
            vertexArray[vertexIndex + 7] = vertex3.y;
            vertexArray[vertexIndex + 8] = vertex3.z;

            // TODO: if VisCAM and SolidView file, attributeByteCount is RGBA5551
            let colorIndex = i * 12;
            colorArray[colorIndex + 0] = 1.0;
            colorArray[colorIndex + 1] = 1.0;
            colorArray[colorIndex + 2] = 1.0;
            colorArray[colorIndex + 3] = 1.0;

            colorArray[colorIndex + 4] = 1.0;
            colorArray[colorIndex + 5] = 1.0;
            colorArray[colorIndex + 6] = 1.0;
            colorArray[colorIndex + 7] = 1.0;

            colorArray[colorIndex + 8] = 1.0;
            colorArray[colorIndex + 9] = 1.0;
            colorArray[colorIndex + 10] = 1.0;
            colorArray[colorIndex + 11] = 1.0;

            let indicesIndex = i * 3;
            indicesArray[indicesIndex + 0] = indicesIndex + 0;
            indicesArray[indicesIndex + 1] = indicesIndex + 1;
            indicesArray[indicesIndex + 2] = indicesIndex + 2;
        }

        let geometry = new GeometryBase();
        geometry.setIndices(indicesArray);
        geometry.setAttribute(VertexAttributeName.position, vertexArray);
        geometry.setAttribute(VertexAttributeName.normal, normalArray);
        geometry.setAttribute(VertexAttributeName.color, colorArray);
        geometry.addSubGeometry({
            indexStart: 0,
            indexCount: indicesArray.length,
            vertexStart: 0,
            vertexCount: 0,
            firstStart: 0,
            index: 0,
            topology: 0,
        });

        let obj = new Object3D();
        let mr = obj.addComponent(MeshRenderer);
        mr.geometry = geometry;
        mr.material = new LitMaterial();
        return obj;
    }

    protected parserASCII(reader: BinaryReader): Object3D {
        // let str = String.fromCharCode.apply(null, new Uint8Array(reader.rawBuffer));
        reader.reset();

        const solidRegex = /solid\s+(.*?)\s*$/;
        let nameResult = solidRegex.exec(reader.readLine());
        if (!nameResult || nameResult.length < 1) {
            throw new Error(`parse stl error`);
        }

        const name = nameResult[1];

        let triangleCount = 0;
        let normalArray: number[] = [];
        let vertexArray: number[] = [];
        // let colorArray = new Float32Array();

        while (reader.readPos < reader.byteLength) {
            const line = reader.readLine();

            if (line.includes('endsolid ')) {
                break;
            }

            triangleCount++;

            const normalRegex = /facet\s+normal\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/;
            let normalResult = normalRegex.exec(line);
            if (!normalResult || normalResult.length < 3) {
                throw new Error(`parse stl error: ${line}`);
            }
            let normal = Vector3.HELP_0;
            normal.x = parseFloat(normalResult[1]);
            normal.y = parseFloat(normalResult[2]);
            normal.z = parseFloat(normalResult[3]);

            normalArray.push(normal.x);
            normalArray.push(normal.y);
            normalArray.push(normal.z);

            normalArray.push(normal.x);
            normalArray.push(normal.y);
            normalArray.push(normal.z);

            normalArray.push(normal.x);
            normalArray.push(normal.y);
            normalArray.push(normal.z);
    
            if (reader.readLine().trim() !== 'outer loop') {
                throw new Error(`parse stl error: ${line}`);
            }
    
            const vertexRegex = /vertex\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/;
            let vertex1Result = vertexRegex.exec(reader.readLine());
            let vertex2Result = vertexRegex.exec(reader.readLine());
            let vertex3Result = vertexRegex.exec(reader.readLine());
    
            vertexArray.push(parseFloat(vertex1Result[1]));
            vertexArray.push(parseFloat(vertex1Result[2]));
            vertexArray.push(parseFloat(vertex1Result[3]));
    
            vertexArray.push(parseFloat(vertex2Result[1]));
            vertexArray.push(parseFloat(vertex2Result[2]));
            vertexArray.push(parseFloat(vertex2Result[3]));
    
            vertexArray.push(parseFloat(vertex3Result[1]));
            vertexArray.push(parseFloat(vertex3Result[2]));
            vertexArray.push(parseFloat(vertex3Result[3]));
    
            if (reader.readLine().trim() !== 'endloop') {
                throw new Error(`parse stl error: ${line}`);
            }
    
            if (reader.readLine().trim() !== 'endfacet') {
                throw new Error(`parse stl error: ${line}`);
            }
        }

        let indicesArray = triangleCount > 65535 ? new Uint32Array(3 * triangleCount) : new Uint16Array(3 * triangleCount);
        for (let i = 0; i < triangleCount; i++) {
            let indicesIndex = i * 3;
            indicesArray[indicesIndex + 0] = indicesIndex + 0;
            indicesArray[indicesIndex + 1] = indicesIndex + 1;
            indicesArray[indicesIndex + 2] = indicesIndex + 2;
        }

        let geometry = new GeometryBase();
        geometry.setIndices(indicesArray);
        geometry.setAttribute(VertexAttributeName.position, new Float32Array(vertexArray));
        geometry.setAttribute(VertexAttributeName.normal, new Float32Array(normalArray));
        // geometry.setAttribute(VertexAttributeName.color, new Float32Array(colorArray));
        geometry.addSubGeometry({
            indexStart: 0,
            indexCount: indicesArray.length,
            vertexStart: 0,
            vertexCount: 0,
            firstStart: 0,
            index: 0,
            topology: 0,
        });

        let obj = new Object3D();
        let mr = obj.addComponent(MeshRenderer);
        mr.geometry = geometry;
        mr.material = new LitMaterial();
        return obj;
    }
}

// TODO: move to ParserBase
class BinaryReader {
    public readPos: number = 0;
    public littleEndian: boolean = true;
    public readonly byteLength: number;
    public readonly rawBuffer: ArrayBuffer;

    protected data: DataView;

    constructor(buffer: ArrayBuffer) {
        this.rawBuffer = buffer;
        this.data = new DataView(buffer);
        this.byteLength = this.data.byteLength;
    }

    public reset(buffer?: ArrayBuffer) {
        this.readPos = 0;
        if (buffer) this.data = new DataView(buffer);
    }

    public readInt8(): number {
        return this.data.getInt8(this.readPos++);
    }

    public readUint8(): number {
        return this.data.getUint8(this.readPos++);
    }

    public readInt16(): number {
        let result = this.data.getInt16(this.readPos, this.littleEndian);
        this.readPos += 2;
        return result;
    }

    public readUint16(): number {
        let result = this.data.getUint16(this.readPos, this.littleEndian);
        this.readPos += 2;
        return result;
    }

    public readInt32(): number {
        let result = this.data.getInt32(this.readPos, this.littleEndian);
        this.readPos += 4;
        return result;
    }

    public readUint32(): number {
        let result = this.data.getUint32(this.readPos, this.littleEndian);
        this.readPos += 4;
        return result;
    }

    public readInt64(): bigint {
        let result = this.data.getBigInt64(this.readPos, this.littleEndian);
        this.readPos += 8;
        return result;
    }

    public readUint64(): bigint {
        let result = this.data.getBigUint64(this.readPos, this.littleEndian);
        this.readPos += 8;
        return result;
    }

    public readFloat32(): number {
        let result = this.data.getFloat32(this.readPos, this.littleEndian);
        this.readPos += 4;
        return result;
    }

    public readFloat64(): number {
        let result = this.data.getFloat64(this.readPos, this.littleEndian);
        this.readPos += 8;
        return result;
    }

    public readInt8Array(length: number): Int8Array {
        let result = new Int8Array(this.data.buffer, this.data.byteOffset + this.readPos, length);
        this.readPos += Int8Array.BYTES_PER_ELEMENT * length;
        return result;
    }

    public readUint8Array(length: number): Uint8Array {
        let result = new Uint8Array(this.data.buffer, this.data.byteOffset + this.readPos, length);
        this.readPos += Uint8Array.BYTES_PER_ELEMENT * length;
        return result;
    }

    public readInt16Array(length: number): Int16Array {
        let result = new Int16Array(this.data.buffer, this.data.byteOffset + this.readPos, length);
        this.readPos += Int16Array.BYTES_PER_ELEMENT * length;
        return result;
    }

    public readUint16Array(length: number): Uint16Array {
        let result = new Uint16Array(this.data.buffer, this.data.byteOffset + this.readPos, length);
        this.readPos += Uint16Array.BYTES_PER_ELEMENT * length;
        return result;
    }

    public readInt32Array(length: number): Int32Array {
        let result = new Int32Array(this.data.buffer, this.data.byteOffset + this.readPos, length);
        this.readPos += Int32Array.BYTES_PER_ELEMENT * length;
        return result;
    }

    public readUint32Array(length: number): Uint32Array {
        let result = new Uint32Array(this.data.buffer, this.data.byteOffset + this.readPos, length);
        this.readPos += Uint32Array.BYTES_PER_ELEMENT * length;
        return result;
    }

    public readFloat32Array(length: number): Float32Array {
        let result = new Float32Array(this.data.buffer, this.data.byteOffset + this.readPos, length);
        this.readPos += Float32Array.BYTES_PER_ELEMENT * length;
        return result;
    }

    public readFloat64Array(length: number): Float64Array {
        let result = new Float64Array(this.data.buffer, this.data.byteOffset + this.readPos, length);
        this.readPos += Float64Array.BYTES_PER_ELEMENT * length;
        return result;
    }

    public readVector2(dst?: Vector2): Vector2 {
        if (!dst) dst = new Vector2();
        dst.x = this.readFloat32();
        dst.y = this.readFloat32();
        return dst;
    }

    public readVector3(dst?: Vector3): Vector3 {
        if (!dst) dst = new Vector3();
        dst.x = this.readFloat32();
        dst.y = this.readFloat32();
        dst.z = this.readFloat32();
        return dst;
    }

    public readQuaternion(dst?: Quaternion): Quaternion {
        if (!dst) dst = new Quaternion();
        dst.x = this.readFloat32();
        dst.y = this.readFloat32();
        dst.z = this.readFloat32();
        dst.w = this.readFloat32();
        return dst;
    }

    public readString(length: number): string {
        let bytes = this.readUint8Array(length);
        return String.fromCharCode.apply(null, bytes);
    }

    public readLine(EOL: string = '\r\n'): string {
        let first = EOL.charCodeAt(0);
        for (let i = this.readPos; i < this.byteLength; i++) {
            if (this.data.getUint8(i) == first) {
                let isIpentity: boolean = true;
                for (let j = 1; j < EOL.length; j++) {
                    if (EOL.charCodeAt(j) !== this.data.getUint8(i + j)) {
                        isIpentity = false;
                        break;
                    }
                }
                if (isIpentity) {
                    return this.readString(i - this.readPos + EOL.length);
                }
            }
        }
        return this.readString(this.byteLength - this.readPos);
    }
}
