import { Frustum } from './Frustum';
import { IBound } from './IBound';
import { Object3D } from '../entities/Object3D';
import { Ray } from '../../math/Ray';
import { Vector3 } from '../../math/Vector3';

/**
 * BoundingBox
 * @internal
 * @group Core
 */
export class BoundingBox implements IBound {

    /**
     * The center of the bounding box.
     */
    public center: Vector3;
    /**
     *
     * The range of the bounding box. This is always half the size of these Bounds.
     */
    public extents: Vector3;
    /**
     *
     *  The maximum point of the box body. This always equals center+extensions.
     */
    public max: Vector3;
    /**
     *
     *  The minimum point of the box body. This always equals center extensions.
     */
    public min: Vector3;
    /**
     *
     * The total size of the box. This is always twice as much as extensions.
     */
    public size: Vector3;

    private static maxVector3: Vector3 = new Vector3(1, 1, 1).multiplyScalar(Number.MAX_VALUE * 0.1);
    private static minVector3: Vector3 = new Vector3(1, 1, 1).multiplyScalar(-Number.MAX_VALUE * 0.1);
    /**
     *
     * Create a new Bounds.
     * @param center the center of the box.
     * @param size The size of the box.
     */
    constructor(center?: Vector3, size?: Vector3) {
        center ||= Vector3.ZERO.clone();
        size ||= Vector3.ZERO.clone();
        this.setFromCenterAndSize(center, size);
    }

    public makeEmpty(): this {
        this.setFromMinMax(BoundingBox.maxVector3, BoundingBox.minVector3);
        return this;
    }

    public setFromMinMax(min: Vector3, max: Vector3): this {
        this.init();
        max.subtract(min, this.size);
        min.add(max, this.center).multiplyScalar(0.5);
        this.extents.copyFrom(this.size).multiplyScalar(0.5);
        this.min.copyFrom(min);
        this.max.copyFrom(max);
        return this;
    }

    private init(): this {
        this.min ||= new Vector3();
        this.max ||= new Vector3();
        this.size ||= new Vector3();
        this.center ||= new Vector3();
        this.extents ||= new Vector3();
        return this;
    }
    public setFromCenterAndSize(center: Vector3, size: Vector3): this {
        this.size = size;
        this.center = center;
        this.init();
        this.extents.copy(size).multiplyScalar(0.5);
        this.center.subtract(this.extents, this.min);
        this.center.add(this.extents, this.max);
        return this;
    }

    public inFrustum(obj: Object3D, frustum: Frustum) {
        return frustum.containsBox(obj.bound);
    }

    public merge(bound: BoundingBox) {
        if (bound.min.x < this.min.x) this.min.x = bound.min.x;
        if (bound.min.y < this.min.y) this.min.y = bound.min.y;
        if (bound.min.z < this.min.z) this.min.z = bound.min.z;

        if (bound.max.x > this.max.x) this.max.x = bound.max.x;
        if (bound.max.y > this.max.y) this.max.y = bound.max.y;
        if (bound.max.z > this.max.z) this.max.z = bound.max.z;

        this.size.x = bound.max.x - bound.min.x;
        this.size.y = bound.max.y - bound.min.y;
        this.size.z = bound.max.z - bound.min.z;

        this.extents.x = this.size.x * 0.5;
        this.extents.y = this.size.y * 0.5;
        this.extents.z = this.size.z * 0.5;

        this.center.x = this.extents.x + bound.min.x;
        this.center.y = this.extents.y + bound.min.y;
        this.center.z = this.extents.z + bound.min.z;
    }

    public intersects(bounds: IBound): boolean {
        return this.min.x <= bounds.max.x && this.max.x >= bounds.min.x && this.min.y <= bounds.max.y && this.max.y >= bounds.min.y && this.min.z <= bounds.max.z && this.max.z >= bounds.min.z;
    }

    public intersectsSphere(sphere: IBound): boolean {
        return this.min.x <= sphere.max.x && this.max.x >= sphere.min.x && this.min.y <= sphere.max.y && this.max.y >= sphere.min.y && this.min.z <= sphere.max.z && this.max.z >= sphere.min.z;
    }

    /**
     *
     * Does the target bounding box intersect with the bounding box
     * @param box
     * @returns
     */
    public intersectsBox(box: IBound): boolean {
        return this.min.x <= box.max.x && this.max.x >= box.min.x && this.min.y <= box.max.y && this.max.y >= box.min.y && this.min.z <= box.max.z && this.max.z >= box.min.z;
    }

    public intersectsSegment(p1: Vector3, p2: Vector3): boolean {
        const segmentMin = { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), z: Math.min(p1.z, p2.z) };
        const segmentMax = { x: Math.max(p1.x, p2.x), y: Math.max(p1.y, p2.y), z: Math.max(p1.z, p2.z) };
        if (segmentMin.x > this.max.x || segmentMax.x < this.min.x ||
            segmentMin.y > this.max.y || segmentMax.y < this.min.y ||
            segmentMin.z > this.max.z || segmentMax.z < this.min.z) {
            return false;
        }
        return true;
    }

    public intersectsTriangle(p1: Vector3, p2: Vector3, p3: Vector3): boolean {
        if (this.intersectsSegment(p1, p2) || this.intersectsSegment(p1, p3) || this.intersectsSegment(p2, p3)) {
            return true;
        }
        return false;
    }

    public equals(bounds: IBound): boolean {
        return this.center.equals(bounds.center) && this.extents.equals(bounds.extents);
    }

    public expandByPoint(point: Vector3): void {
        if (point.x < this.min.x) {
            this.min.x = point.x;
        }
        if (point.x > this.max.x) {
            this.max.x = point.x;
        }
        if (point.y < this.min.y) {
            this.min.y = point.y;
        }
        if (point.y > this.max.y) {
            this.max.y = point.y;
        }
        if (point.z < this.min.z) {
            this.min.z = point.z;
        }
        if (point.z > this.max.z) {
            this.max.z = point.z;
        }
    }

    public static fromPoints(points: Vector3[]): BoundingBox {
        var bounds: BoundingBox = new BoundingBox(new Vector3(), new Vector3());
        for (var i: number = 0; i < points.length; i++) {
            bounds.expandByPoint(points[i]);
        }
        return bounds;
    }

    public calculateTransform(obj: Object3D): void {

    }

    public clone(): IBound {
        var bound: BoundingBox = new BoundingBox(this.center.clone(), this.size.clone());
        return bound;
    }

    public intersectsRay(ray: Ray, point: Vector3): boolean {
        throw new Error('Method not implemented.');
    }

    public containsPoint(point: Vector3): boolean {
        return this.min.x <= point.x && this.max.x >= point.x && this.min.y <= point.y && this.max.y >= point.y && this.min.z <= point.z && this.max.z >= point.z;
    }

    public containsBox(box: BoundingBox): boolean {
        let min = this.min;
        let max = this.max;
        let isContain = (min.x <= box.min.x && min.y <= box.min.y && min.z <= box.min.z)
            && (max.x >= box.max.x && max.y >= box.max.y && max.z >= box.max.z);
        return isContain;
    }

    public updateBound() {

    }

    public destroy(force?: boolean) {
        this.center = null;
        this.extents = null;
        this.min = null;
        this.max = null;
        this.size = null;
    }
}
