import { Engine3D } from "../../Engine3D";
import { TextureAtlas } from "../../assets/TextureAtlas";
import { Texture } from "../../gfx/graphics/webGpu/core/texture/Texture";
import { Vector2 } from "../../math/Vector2";
import { Vector4 } from "../../math/Vector4";
import { ParserBase } from "../../loader/parser/ParserBase";
import { ParserFormat } from "./ParserFormat";

export class AtlasParser extends ParserBase {
    static format: ParserFormat = ParserFormat.TEXT;

    private _json: any;
    private _texture: Texture;

    public async parseString(data: string) {
        this._json = JSON.parse(data);
        let textureUrl = this.userData.replace('.json', '.png');
        this._texture = await Engine3D.resFor(this.ctx).loadTexture(textureUrl, null, true);

        this.parseAtlas();
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
        throw new Error('verify failed.');
    }

    private parseAtlas() {
        const atlasW = this._json.size.x;
        const atlasH = this._json.size.y;
        const textureAtlas = new TextureAtlas(this._texture);
        textureAtlas.name = this.baseUrl;

        let atlasInfo = this._json.atlas;
        for (const key in atlasInfo) {
            const entry = atlasInfo[key];
            const rect = entry.textureRect;
            // atlas JSON stores textureRect as (x, y, w, h) in pixel units.
            const region = new Vector4(
                rect.x / atlasW,
                rect.y / atlasH,
                rect.z / atlasW,
                rect.w / atlasH,
            );
            const nativeSize = new Vector2(entry.size?.x ?? rect.z, entry.size?.y ?? rect.w);
            // atlas JSON border is (left, bottom, right, top) in pixels of the
            // source sub-rect. Convert to normalized region-UV fractions
            // expected by SpriteShader (left, top, right, bottom).
            let border: Vector4 | undefined = undefined;
            if (entry.border) {
                const regionW = Math.max(rect.z, 0.0001);
                const regionH = Math.max(rect.w, 0.0001);
                const tiny = 0.0001;
                const bx = (entry.border.x ?? 0) / regionW;
                const by = (entry.border.w ?? 0) / regionH; // top  → .w
                const bz = (entry.border.z ?? 0) / regionW;
                const bw = (entry.border.y ?? 0) / regionH; // bot  → .y
                if (bx > tiny || by > tiny || bz > tiny || bw > tiny) {
                    border = new Vector4(bx, by, bz, bw);
                }
            }
            textureAtlas.add(key, region, nativeSize, border);
        }
        this.data = textureAtlas;
    }
}
