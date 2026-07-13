import {
    AtmosphericComponent, CameraUtil, Color, Engine3D, HoverCameraController, Object3D, PlaneGeometry, Scene3D, Vector3, View3D
} from '@orillusion/core';

import {
    ParticleSystem, ParticleMaterial, ParticleStandardSimulator, EmitLocation, ParticleEmitterModule, ParticleOverLifeColorModule, ShapeType, SimulatorSpace
} from '@orillusion/particle';

/**
 * Verification sample for fix-engine.md E14: particles emitted with
 * ShapeType.Cone must spread into a cone from the base disc instead of
 * spawning at a single point.
 */
export class Sample_ConeEmitter {
    engine: Engine3D;
    async run() {
        const engine = this.engine = await Engine3D.init();

        let scene = new Scene3D();
        scene.addComponent(AtmosphericComponent);
        let camera = CameraUtil.createCamera3DObject(scene);
        camera.perspective(60, engine.context3D.aspect, 0.1, 5000.0);

        let ctrl = camera.object3D.addComponent(HoverCameraController);
        ctrl.setCamera(30, -15, 60, new Vector3(0, 10, 0));

        await this.addParticleTo(scene);

        let view = new View3D();
        view.scene = scene;
        view.camera = camera;
        engine.startRenderView(view);
    }

    async addParticleTo(scene: Scene3D) {
        let obj = new Object3D();
        scene.addChild(obj);

        let particleSystem = obj.addComponent(ParticleSystem);

        let material = new ParticleMaterial();
        material.baseMap = await this.engine.res.loadTexture('particle/fx_a_glow_003.png');

        particleSystem.geometry = new PlaneGeometry(1, 1, 1, 1, Vector3.Z_AXIS);
        particleSystem.material = material;

        let simulator = particleSystem.useSimulator(ParticleStandardSimulator);
        simulator.simulatorSpace = SimulatorSpace.Local;

        let emitter = simulator.addModule(ParticleEmitterModule);
        emitter.maxParticle = 10000;
        emitter.duration = 10;
        emitter.emissionRate = 1000;
        emitter.startLifecycle.setScalar(3);
        emitter.shapeType = ShapeType.Cone;
        emitter.radius = 2;
        emitter.angle = 30;
        emitter.emitLocation = EmitLocation.Default;
        emitter.startVelocityY.setScalar(8);

        let overLifeColorModule = simulator.addModule(ParticleOverLifeColorModule);
        overLifeColorModule.startColor = new Color(1, 0.6, 0.1);
        overLifeColorModule.endColor = new Color(0.1, 0.4, 1);
        overLifeColorModule.startAlpha = 1.0;
        overLifeColorModule.endAlpha = 0.0;

        particleSystem.play();
    }
}
