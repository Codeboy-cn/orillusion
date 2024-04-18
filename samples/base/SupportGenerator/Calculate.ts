import { BoundingBox, Matrix4, Vector3 } from "@orillusion/core";
import { Face } from "./Geometry";

export class Calculate {
    // get an array of the face's vertices in the original winding order
    public static faceVertices(face: Face, vertices: Vector3[], matrix: Matrix4, va?: Vector3, vb?: Vector3, vc?: Vector3) {
        va = va || new Vector3();
        vb = vb || new Vector3();
        vc = vc || new Vector3();

        va.copy(vertices[face.a]);
        vb.copy(vertices[face.b]);
        vc.copy(vertices[face.c]);

        if (matrix !== undefined) {
            // va.applyMatrix4(matrix);
            // vb.applyMatrix4(matrix);
            // vc.applyMatrix4(matrix);
            matrix.transformPoint(va, va);
            matrix.transformPoint(vb, vb);
            matrix.transformPoint(vc, vc);
        }

        return [va, vb, vc];
    }

    // calculate a bounding box for a face
    public static faceBoundingBox(face: Face, vertices: Vector3[], matrix: Matrix4) {
        var [va, vb, vc] = this.faceVertices(face, vertices, matrix);

        return this._triangleBoundingBox(va, vb, vc);
    }

    protected static _triangleBoundingBox(va: Vector3, vb: Vector3, vc: Vector3) {
        var box = new BoundingBox();
        box.min.x = Infinity;
        box.min.y = Infinity;
        box.min.z = Infinity;

        box.max.x = -Infinity;
        box.max.y = -Infinity;
        box.max.z = -Infinity;

        box.expandByPoint(va);
        box.expandByPoint(vb);
        box.expandByPoint(vc);

        return box;
    }
}