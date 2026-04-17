import { Scene3D, Object3DUtil, Engine3D, SkyRenderer } from "@orillusion/core";
import { createExampleScene } from "@samples/utils/ExampleScene";

// sample to replace ldr sky map
class Sample_LDRSky {
    async run() {
        // init engine
        const engine = await Engine3D.create({});
        // init scene
        let scene: Scene3D = createExampleScene().scene;
        let sky = scene.getOrAddComponent(SkyRenderer);
        sky.map = await Engine3D.res.loadLDRTextureCube('sky/LDR_sky.jpg')

        // create a basic cube
        scene.addChild(Object3DUtil.GetSingleCube(10, 10, 10, 0.6, 0.6, 0.6));

        // start renderer
        engine.startView(scene.view);
    }

}

new Sample_LDRSky().run();