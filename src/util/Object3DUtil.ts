import { Object3D } from '../core/entities/Object3D';
import { MeshRenderer } from '../components/renderer/MeshRenderer';
import { BoxGeometry } from '../shape/BoxGeometry';
import { SphereGeometry } from '../shape/SphereGeometry';
import { LitMaterial } from '../materials/LitMaterial';
import { Color } from '../math/Color';
import { PointLight } from '../components/lights/PointLight';
import { PlaneGeometry } from '../shape/PlaneGeometry';
import { Texture } from '../gfx/graphics/webGpu/core/texture/Texture';
import { Vector3 } from '../math/Vector3';
import { BlendMode } from '../materials/BlendMode';
import { Material } from '../materials/Material';
import { Context3D } from '../gfx/graphics/webGpu/Context3D';

type Object3DUtilHeap = {
    boxGeo: BoxGeometry | null;
    planeGeo: PlaneGeometry | null;
    sphere: SphereGeometry | null;
    material: LitMaterial | null;
    materialMap: Map<Texture, LitMaterial> | null;
};

export class Object3DUtil {
    // Cached geometries/materials are GPU-bearing; keep one heap per Context3D
    // so samples that run under multiple engines don't cross-bind resources.
    private static _getHeap(ctx: Context3D): Object3DUtilHeap {
        let h = ctx.cache(Object3DUtil, () => ({
            boxGeo: null,
            planeGeo: null,
            sphere: null,
            material: null,
            materialMap: null,
        } as Object3DUtilHeap));
        if (!h.boxGeo) h.boxGeo = new BoxGeometry();
        if (!h.planeGeo) h.planeGeo = new PlaneGeometry(1, 1, 1, 1, Vector3.UP);
        if (!h.sphere) h.sphere = new SphereGeometry(1, 35, 35);
        if (!h.material) h.material = new LitMaterial();
        if (!h.materialMap) h.materialMap = new Map<Texture, LitMaterial>();
        return h;
    }

    public static CubeMesh(ctx: Context3D) {
        return this._getHeap(ctx).boxGeo;
    }

    public static SphereMesh(ctx: Context3D) {
        return this._getHeap(ctx).sphere;
    }

    public static GetCube(ctx: Context3D) {
        const h = this._getHeap(ctx);
        let obj = new Object3D();
        let renderer = obj.addComponent(MeshRenderer);
        renderer.geometry = h.boxGeo;
        renderer.material = h.material.clone();
        renderer.castShadow = true;
        return obj;
    }

    public static GetMaterial(ctx: Context3D, tex: Texture) {
        const h = this._getHeap(ctx);
        let mat = h.materialMap.get(tex);
        if (!mat) {
            mat = new LitMaterial();
            mat.baseMap = tex;
            h.materialMap.set(tex, mat);
        }
        return mat.clone();
    }

    public static GetPlane(ctx: Context3D, tex: Texture) {
        const h = this._getHeap(ctx);
        let obj = new Object3D();
        let renderer = obj.addComponent(MeshRenderer);
        renderer.geometry = h.planeGeo;
        let cloneMat = this.GetMaterial(ctx, tex);
        cloneMat.blendMode = BlendMode.ADD;
        cloneMat.castShadow = false;
        renderer.material = cloneMat;
        renderer.castGI = false;
        renderer.castReflection = false;
        return obj;
    }

    public static GetSingleCube(sizeX: number, sizeY: number, sizeZ: number, r: number, g: number, b: number) {
        let mat = new LitMaterial();
        mat.roughness = 0.5;
        mat.metallic = 0.1;
        mat.baseColor = new Color(r, g, b, 1);

        let obj = new Object3D();
        let renderer = obj.addComponent(MeshRenderer);
        renderer.castGI = true;
        renderer.geometry = new BoxGeometry(sizeX, sizeY, sizeZ);
        renderer.material = mat;
        return obj;
    }

    public static GetSingleSphere(radius: number, r: number, g: number, b: number) {
        let mat = new LitMaterial();
        mat.baseColor = new Color(r, g, b, 1);

        let obj = new Object3D();
        let renderer = obj.addComponent(MeshRenderer);
        renderer.castGI = true;
        renderer.geometry = new SphereGeometry(radius, 20, 20);
        renderer.material = mat;
        return obj;
    }

    public static GetSingleCube2(mat: Material, size: number = 10) {
        let obj = new Object3D();
        let renderer = obj.addComponent(MeshRenderer);
        renderer.castShadow = false;
        renderer.geometry = new BoxGeometry(size, size, size);
        renderer.material = mat;
        return obj;
    }

    public static GetPointLight(pos: Vector3, rotation: Vector3, radius: number, r: number, g: number, b: number, intensity: number = 1, castShadow: boolean = true) {
        let lightObj = new Object3D();
        let light = lightObj.addComponent(PointLight);
        light.lightColor = new Color(r, g, b, 1);
        light.intensity = intensity;
        light.range = radius;
        light.at = 8;
        light.radius = 0;
        light.castShadow = castShadow;
        lightObj.localPosition = pos;
        lightObj.localRotation = rotation;

        let sp = this.GetSingleSphere(0.1, 1, 1, 1);
        lightObj.addChild(sp);
        return light;
    }
}
