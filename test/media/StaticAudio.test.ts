import { test, expect, delay } from '../util'
import { Engine3D, Object3D, Scene3D } from '@orillusion/core';
import { AudioListener, StaticAudio } from '@orillusion/media-extention';

// Regression test for docs/fix-engine.md E15: pause() stored the absolute
// AudioContext clock as a buffer offset, so any pause -> play resumed from
// a wrong (usually silent) position. Now elapsed time is accumulated.

await Engine3D.init();

// Minimal 16-bit PCM mono WAV of the given duration (silence decodes fine).
function makeWav(seconds: number, sampleRate = 8000): ArrayBuffer {
    const numSamples = Math.floor(seconds * sampleRate);
    const buf = new ArrayBuffer(44 + numSamples * 2);
    const v = new DataView(buf);
    const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF'); v.setUint32(4, 36 + numSamples * 2, true); writeStr(8, 'WAVE');
    writeStr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    writeStr(36, 'data'); v.setUint32(40, numSamples * 2, true);
    return buf;
}

await test('pause/play resumes from the paused buffer offset [fix-engine E15]', async () => {
    let scene = new Scene3D();
    let listenerObj = new Object3D();
    let listener = listenerObj.addComponent(AudioListener);
    scene.addChild(listenerObj);

    let audioObj = new Object3D();
    let audio = audioObj.addComponent(StaticAudio);
    scene.addChild(audioObj);
    audio.setLisenter(listener);
    // Electron may create the context suspended (no user gesture) —
    // currentTime does not advance while suspended.
    await listener.context.resume();
    await audio.loadBuffer(makeWav(10), { loop: false, volume: 0 });

    audio.play();
    await delay(500);
    audio.pause();
    const t1 = (audio as any)._currentTime;
    // Offset must be the elapsed playback time, not the absolute ctx clock.
    expect(t1 > 0.3 && t1 < 1.2).toEqual(true);

    // While paused the offset must not advance.
    await delay(400);
    expect((audio as any)._currentTime).toEqual(t1);

    audio.play();
    await delay(300);
    audio.pause();
    const t2 = (audio as any)._currentTime;
    expect(t2 > t1 + 0.1 && t2 < t1 + 1.0).toEqual(true);

    // stop() resets the offset.
    audio.play();
    audio.stop();
    expect((audio as any)._currentTime).toEqual(0);

    audio.destroy();
    listener.destroy();
})
