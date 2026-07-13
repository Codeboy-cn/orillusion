import { test, expect, delay } from '../util'
import { CameraUtil, ComponentBase, ComponentCollect, Engine3D, LitMaterial, Object3D, PlaneGeometry, Scene3D, View3D } from '@orillusion/core';

// Regression tests for docs/fix-engine.md items (E4 / E6 / ...).

const engine = await Engine3D.init();
engine.frameRate = 60;

const view = new View3D();
view.scene = new Scene3D();
view.camera = CameraUtil.createCamera3DObject(view.scene, 'camera');
engine.startRenderViews([view]);

class StartProbe extends ComponentBase {
    public started = false;
    public onStart() {
        this.started = true;
    }
}
class StartProbeB extends StartProbe { }
class StartProbeC extends StartProbe { }

await test('Material.destroy is idempotent [fix-engine E4]', async () => {
    let mat = new LitMaterial();
    mat.destroy(false);
    mat.destroy(false);
    expect(mat.shader == null).toEqual(true);
})

await test('GeometryBase.destroy twice does not throw on indices buffer [fix-engine E4]', async () => {
    let geo = new PlaneGeometry(1, 1);
    geo.destroy();
    geo.destroy();
    expect(true).toEqual(true);
})

await test('removing one pending component keeps siblings onStart [fix-engine E6]', async () => {
    let obj = new Object3D();
    let a = obj.addComponent(StartProbe);
    let b = obj.addComponent(StartProbeB);
    let c = obj.addComponent(StartProbeC);
    view.scene.addChild(obj);
    // Remove the first component before its __start ran.
    obj.removeComponent(StartProbe);
    await delay(200);
    expect(a.started).toEqual(false);
    expect(b.started).toEqual(true);
    expect(c.started).toEqual(true);
    obj.destroy();
})

await test('Cone emitter produces a cone distribution, not a single point [fix-engine E14]', async () => {
    const { ParticleEmitterModule, ShapeType } = await import('@orillusion/particle');
    let emitter: any = new ParticleEmitterModule();
    emitter.shapeType = ShapeType.Cone;
    emitter.radius = 5;
    emitter.angle = 30;

    class FakeVec {
        x = 0; y = 0; z = 0;
        setXYZ(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; }
    }

    let radii: number[] = [];
    let tilts: number[] = [];
    for (let i = 0; i < 200; i++) {
        let pd: any = { start_pos: new FakeVec(), start_velocity: new FakeVec() };
        emitter.calculateConeShapeParticlePos(pd);
        const r = Math.sqrt(pd.start_pos.x ** 2 + pd.start_pos.z ** 2);
        expect(r <= emitter.radius + 1e-6).toEqual(true);
        radii.push(r);

        pd.start_velocity.setXYZ(0, 2, 0);
        emitter.applyConeShapeStartVelocity(pd);
        const v = pd.start_velocity;
        const speed = Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2);
        // Speed magnitude preserved, direction tilted outward with radius.
        expect(Math.abs(speed - 2) < 1e-6).toEqual(true);
        const radial = Math.sqrt(v.x ** 2 + v.z ** 2);
        const tiltDeg = Math.atan2(radial, v.y) * 180 / Math.PI;
        expect(tiltDeg <= emitter.angle + 1e-6).toEqual(true);
        tilts.push(tiltDeg);
        // Radial velocity points the same way as the base-disc offset.
        if (r > 1e-6 && radial > 1e-6) {
            const dot = (v.x * pd.start_pos.x + v.z * pd.start_pos.z) / (radial * r);
            expect(dot > 0.999).toEqual(true);
        }
    }
    // Not a single point: positions actually spread over the disc.
    expect(Math.max(...radii) - Math.min(...radii) > 1).toEqual(true);
    // Rim particles reach (near) the full opening angle.
    expect(Math.max(...tilts) > emitter.angle * 0.8).toEqual(true);
})

await test('enable=true on detached Object3D warns but keeps semantics [fix-engine E5]', async () => {
    let warned = false;
    const orig = console.warn;
    console.warn = (...args: any[]) => { if (String(args[0]).includes('[Transform]')) warned = true; };
    let obj = new Object3D();
    obj.transform.enable = true;
    console.warn = orig;
    expect(warned).toEqual(true);
    // Behavior is unchanged: still silently rewritten to false.
    expect(obj.transform.enable).toEqual(false);

    // Attached objects do not warn.
    warned = false;
    console.warn = (...args: any[]) => { if (String(args[0]).includes('[Transform]')) warned = true; };
    view.scene.addChild(obj);
    obj.transform.enable = true;
    console.warn = orig;
    expect(warned).toEqual(false);
    expect(obj.transform.enable).toEqual(true);
    obj.destroy();
})

await test('waitStartComponent drops dead keys on destroy-before-start [fix-engine E6]', async () => {
    for (let i = 0; i < 8; i++) {
        let obj = new Object3D();
        obj.addComponent(StartProbe);
        view.scene.addChild(obj);
        // Destroy before the main loop ever starts the component.
        obj.destroy();
        expect(ComponentCollect.waitStartComponent.has(obj)).toEqual(false);
    }
})
