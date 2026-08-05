//TODO FIXED this need change toHalfFloat
const _floatView = new Float32Array(1);
const _int32View = new Int32Array(_floatView.buffer);

/**
 * @internal
 * @param val
 * @returns
 * @group Util
 */
export let toHalfFloat = function (val) {
    // Source: http://gamedev.stackexchange.com/questions/17326/conversion-of-a-number-from-single-precision-floating-point-representation-to-a/17410#17410

    /* This method is faster than the OpenEXR implementation (very often
     * used, eg. in Ogre), with the additional benefit of rounding, inspired
     * by James Tursa?s half-precision code. */

    _floatView[0] = val;
    const x = _int32View[0];

    let bits = (x >> 16) & 0x8000; /* Get the sign */
    let m = (x >> 12) & 0x07ff; /* Keep one extra bit for rounding */
    const e = (x >> 23) & 0xff; /* Using int is faster here */

    /* If zero, or denormal, or exponent underflows too much for a denormal
     * half, return signed zero. */
    if (e < 103) return bits;

    /* If NaN, return NaN. If Inf or exponent overflow, return Inf. */
    if (e > 142) {
        bits |= 0x7c00;
        /* If exponent was 0xff and one mantissa bit was set, it means NaN,
         * not Inf, so make sure we set one mantissa bit too. */
        /* JS `&&` returns an operand, so the old form OR'ed raw mantissa bits
         * into the half and turned quiet NaNs (mantissa bits that vanish in
         * the low 10 bits) into Inf. Set exactly one mantissa bit iff NaN. */
        bits |= (e == 255 && (x & 0x007fffff)) ? 1 : 0;
        return bits;
    }

    /* If exponent underflows but not too much, return a denormal */
    if (e < 114) {
        m |= 0x0800;
        /* Extra rounding may overflow and set mantissa to 0 and exponent
         * to 1, which is OK. */
        bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1);
        return bits;
    }

    bits |= ((e - 112) << 10) | (m >> 1);
    /* Extra rounding. An overflow will set mantissa to 0 and increment
     * the exponent, which is OK. */
    bits += m & 1;
    return bits;
};

/**
 * @internal
 * Decode an IEEE 754 half-precision (binary16) value to a JS number.
 * @group Util
 */
export let fromHalfFloat = function (h: number): number {
    const sign = (h & 0x8000) ? -1 : 1;
    const exp = (h & 0x7c00) >> 10;
    const frac = h & 0x03ff;
    if (exp === 0) return sign * Math.pow(2, -14) * (frac / 1024);
    if (exp === 0x1f) return frac ? NaN : sign * Infinity;
    return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
};
