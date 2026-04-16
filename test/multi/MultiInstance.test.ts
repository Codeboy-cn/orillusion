import { test, expect, end, delay } from '../util'
import {
    Engine3D,
    Scene3D,
    View3D,
    CameraUtil,
    AtmosphericComponent,
    HoverCameraController,
    Object3D,
    DirectLight,
    PointLight,
    KelvinUtil,
    MeshRenderer,
    LitMaterial,
    BoxGeometry,
    SphereGeometry,
    Color,
} from '@orillusion/core';

// ---------- helpers ----------

function makeCanvas(id: string, left: number, width = 320, height = 240): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.id = id;
    c.width = width;
    c.height = height;
    c.style.position = 'absolute';
    c.style.top = '0';
    c.style.left = left + 'px';
    c.style.width = width + 'px';
    c.style.height = height + 'px';
    c.style.background = '#000';
    document.body.appendChild(c);
    return c;
}

type InstanceReport = {
    instanceId: number,
    canvasId: string,
    canvasSize: number[],
    presentationSize: number[],
    aspect: number,
    sceneChildren: number,
    meshNames: string[],
    lightCount: number,
    lightTypes: string[],
    cameraPos: number[],
    cameraFov: number,
    renderJobAttached: boolean,
};

function snapshot(engine: Engine3D, view: View3D, canvas: HTMLCanvasElement): InstanceReport {
    let scene = view.scene;
    let meshNames: string[] = [];
    let lightTypes: string[] = [];
    let lightCount = 0;
    scene.forChild((c: Object3D) => {
        if (c.hasComponent(MeshRenderer)) meshNames.push(c.name || '<unnamed>');
        if (c.hasComponent(DirectLight)) { lightTypes.push('Direct'); lightCount++; }
        if (c.hasComponent(PointLight)) { lightTypes.push('Point'); lightCount++; }
    });
    let cam = view.camera;
    return {
        instanceId: engine.id,
        canvasId: canvas.id,
        canvasSize: [canvas.width, canvas.height],
        presentationSize: [...engine.context3D.presentationSize],
        aspect: engine.context3D.aspect,
        sceneChildren: (scene as any).entityChildren?.length ?? 0,
        meshNames,
        lightCount,
        lightTypes,
        cameraPos: [cam.transform.worldPosition.x, cam.transform.worldPosition.y, cam.transform.worldPosition.z],
        cameraFov: (cam as any).fov ?? -1,
        renderJobAttached: !!engine.getRenderJobOf(view),
    };
}

// ---------- test ----------

let canvasA = makeCanvas('canvasA', 10);
let canvasB = makeCanvas('canvasB', 350);

let engineA!: Engine3D;
let engineB!: Engine3D;
let viewA!: View3D;
let viewB!: View3D;

await test('create two Engine3D instances sharing GPU device', async () => {
    engineA = await Engine3D.create({ canvasConfig: { canvas: canvasA, devicePixelRatio: 1 } });
    engineB = await Engine3D.create({ canvasConfig: { canvas: canvasB, devicePixelRatio: 1 } });

    const diffIds = engineA.id !== engineB.id;
    const sameDevice = engineA.context3D.device === engineB.context3D.device;
    const canvasAok = engineA.context3D.canvas === canvasA;
    const canvasBok = engineB.context3D.canvas === canvasB;
    const diffContexts = engineA.context3D !== engineB.context3D;
    console.log('[multi] engineA.id =', engineA.id, 'engineB.id =', engineB.id);
    console.log('[multi] shared device =', sameDevice);
    console.log('[multi] distinct context3D =', diffContexts);
    console.log('[multi] canvasA bound =', canvasAok, ', canvasB bound =', canvasBok);

    expect(diffIds).toEqual(true);
    expect(sameDevice).toEqual(true);
    expect(diffContexts).toEqual(true);
    expect(canvasAok).toEqual(true);
    expect(canvasBok).toEqual(true);
});

