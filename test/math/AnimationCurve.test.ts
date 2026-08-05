import { test, expect, end, delay } from '../util'
import { AnimationCurve, Engine3D, Keyframe, WrapTimeMode } from '@orillusion/core';

await test('AnimationCurve Add Frame test', async () => {
    let frame_0 = new Keyframe(0, 0);
    let frame_1 = new Keyframe(1, 1);
    let animationCurve = new AnimationCurve(
        [
            frame_0,
            frame_1,
        ],
        WrapTimeMode.Repeat,
        WrapTimeMode.PingPong,
    );

    {
        let v0 = animationCurve.getValue(0);
        let v1 = animationCurve.getValue(1);
        let v2 = animationCurve.getValue(0.5);

        expect(v0).toEqual(0);
        expect(v1).toEqual(1);
        expect(v2).toEqual(0.5);
    }
})

await test('AnimationCurve Frame in&out test', async () => {
    let frame_0 = new Keyframe(0, 0);
    let frame_1 = new Keyframe(1, 1);
    let animationCurve = new AnimationCurve(
        [
            frame_0,
            frame_1,
        ],
        WrapTimeMode.Repeat,
        WrapTimeMode.PingPong,
    );

    {
        frame_0.inSlope = 0.5;
        frame_0.outSlope = 0.15;
        frame_1.inSlope = 0.5;
        frame_1.outSlope = 0.25;

        let v0 = animationCurve.getValue(0);
        let v1 = animationCurve.getValue(1);
        let v2 = animationCurve.getValue(0.5);

        expect(v0).toEqual(0);
        expect(v1).toEqual(1);
        expect(v2).toEqual(0.45625000000000004);
    }
})

await test('AnimationCurve WarpTimeMode test', async () => {
    let frame_0 = new Keyframe(0, 0);
    let frame_1 = new Keyframe(1, 1);
    let animationCurve = new AnimationCurve(
        [
            frame_0,
            frame_1,
        ],
        WrapTimeMode.Repeat,
        WrapTimeMode.PingPong,
    );

    frame_0.inSlope = 0.5;
    frame_0.outSlope = 0.15;
    frame_1.inSlope = 0.5;
    frame_1.outSlope = 0.25;

    let v0 = animationCurve.getValue(-0.5);
    let v1 = animationCurve.getValue(1.5);

    // Repeat pre-wrap maps t=-0.5 onto t=0.5 inside [0,1]; PingPong
    // post-wrap maps t=1.5 back onto t=0.5 — both must sample the same
    // in-range point. The old golden (-8127000.075) was recorded from a
    // broken wrap that cubic-extrapolated far outside the key range.
    expect(v0).toEqual(0.45625000000000004);
    expect(v1).toEqual(0.45625000000000004);
})


await test('AnimationCurve Remove test', async () => {
    let frame_0 = new Keyframe(0, 0);
    let frame_1 = new Keyframe(1, 1);
    let animationCurve = new AnimationCurve(
        [
            frame_0,
            frame_1,
        ],
        WrapTimeMode.Repeat,
        WrapTimeMode.PingPong,
    );

    {
        animationCurve.removeKeyFrame(frame_1);
        expect(animationCurve.getKeyCount()).toEqual(1);
    }
})

setTimeout(end, 500)
