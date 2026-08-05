import { test, expect, end, delay } from '../util'
import { Bezier2D, Engine3D, Vector2 } from '@orillusion/core';

await test('Bezier test', async () => {
    let bezier2d = new Bezier2D([
        new Vector2(0.0, 0.0),
        new Vector2(0.5, 0.5),
        new Vector2(0.6, 1.0),
        new Vector2(0.8, 1.0),
        new Vector2(1.0, 1.0),
    ]);

    let v = bezier2d.getValue(0.5);

    // 5 points → 4 segments; v=0.5 lands exactly on the middle point
    // points[2]. The old golden (0.7, 1.0) came from the broken segment
    // weight fract((len+1)*v) that skewed every in-segment sample.
    expect(v).toEqual(new Vector2(0.6, 1.0));

    // Segment interior samples interpolate their own segment: v=0.375 is
    // halfway between points[1] and points[2].
    let v2 = bezier2d.getValue(0.375).clone();
    expect(v2).toEqual(new Vector2(0.55, 0.75));
})


setTimeout(end, 500)
