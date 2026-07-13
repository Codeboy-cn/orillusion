import { test, expect, end, delay, waitUntil } from '../util'
import { BoundingBox, BoxGeometry, CameraUtil, ComponentBase, Engine3D, EntityCollect, LitMaterial, MeshRenderer, Object3D, PointerEvent3D, Scene3D, Vector3, View3D } from '@orillusion/core';

// Regression tests for audit findings C1 / C2 / M3 / M4 / C8 / C5 (batch 1).

const engine = await Engine3D.init();
engine.frameRate = 60;

const view = new View3D();
view.scene = new Scene3D();
view.camera = CameraUtil.createCamera3DObject(view.scene, 'camera');
engine.startRenderViews([view]);

await test('BoundingBox.merge derives center/size from the union [audit M3]', async () => {
    let a = new BoundingBox();
    a.setFromMinMax(new Vector3(0, 0, 0), new Vector3(2, 2, 2));
    let b = new BoundingBox();
    b.setFromMinMax(new Vector3(8, -1, 0), new Vector3(10, 1, 2));

    a.merge(b);

    expect(a.min.x).toEqual(0);
    expect(a.max.x).toEqual(10);
    expect(a.size.x).toEqual(10);
    expect(a.extents.x).toEqual(5);
    expect(a.center.x).toEqual(5);
    expect(a.min.y).toEqual(-1);
    expect(a.max.y).toEqual(2);
    expect(a.center.y).toEqual(0.5);
})

await test('BoundingBox.fromPoints excludes origin and fills derived fields [audit M4]', async () => {
    let box = BoundingBox.fromPoints([
        new Vector3(5, 6, 7),
        new Vector3(6, 7, 8),
        new Vector3(8, 7, 6),
    ]);

    expect(box.min.x).toEqual(5);
    expect(box.min.y).toEqual(6);
    expect(box.min.z).toEqual(6);
    expect(box.max.x).toEqual(8);
    expect(box.max.y).toEqual(7);
    expect(box.max.z).toEqual(8);
    // Derived fields must be rebuilt, not left at zero.
    expect(box.size.x).toEqual(3);
    expect(box.center.x).toEqual(6.5);
    expect(box.extents.x).toEqual(1.5);
})

await test('renderer re-registers after removeChild + addChild [audit C1]', async () => {
    let obj = new Object3D();
    let mr = obj.addComponent(MeshRenderer);
    mr.material = new LitMaterial();
    mr.geometry = new BoxGeometry();

    view.scene.addChild(obj);
    await waitUntil(() => mr.enable, 5000);
    expect(mr.enable).toEqual(true);

    view.scene.removeChild(obj);
    view.scene.addChild(obj);

    // The enable flag is owned by the setter; onDisable used to force
    // _enable=false behind its back, so re-adding never re-registered.
    expect(mr.enable).toEqual(true);
    let registered = await waitUntil(() => {
        let nodes = (EntityCollect.instance as any)._op_RenderNodes.get(view.scene);
        return nodes && nodes.indexOf(mr) >= 0;
    }, 5000);
    expect(!!registered).toEqual(true);
})

class WaitStartA extends ComponentBase {
    public started = false;
    public start() { this.started = true; }
}
class WaitStartB extends ComponentBase {
    public started = false;
    public start() { this.started = true; }
}
class WaitStartC extends ComponentBase {
    public started = false;
    public start() { this.started = true; }
}

await test('removing one queued component keeps the others starting [audit C2]', async () => {
    let obj = new Object3D();
    obj.addComponent(WaitStartA);
    let b = obj.addComponent(WaitStartB);
    let c = obj.addComponent(WaitStartC);

    // splice(index) with no count used to wipe B and C from the
    // wait-start queue along with A.
    obj.removeComponent(WaitStartA);

    view.scene.addChild(obj);
    await waitUntil(() => b.started && c.started, 5000);
    expect(b.started).toEqual(true);
    expect(c.started).toEqual(true);
})

await test('getWorldDirection reflects a transform change immediately [audit C8]', async () => {
    let camera = view.camera;
    camera.transform.rotationX = 0;
    camera.transform.rotationY = 0;
    camera.transform.rotationZ = 0;
    let before = camera.getWorldDirection();
    expect(Math.abs(before.z)).toSubequal(1, 0.001);

    camera.transform.rotationY = 90;
    // No frame wait — the lazy world-matrix update must run inside
    // getWorldDirection itself.
    let dir = camera.getWorldDirection();
    expect(Math.abs(dir.x)).toSubequal(1, 0.001);
    expect(Math.abs(dir.z)).toSubequal(0, 0.001);
    camera.transform.rotationY = 0;
})

await test('enablePick toggle neither leaks listeners nor spawns new PickFire [audit C5]', async () => {
    engine.setting.pick.enable = true;
    const input = engine.inputSystem as any;
    const count = () => (input.listeners[PointerEvent3D.POINTER_MOVE] || []).length;

    view.enablePick = true;
    await delay(50);
    let fire = view.pickFire;
    expect(!!fire).toEqual(true);
    let baseline = count();

    view.enablePick = false;
    expect(count() < baseline).toEqual(true);

    view.enablePick = true;
    // Same instance must be reused, and the listener count must return
    // to the baseline instead of growing.
    expect(view.pickFire === fire).toEqual(true);
    expect(count()).toEqual(baseline);

    view.enablePick = false;
})

setTimeout(end, 500)
