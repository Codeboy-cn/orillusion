import { test, expect, end, waitUntil } from '../util'
import { CameraUtil, Engine3D, GTAOPost, PostProcessingComponent, Scene3D, View3D } from '@orillusion/core';

await test('Post GTAOPost test', async () => {
    const engine = await Engine3D.init();

    let view = new View3D();
    view.scene = new Scene3D();
    view.camera = CameraUtil.createCamera3DObject(view.scene, "camera");
    engine.startRenderViews([view]);

    let postProcessing = view.scene.addComponent(PostProcessingComponent);
    let gtao = postProcessing.addPost(GTAOPost);
    // gtaoTexture is created lazily on the first render(); poll instead
    // of racing a fixed delay against the RAF tick.
    await waitUntil(() => gtao.gtaoTexture)
    let dest = engine.context3D.presentationSize[0];
    let src = gtao.gtaoTexture?.width;
    expect(src).tobe(dest)
    Engine3D.pause()
})


setTimeout(end, 500)
