import { Color } from "./Color";

/**
 * A color gradient that interpolates between an ordered array of colors.
 * @group Math
 */
export class ColorGradient {
    private colorArray: Color[];

    /** Creates a gradient from an ordered array of colors. */
    public constructor(array: Color[]) {
        this.colorArray = array;
    }

    /** Returns the interpolated color at the normalized position `p` (0 to 1). */
    public getColor(p: number) {
        // Scale by (length - 1) so p = 1.0 maps to the last color, and clamp the index
        let s = p * (this.colorArray.length - 1);
        let i = Math.min(Math.floor(s), this.colorArray.length - 1);
        let k = Math.min(i + 1, this.colorArray.length - 1);

        let c1 = this.colorArray[i];
        let c2 = this.colorArray[k];

        return Color.lerp(s - i, c1, c2);
    }

}