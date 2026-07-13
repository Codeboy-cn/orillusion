import { BitmapTexture2D } from '../../../textures/BitmapTexture2D';
import { StringUtil } from '../../../util/StringUtil';
import { FileLoader } from '../../FileLoader';
import { ParserBase } from '../ParserBase';
import { ParserFormat } from '../ParserFormat';
import { GLTF_Info } from './GLTFInfo';
import { GLTFSubParser } from './GLTFSubParser';

/**
 * @internal
 * @group Loader
 */
export class GLBHeader {
    magic: number;
    version: number;
    length: number;
}

/**
 * @internal
 * @group Loader
 */
export class GLBChunk {
    chunkLength: number;
    chunkType: number;
    chunkData: Uint8Array;
}

/**
 * GLB file parser
 * @internal
 * @group Loader
 */
export class GLBParser extends ParserBase {
    static format: ParserFormat = ParserFormat.BIN;

    private _gltf: GLTF_Info;

    /** Parsed glTF info block (populated after parseBuffer/parseJsonAndBuffer). */
    public get gltf(): GLTF_Info {
        return this._gltf;
    }

    public async parseBuffer(buffer: ArrayBuffer) {
        let byteArray = new Uint8Array(buffer);
        byteArray['pos'] = 0;

        if (buffer.byteLength < 12) {
            throw new Error(`GLB file is only ${buffer.byteLength} bytes — no room for a header`);
        }
        const fileHeader: GLBHeader = this.parseHeader(byteArray);

        if (fileHeader.magic != 0x46546c67) {
            throw new Error(`invalid GLB file: bad magic 0x${fileHeader.magic.toString(16)}`);
        }

        if (fileHeader.version !== 2.0) {
            throw new Error(`GLBParser only supports glTF 2.0 — received glTF version ${fileHeader.version}`);
        }

        // Validate the declared total length against what actually
        // arrived: shorter means a truncated download; longer just means
        // trailing garbage we can safely ignore.
        let scanEnd = fileHeader.length;
        if (buffer.byteLength < fileHeader.length) {
            throw new Error(`GLB header declares ${fileHeader.length} bytes but only ${buffer.byteLength} arrived — truncated download?`);
        } else if (buffer.byteLength > fileHeader.length) {
            console.warn(`GLB has ${buffer.byteLength - fileHeader.length} trailing bytes beyond the declared length ${fileHeader.length}; ignoring them.`);
        }

        let chunks: Array<GLBChunk> = [];
        while (byteArray['pos'] < scanEnd) {
            let chunk = this.parseChunk(byteArray, scanEnd);
            chunks.push(chunk);
        }

        if (chunks.length == 0 || chunks[0].chunkType != 0x4e4f534a) {
            throw new Error(`invalid GLB: the first chunk must be the JSON chunk`);
        }

        let gltfJSON = new TextDecoder('utf-8').decode(chunks[0].chunkData);
        let obj = JSON.parse(gltfJSON) as object;
        this._gltf = new GLTF_Info();
        this._gltf = { ...this._gltf, ...obj };
        this._gltf.resources = {};
        // A glTF without buffers is legal (e.g. all-external resources).
        const bufferDefs = this._gltf.buffers ?? [];
        for (let i = 0; i < bufferDefs.length; i++) {
            let buffer = bufferDefs[i];
            if (!chunks[i + 1]) {
                throw new Error(`GLB buffer ${i} expects BIN chunk ${i + 1}, but the file contains only ${chunks.length} chunk(s) — missing BIN chunk`);
            }
            buffer.isParsed = true;
            buffer.dbuffer = chunks[i + 1].chunkData.buffer;
        }

        await this.parseImages();

        let subParser = new GLTFSubParser(this.ctx);
        let nodes = await subParser.parse(this.initUrl, this._gltf, this._gltf.scene);
        subParser.destroy();
        subParser = null;
        if (nodes) {
            this.data = nodes.rootNode;
            return nodes.rootNode;
        }
        return null;
    }

