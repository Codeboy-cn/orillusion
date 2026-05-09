import {
    Physics, Rigidbody, BodyType, CollisionShapeUtil,
    HingeJoint, SliderJoint, FixedJoint, SphericalJoint, RopeJoint, SpringJoint,
} from "@orillusion/physics-rapier";
import { createExampleScene, createSceneParam } from "@samples/utils/ExampleScene";
import { Object3D, LitMaterial, Engine3D, BoxGeometry, MeshRenderer, Vector3, PlaneGeometry, Color, SphereGeometry } from "@orillusion/core";

class Sample_RapierJoints {
    async run() {
        await Physics.init();
        const engine = await Engine3D.init({ renderLoop: () => Physics.update() });
        const sp = createSceneParam(); sp.camera.distance = 40;
        const ex = createExampleScene(engine, sp);
        this.initScene(ex.scene);
        engine.startRenderView(ex.view);
    }

    private mat(c: Color) { const m = new LitMaterial(); m.baseColor = c; m.roughness = 0.6; return m; }

    private box(parent: Object3D, x: number, y: number, z: number, size: Vector3, dynamic = true, color = new Color(0.7, 0.7, 0.7)) {
        const o = new Object3D(); o.x = x; o.y = y; o.z = z;
        const mr = o.addComponent(MeshRenderer);
        mr.geometry = new BoxGeometry(size.x, size.y, size.z); mr.material = this.mat(color);
        const rb = o.addComponent(Rigidbody);
        rb.bodyType = dynamic ? BodyType.Dynamic : BodyType.Static;
        rb.mass = dynamic ? 1 : 0;
        rb.shape = CollisionShapeUtil.createBoxShape(o, size);
        parent.addChild(o);
        return { obj: o, rb };
    }

    private initScene(scene: any) {
        // Floor
        const floor = new Object3D();
        const fr = floor.addComponent(MeshRenderer);
        fr.geometry = new PlaneGeometry(80, 80); fr.material = this.mat(new Color(0.4, 0.4, 0.45));
        const fb = floor.addComponent(Rigidbody);
        fb.bodyType = BodyType.Static; fb.shape = CollisionShapeUtil.createPlaneShape(40, 0.05);
        scene.addChild(floor);

        // 1) Hinge: door swings around top edge
        const hingeAnchor = this.box(scene, -16, 6, 0, new Vector3(0.4, 0.4, 0.4), false, new Color(0.5, 0.5, 0.5));
        const door = this.box(scene, -16, 4.5, 0, new Vector3(0.2, 3, 2), true, new Color(0.7, 0.4, 0.3));
        const hj = door.obj.addComponent(HingeJoint);
        hj.connectedBody = hingeAnchor.rb;
        hj.anchorSelf = new Vector3(0, 1.5, 0);
        hj.anchorTarget = new Vector3(0, 0, 0);
        hj.axis = new Vector3(0, 0, 1);

        // 2) Slider: piston along X
        const slideAnchor = this.box(scene, -8, 6, 0, new Vector3(0.4, 0.4, 0.4), false, new Color(0.5, 0.5, 0.5));
        const piston = this.box(scene, -7, 6, 0, new Vector3(0.6, 0.6, 0.6), true, new Color(0.4, 0.7, 0.3));
        const sj = piston.obj.addComponent(SliderJoint);
        sj.connectedBody = slideAnchor.rb;
        sj.axis = new Vector3(1, 0, 0);
        sj.setLimit(-2, 2);

        // 3) Fixed: stuck pair
        const fa = this.box(scene, 0, 6, 0, new Vector3(0.5, 0.5, 0.5), false);
        const fb_box = this.box(scene, 0, 5, 0, new Vector3(0.6, 0.6, 0.6), true, new Color(0.3, 0.4, 0.7));
        const fj = fb_box.obj.addComponent(FixedJoint);
        fj.connectedBody = fa.rb;
        fj.anchorSelf = new Vector3(0, 0.5, 0);
        fj.anchorTarget = new Vector3(0, -0.5, 0);

        // 4) Spherical: ball on a string
        const ballAnchor = this.box(scene, 8, 8, 0, new Vector3(0.4, 0.4, 0.4), false);
        const ball = new Object3D(); ball.x = 8; ball.y = 4; ball.z = 0;
        const bmr = ball.addComponent(MeshRenderer);
        bmr.geometry = new SphereGeometry(0.5, 16, 16); bmr.material = this.mat(new Color(0.9, 0.6, 0.2));
        const ballRb = ball.addComponent(Rigidbody);
        ballRb.bodyType = BodyType.Dynamic; ballRb.mass = 1;
        ballRb.shape = CollisionShapeUtil.createSphereShape(ball, 0.5);
        scene.addChild(ball);
        const sphj = ball.addComponent(SphericalJoint);
        sphj.connectedBody = ballAnchor.rb;
        sphj.anchorSelf = new Vector3(0, 1.5, 0);
        sphj.anchorTarget = new Vector3(0, -1.5, 0);

        // 5) Rope: weight on a length-limited rope
        const ropeAnchor = this.box(scene, 14, 8, 0, new Vector3(0.4, 0.4, 0.4), false);
        const weight = this.box(scene, 14, 3, 0, new Vector3(0.6, 0.6, 0.6), true, new Color(0.6, 0.2, 0.7));
        const rj = weight.obj.addComponent(RopeJoint);
        rj.connectedBody = ropeAnchor.rb;
        rj.length = 4;

        // 6) Spring: bouncing weight
        const sprAnchor = this.box(scene, 20, 9, 0, new Vector3(0.4, 0.4, 0.4), false);
        const bouncy = this.box(scene, 20, 4, 0, new Vector3(0.7, 0.7, 0.7), true, new Color(0.2, 0.7, 0.7));
        const sprj = bouncy.obj.addComponent(SpringJoint);
        sprj.connectedBody = sprAnchor.rb;
        sprj.restLength = 3;
        sprj.stiffness = 100;
        sprj.damping = 5;
    }
}

new Sample_RapierJoints().run();
