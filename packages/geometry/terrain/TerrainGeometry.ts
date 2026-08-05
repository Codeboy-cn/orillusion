import { BitmapTexture2D, PlaneGeometry, Vector3, VertexAttributeName, lerp } from "@orillusion/core"

export class TerrainGeometry extends PlaneGeometry {

    private _heightData: number[][];
    private _greenList: Vector3[];


    constructor(width: number, height: number, segmentW: number = 199, segmentH: number = 199) {
        super(width, height, segmentW, segmentH, Vector3.Y_AXIS);
    }

    public setHeight(texture: BitmapTexture2D, height: number) {
        var offscreen = new OffscreenCanvas(texture.width, texture.height);
        let context = offscreen.getContext(`2d`);
        context.drawImage(texture.sourceImageData as ImageBitmap, 0, 0);

        let posAttrData = this.getAttribute(VertexAttributeName.position);
        let pixelData = context.getImageData(0, 0, texture.width, texture.height);

        this._greenList = [];

        // The vertex grid is (segmentW + 1) x (segmentH + 1); iterate every
        // vertex including the last row/column.
        let tw = this.segmentW + 1;
        let th = this.segmentH + 1;
        for (let ppy = 0; ppy < th; ppy++) {
            for (let ppx = 0; ppx < tw; ppx++) {
                // Standard bilinear sampling: map the vertex position to
                // source texel space, then blend the 4 clamped neighbors.
                let sx = ppx / Math.max(tw - 1, 1) * (texture.width - 1);
                let sy = ppy / Math.max(th - 1, 1) * (texture.height - 1);

                let x0 = Math.floor(sx);
                let y0 = Math.floor(sy);
                let x1 = Math.min(x0 + 1, texture.width - 1);
                let y1 = Math.min(y0 + 1, texture.height - 1);
                let fx = sx - x0;
                let fy = sy - y0;

                // Height is read from the red channel (RGBA layout).
                let h00 = pixelData.data[(y0 * texture.width + x0) * 4];
                let h10 = pixelData.data[(y0 * texture.width + x1) * 4];
                let h01 = pixelData.data[(y1 * texture.width + x0) * 4];
                let h11 = pixelData.data[(y1 * texture.width + x1) * 4];

                let h = lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fy);

                let sc = 0.05;
                if (h > 45 && h < 150) {
                    this._greenList.push(new Vector3(ppx, 0, ppy));
                }

                let posIndex = tw * ppy + ppx;
                let hd = h / 256 * height;
                posAttrData.data[posIndex * 3 + 1] = hd;

                this._heightData ||= [];
                this._heightData[ppy] ||= [];
                this._heightData[ppy][ppx] = hd;
            }
        }

        // position attr need to be upload
        this.vertexBuffer.upload(VertexAttributeName.position, posAttrData);

        //update normals
        this.computeNormals();
    }

    public get heightData(): number[][] {
        return this._heightData;
    }

    public get greenData(): Vector3[] {
        return this._greenList;
    }
}