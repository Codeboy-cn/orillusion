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
} from '../../src';

class Sample_MultiInstance {
    async run() {
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;background:#111;color:#ddd;font-family:monospace;font-size:12px';
        document.body.appendChild(host);

        const bar = document.createElement('div');
        bar.style.cssText = 'padding:6px 10px;background:#222;border-bottom:1px solid #333';
        bar.textContent = 'Multi-instance demo — two Engine3D with fully isolated GPU devices';
        host.appendChild(bar);

        const stage = document.createElement('div');
        stage.style.cssText = 'flex:1;display:flex;gap:4px;padding:4px;background:#000';
        host.appendChild(stage);

        const makePane = (label: string) => {
            const pane = document.createElement('div');
            pane.style.cssText = 'flex:1;display:flex;flex-direction:column;min-width:0';
            const title = document.createElement('div');
            title.style.cssText = 'padding:4px 8px;background:#1a1a1a;color:#9cf';
            title.textContent = label;
            const canvas = document.createElement('canvas');
            canvas.style.cssText = 'flex:1;width:100%;height:100%;display:block';
            pane.appendChild(title);
            pane.appendChild(canvas);
            stage.appendChild(pane);
            return { pane, title, canvas };
        };

        const a = makePane('Engine A — red box + direct light');
        const b = makePane('Engine B — blue sphere + point light');

        // Scene-graph objects materialize GPU resources lazily per-Context3D
        // on first render, so you can build both engines' scenes in any order
        // without any explicit `engine.use()` bookkeeping.
        const engineA = await Engine3D.create({ canvasConfig: { canvas: a.canvas } });

        a.title.textContent = `Engine A (id=${engineA.id}) — red box + direct light`;

        // ---------- Scene A ----------
        const sceneA = new Scene3D();
        sceneA.addComponent(AtmosphericComponent);

        const camA = CameraUtil.createCamera3D(null, sceneA);
        camA.perspective(60, engineA.context3D.aspect, 1, 2000);
        const ctrlA = camA.object3D.addComponent(HoverCameraController);
        ctrlA.setCamera(30, -15, 120);

        const lightObjA = new Object3D();
        lightObjA.rotationX = 45;
        lightObjA.rotationY = 60;
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

        const viewA = new View3D();
        viewA.scene = sceneA;
        viewA.camera = camA;
        engineA.startView(viewA);

        // ---------- Engine B ----------
        const engineB = await Engine3D.create({ canvasConfig: { canvas: b.canvas } });
        b.title.textContent = `Engine B (id=${engineB.id}) — blue sphere + point light`;

        // ---------- Scene B ----------
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

        const viewB = new View3D();
        viewB.scene = sceneB;
        viewB.camera = camB;
        engineB.startView(viewB);

        console.log('[multi-sample] engineA.id =', engineA.id, 'engineB.id =', engineB.id);
        console.log('[multi-sample] isolated GPU devices =', engineA.context3D.device !== engineB.context3D.device);
        console.log('[multi-sample] isolated adapters =', engineA.context3D.adapter !== engineB.context3D.adapter);
        console.log('[multi-sample] distinct context3D =', engineA.context3D !== engineB.context3D);
    }
}

new Sample_MultiInstance().run();