    public async parseJsonAndBuffer(obj: object, bin: ArrayBuffer) {
        this._gltf = new GLTF_Info();
        this._gltf = { ...this._gltf, ...obj };
        this._gltf.resources = {};
        let dbuffer = this._gltf.buffers[0];
        dbuffer.isParsed = true;
        dbuffer.dbuffer = bin;

        await this.parseImages();

        let subParser = new GLTFSubParser(this.ctx);
        let nodes = await subParser.parse(this.initUrl, this._gltf, this._gltf.scene);
        subParser.destroy();
        subParser = null;
        if (nodes) {
            this.data = nodes.rootNode;
            return nodes.rootNode;
        }
        return null;
    }

    /**
     * Materialize every gltf image into `resources`. Images inside a GLB
     * normally reference a bufferView, but the spec also allows external
     * or data: URIs — those used to crash with a TypeError on
     * `image.bufferView.toString()`.
     */
    private async parseImages() {
        if (!this._gltf.images) return;
        for (let i = 0; i < this._gltf.images.length; i++) {
            let image = this._gltf.images[i];
            if (image.uri) {
                // External / data: URI image — legal glTF output. data:
                // URIs are consumed by BitmapTexture2D's base64 branch.
                const url = image.uri.startsWith('data:') ? image.uri : StringUtil.parseUrl(this.baseUrl, image.uri);
                image.name = image.name || StringUtil.getURLName(image.uri);
                const texture = await new FileLoader(this.ctx).loadAsyncBitmapTexture(url);
                texture.name = image.name;
                // Key by the full uri — GLTFSubParser.parseTexture looks
                // uri-images up by `image.uri` first. Name/basename keys
                // collided when two images shared a (base)name.
                this._gltf.resources[image.uri] = texture;
            } else if (image.bufferView !== undefined) {
                // Key bufferView images by their unique bufferView index —
                // GLTFSubParser.parseTexture uses the same key. Keying by a
                // user-supplied image.name collided on duplicate names.
                const key = 'bufferView_' + image.bufferView.toString();
                image.name = image.name || key;
                const bufferView = this._gltf.bufferViews[image.bufferView];
                const buffer = this._gltf.buffers[bufferView.buffer];
                let dataBuffer = new Uint8Array(buffer.dbuffer, bufferView.byteOffset, bufferView.byteLength);
                let imgData = new Blob([dataBuffer], { type: image.mimeType });
                let dtexture = new BitmapTexture2D(true, this.ctx);
                await dtexture.loadFromBlob(imgData);
                dtexture.name = image.name;
                this._gltf.resources[key] = dtexture;
            } else {
                throw new Error(`GLB image ${i} has neither 'uri' nor 'bufferView'`);
            }
        }
    }

    public verification(): boolean {
        if (this.data) {
            return true;
        }
        throw new Error('Method not implemented.');
    }

    private parseHeader(buffer: Uint8Array): GLBHeader {
        let pos = buffer['pos'];
        let result = new GLBHeader();
        let data = new Uint32Array(buffer.buffer, pos, 3);
        buffer['pos'] += data.byteLength;
        result.magic = data[0];
        result.version = data[1];
        result.length = data[2];
        return result;
    }

    private parseChunk(buffer: Uint8Array, scanEnd?: number): GLBChunk {
        const limit = scanEnd ?? buffer.length;
        let pos = buffer['pos'];
        if (pos + 8 > limit) {
            throw new Error(`GLB chunk header at byte ${pos} runs past the end of the file (${limit} bytes) — truncated file?`);
        }
        let result = new GLBChunk();
        let data = new Uint32Array(buffer.buffer, pos, 2);
        pos = buffer['pos'] += data.byteLength;
        result.chunkLength = data[0];
        result.chunkType = data[1];
        if (pos + result.chunkLength > limit) {
            throw new Error(`GLB chunk (type 0x${result.chunkType.toString(16)}) at byte ${pos} declares ${result.chunkLength} bytes but only ${limit - pos} remain — truncated file?`);
        }
        result.chunkData = new Uint8Array(buffer.buffer, pos, result.chunkLength);
        const bytes = new Uint8Array(result.chunkLength);
        for (let i = 0; i < result.chunkLength; i++) bytes[i] = result.chunkData[i];
        result.chunkData = bytes;
        buffer['pos'] += result.chunkLength;
        return result;
    }
}