await test('build isolated scenes and start two render loops', async () => {
    // ----- Scene A: red box + direct light -----
    const sceneA = new Scene3D();
    sceneA.addComponent(AtmosphericComponent);

    const camA = CameraUtil.createCamera3D(null, sceneA);
    camA.perspective(60, engineA.context3D.aspect, 1, 2000);
    const ctrlA = camA.object3D.addComponent(HoverCameraController);
    ctrlA.setCamera(30, -15, 120);

    const lightObjA = new Object3D();
    lightObjA.rotationX = 45; lightObjA.rotationY = 60;
    const dirA = lightObjA.addComponent(DirectLight);
    dirA.lightColor = KelvinUtil.color_temperature_to_rgb(5500);
    dirA.intensity = 3;
    sceneA.addChild(lightObjA);

    const boxA = new Object3D();
    boxA.name = 'redBox';
    const mrA = boxA.addComponent(MeshRenderer);
    mrA.geometry = new BoxGeometry(40, 40, 40);
    const matA = new LitMaterial();
    matA.baseColor = new Color(1, 0.15, 0.15, 1);
    mrA.material = matA;
    sceneA.addChild(boxA);

    viewA = new View3D();
    viewA.scene = sceneA;
    viewA.camera = camA;
    engineA.startView(viewA);

    // ----- Scene B: blue sphere + point light -----
    const sceneB = new Scene3D();
    sceneB.addComponent(AtmosphericComponent);

    const camB = CameraUtil.createCamera3D(null, sceneB);
    camB.perspective(45, engineB.context3D.aspect, 1, 2000);
    const ctrlB = camB.object3D.addComponent(HoverCameraController);
    ctrlB.setCamera(0, 0, 140);

    const ptLightObj = new Object3D();
    ptLightObj.transform.x = 40;
    ptLightObj.transform.y = 30;
    const ptLight = ptLightObj.addComponent(PointLight);
    ptLight.lightColor = new Color(1, 1, 1);
    ptLight.intensity = 30;
    ptLight.range = 300;
    sceneB.addChild(ptLightObj);

    const sphB = new Object3D();
    sphB.name = 'blueSphere';
    const mrB = sphB.addComponent(MeshRenderer);
    mrB.geometry = new SphereGeometry(25, 32, 32);
    const matB = new LitMaterial();
    matB.baseColor = new Color(0.1, 0.4, 1.0, 1);
    mrB.material = matB;
    sceneB.addChild(sphB);

    viewB = new View3D();
    viewB.scene = sceneB;
    viewB.camera = camB;
    engineB.startView(viewB);

    // log initial state
    const reportA = snapshot(engineA, viewA, canvasA);
    const reportB = snapshot(engineB, viewB, canvasB);
    console.log('[multi] scene A snapshot:', JSON.stringify(reportA));
    console.log('[multi] scene B snapshot:', JSON.stringify(reportB));

    // expectation: each engine has exactly its own scene content
    expect(reportA.meshNames).toEqual(['redBox']);
    expect(reportB.meshNames).toEqual(['blueSphere']);
    expect(reportA.lightTypes).toEqual(['Direct']);
    expect(reportB.lightTypes).toEqual(['Point']);
    expect(reportA.renderJobAttached).toEqual(true);
    expect(reportB.renderJobAttached).toEqual(true);
});

await test('both engines advance their render loops', async () => {
    const startA = engineA.frameCount;
    const startB = engineB.frameCount;
    // ~1.5s wall time; at 60fps each engine should tick many frames.
    for (let i = 0; i < 30; i++) await delay(50);
    const deltaA = engineA.frameCount - startA;
    const deltaB = engineB.frameCount - startB;

    console.log('[multi] engineA advanced frames:', deltaA);
    console.log('[multi] engineB advanced frames:', deltaB);

    const finalA = snapshot(engineA, viewA, canvasA);
    const finalB = snapshot(engineB, viewB, canvasB);
    console.log('[multi] final scene A:', JSON.stringify(finalA));
    console.log('[multi] final scene B:', JSON.stringify(finalB));

    expect(deltaA > 5).toEqual(true);
    expect(deltaB > 5).toEqual(true);
});

setTimeout(end, 500);
