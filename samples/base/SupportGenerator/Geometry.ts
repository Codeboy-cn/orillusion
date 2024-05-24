import { BoundingBox, Color, GeometryBase, Matrix4, MeshRenderer, Vector3, VertexAttributeName } from "@orillusion/core";
import { orthogonalVector } from "./Utils";

export class Face {
    public a: number;
    public b: number;
    public c: number;
    public normal: Vector3;
    public color: Color;
    constructor(a: number, b: number, c: number, normal?: Vector3) {
        this.a = a;
        this.b = b;
        this.c = c;
        this.normal = normal;
    }
}

export class Geometry {
    public faces: Array<Face>;
    public vertices: Array<Vector3>;

    public geometryBase: GeometryBase;

    protected mesh: Mesh;

    constructor(mesh?: Mesh) {
        if (!mesh) {
            this.faces = [];
            this.vertices = [];
            return;
        }
        this.mesh = mesh;
        const geometryBase = mesh.rawMesh.geometry;

        this.geometryBase = geometryBase;

        let normals = geometryBase.getAttribute(VertexAttributeName.normal).data as Float32Array;

        let indices = geometryBase.getAttribute(VertexAttributeName.indices).data as Uint32Array;
        const faceCount = indices.length / 3;
        this.faces = new Array<Face>(faceCount);
        for (let i = 0; i < faceCount; i++) {
            this.faces[i] = new Face(
                indices[i * 3 + 0],
                indices[i * 3 + 1],
                indices[i * 3 + 2],
                new Vector3(
                    normals[i * 3 + 0],
                    normals[i * 3 + 1],
                    normals[i * 3 + 2],
                ),
            );
        }

        const vertexs = geometryBase.getAttribute(VertexAttributeName.position).data as Float32Array;
        const vertexVecCount = vertexs.length / 3;
        this.vertices = new Array<Vector3>(vertexVecCount);
        for (let i = 0; i < vertexVecCount; i++) {
            this.vertices[i] = new Vector3(
                vertexs[i * 3 + 0],
                vertexs[i * 3 + 1],
                vertexs[i * 3 + 2],
            );
        }
    }

    public get bounds() {
        return this.mesh.rawMesh.geometry.bounds;
    }

    public mergeVertices() {
        const precision = Math.pow(10, 4);
        let newVerticeIdx: number[] = [];
        let verticeArray: Vector3[] = [];
        let verticeKeyTable: Map<string, number> = new Map<string, number>();
        for (let i = 0; i < this.vertices.length; i++) {
            const v = this.vertices[i];
            let verticeKey = Math.round(v.x * precision) + "_" + Math.round(v.y * precision) + "_" + Math.round(v.z * precision);
            if (!verticeKeyTable.has(verticeKey)) {
                verticeKeyTable.set(verticeKey, i);
                verticeArray.push(this.vertices[i]);
                newVerticeIdx[i] = verticeArray.length - 1;
            } else {
                newVerticeIdx[i] = newVerticeIdx[verticeKeyTable.get(verticeKey)];
            }
        }

        let a = [];
        for (let i = 0; i < this.faces.length; i++) {
            const face = this.faces[i];
            face.a = newVerticeIdx[face.a];
            face.b = newVerticeIdx[face.b];
            face.c = newVerticeIdx[face.c];

            const d = [face.a, face.b, face.c];
            for (let j = 0; j < 3; j++) {
                if (d[j] === d[(j + 1) % 3]) {
                    a.push(i);
                    break;
                }
            }
        }

        for (let i = a.length - 1; i >= 0; i--) {
            let d = a[i];
            this.faces.splice(d, 1);
        }

        let num = this.vertices.length - verticeArray.length;
        this.vertices = verticeArray;
        return num;
    }

    public applyMatrix(m: Matrix4) {
        for (let i = 0; i < this.vertices.length; i++) {
            const v = this.vertices[i];
            v.applyMatrix4(m);
        }
        for (let i = 0; i < this.faces.length; i++) {
            const f = this.faces[i];
            // f.normal.applyMatrix4(m).normalize();

            const v1 = this.vertices[f.a];
            const v2 = this.vertices[f.b];
            const v3 = this.vertices[f.c];

            const vA = Vector3.HELP_0.subVectors(v2, v1);
            const vB = Vector3.HELP_1.subVectors(v3, v1);

            vA.crossProduct(vB, f.normal);
            f.normal.normalize();
        }
    }

    public toGeometryBase(): GeometryBase {
        let result = new GeometryBase();

        let indices = new Uint32Array(this.faces.length * 3);
        let vertexs = new Float32Array(this.faces.length * 3 * 3);
        let normals = new Float32Array(this.faces.length * 3 * 3);

        // let colors = new Float32Array(this.faces.length * 4 * 3);
        // let defaultColor = new Color(1, 1, 1, 1);

        for (let i = 0; i < this.faces.length; i++) {
            const f = this.faces[i];
            const v1 = this.vertices[f.a];
            const v2 = this.vertices[f.b];
            const v3 = this.vertices[f.c];

            indices[i * 3 + 0] = i * 3 + 0;
            indices[i * 3 + 1] = i * 3 + 1;
            indices[i * 3 + 2] = i * 3 + 2;

            vertexs[i * 9 + 0] = v1.x;
            vertexs[i * 9 + 1] = v1.y;
            vertexs[i * 9 + 2] = v1.z;

            vertexs[i * 9 + 3] = v2.x;
            vertexs[i * 9 + 4] = v2.y;
            vertexs[i * 9 + 5] = v2.z;

            vertexs[i * 9 + 6] = v3.x;
            vertexs[i * 9 + 7] = v3.y;
            vertexs[i * 9 + 8] = v3.z;

            const vA = Vector3.HELP_0.subVectors(v2, v1);
            const vB = Vector3.HELP_1.subVectors(v3, v1);
            const normal = vA.crossProduct(vB, Vector3.HELP_2).normalize();

            normals[i * 9 + 0] = normal.x;
            normals[i * 9 + 1] = normal.y;
            normals[i * 9 + 2] = normal.z;

            normals[i * 9 + 3] = normal.x;
            normals[i * 9 + 4] = normal.y;
            normals[i * 9 + 5] = normal.z;

            normals[i * 9 + 6] = normal.x;
            normals[i * 9 + 7] = normal.y;
            normals[i * 9 + 8] = normal.z;

            // if (colors) {
            //     const c = f.color || defaultColor;
            //     colors[i * 12 + 0] = c.r;
            //     colors[i * 12 + 1] = c.g;
            //     colors[i * 12 + 2] = c.b;
            //     colors[i * 12 + 3] = c.a;

            //     colors[i * 12 + 4] = c.r;
            //     colors[i * 12 + 5] = c.g;
            //     colors[i * 12 + 6] = c.b;
            //     colors[i * 12 + 7] = c.a;

            //     colors[i * 12 + 8] =  c.r;
            //     colors[i * 12 + 9] =  c.g;
            //     colors[i * 12 + 10] = c.b;
            //     colors[i * 12 + 11] = c.a;
            // }
        }

        result.setIndices(indices);
        result.setAttribute(VertexAttributeName.position, vertexs);
        result.setAttribute(VertexAttributeName.normal, normals);
        // if (colors) {
        //     result.setAttribute(VertexAttributeName.color, colors);
        // }

        result.addSubGeometry({
            indexStart: 0,
            indexCount: indices.length,
            vertexStart: 0,
            vertexCount: 0,
            firstStart: 0,
            index: 0,
            topology: 0,
        });
        return result;
    }

    public buildCube(pos: Vector3, size: number = 0.2) {
        const index = this.vertices.length;

        this.vertices.push(new Vector3(-size + pos.x, size + pos.y, -size + pos.z));
        this.vertices.push(new Vector3(size + pos.x, size + pos.y, -size + pos.z));
        this.vertices.push(new Vector3(size + pos.x, size + pos.y, size + pos.z));
        this.vertices.push(new Vector3(-size + pos.x, size + pos.y, size + pos.z));

        this.vertices.push(new Vector3(-size + pos.x, -size + pos.y, -size + pos.z));
        this.vertices.push(new Vector3(size + pos.x, -size + pos.y, -size + pos.z));
        this.vertices.push(new Vector3(size + pos.x, -size + pos.y, size + pos.z));
        this.vertices.push(new Vector3(-size + pos.x, -size + pos.y, size + pos.z));

        // up
        this.faces.push(new Face(index + 0, index + 1, index + 2));
        this.faces.push(new Face(index + 2, index + 3, index + 0));

        // down
        this.faces.push(new Face(index + 4, index + 5, index + 6));
        this.faces.push(new Face(index + 6, index + 7, index + 4));

        // l
        this.faces.push(new Face(index + 0, index + 3, index + 7));
        this.faces.push(new Face(index + 7, index + 4, index + 0));

        // r
        this.faces.push(new Face(index + 2, index + 1, index + 5));
        this.faces.push(new Face(index + 5, index + 6, index + 2));

        // f
        this.faces.push(new Face(index + 1, index + 0, index + 4));
        this.faces.push(new Face(index + 4, index + 5, index + 1));

        // b
        this.faces.push(new Face(index + 3, index + 2, index + 7));
        this.faces.push(new Face(index + 7, index + 6, index + 2));
    }

    public pushSphere(pos: Vector3, r: number = 0.2, subdivide: number = 8) {
        const index = this.vertices.length;
        
        for (let j = 0; j <= subdivide; ++j) {
            var horAngle: number = (Math.PI * j) / subdivide;
            var z: number = -r * Math.cos(horAngle);
            var ringRadius: number = r * Math.sin(horAngle);

            for (let i = 0; i <= subdivide; ++i) {
                var verAngle: number = (2 * Math.PI * i) / subdivide;
                var x: number = ringRadius * Math.cos(verAngle);
                var y: number = ringRadius * Math.sin(verAngle);

                this.vertices.push(new Vector3(
                    x + pos.x,
                    y + pos.y,
                    z + pos.z
                ));

                // var normLen: number = 1 / Math.sqrt(x * x + y * y + z * z);
                // normal_arr[ni++] = x * normLen;
                // normal_arr[ni++] = y * normLen;
                // normal_arr[ni++] = z * normLen;

                if (i > 0 && j > 0) {
                    var a: number = index + (subdivide + 1) * j + i;
                    var b: number = index + (subdivide + 1) * j + i - 1;
                    var c: number = index + (subdivide + 1) * (j - 1) + i - 1;
                    var d: number = index + (subdivide + 1) * (j - 1) + i;

                    if (j == subdivide) {
                        this.faces.push(new Face(a, c, d));
                    } else if (j == 1) {
                        this.faces.push(new Face(a, b, c));
                    } else {
                        this.faces.push(new Face(a, b, c));
                        this.faces.push(new Face(a, c, d));
                    }
                }
            }
        }
    }

    public buildSupportPillarNew(startPoint: Vector3, endPoint: Vector3, subdivs: number = 4) {
        // var vn = endPoint.clone().subVectors(endPoint, startPoint).normalize();

        // var endOffset = 0;// this.noTaper ? 0 : -endOffsetFactor * r;
        // var p = startPoint.clone().addScaledVector(vn, endOffset);
        // var b = orthogonalVector(vn).normalize();
        // var c = vn.crossProduct(b);

        // var sidx = this.vertices.length;

        // var ps = [];

        // const isRoot = true;
        // var pi2 = Math.PI * 2;
        // var aincr = (isRoot ? 1 : -1) * pi2 / subdivs;
        // var r = r; // this.noTaper ? r : params.taperFactor * r;

        // for (var ia = 0; ia < subdivs; ia++) {
        //     var a = ia * aincr;
        //     this.vertices.push(
        //         p.clone()
        //             .addScaledVector(b, r * Math.cos(a))
        //             .addScaledVector(c, r * Math.sin(a))
        //     );
        //     ps.push(sidx + ia);
        // }

        // this.vertices.push(p);
        // ps.push(sidx + subdivs);

        var vn = endPoint.clone().subVectors(endPoint, startPoint).normalize();
        var p = startPoint.clone().addScaledVector(vn, 0);
        var b = orthogonalVector(vn).normalize();
        var c = vn.crossProduct(b);

        const radius = 0.1;
        const aincr = Math.PI * 2.0 / subdivs;

        let sp = []
        let sidx = this.vertices.length;
        for (var i = 0; i < subdivs; i++) {
            let a = i * aincr;
            this.vertices.push(
                startPoint.clone()
                    .addScaledVector(b, radius * Math.cos(a))
                    .addScaledVector(c, radius * Math.sin(a))
            );
            sp.push(sidx + i);
        }

        // this.vertices.push(p);

        let tp = []
        let tidx = this.vertices.length;
        for (var i = 0; i < subdivs; i++) {
            let a = i * aincr;
            this.vertices.push(
                endPoint.clone()
                    .addScaledVector(b, radius * Math.cos(a))
                    .addScaledVector(c, radius * Math.sin(a))
            );
            tp.push(tidx + i);
        }

        // this.vertices.push(p);

        for (var i = 0; i < subdivs; i++) {
            let a = tp[(tidx + i) % subdivs];
            let b = tp[(tidx + i + 1) % subdivs];
            let c = sp[i];
            let d = sp[(i + 1) % subdivs];

            this.faces.push(new Face(a, c, d));
            this.faces.push(new Face(a, d, b));
        }
    }

    public buildSupportPillar(p0: Vector3, p1: Vector3, size: number = 0.5, subdivs: number = 4) {
        const index = this.vertices.length;

        this.vertices.push(new Vector3(-size + p0.x, 0 + p0.y, -size + p0.z));
        this.vertices.push(new Vector3(size + p0.x, 0 + p0.y, -size + p0.z));
        this.vertices.push(new Vector3(size + p0.x, 0 + p0.y, size + p0.z));
        this.vertices.push(new Vector3(-size + p0.x, 0 + p0.y, size + p0.z));

        this.vertices.push(new Vector3(-size + p1.x, -0 + p1.y, -size + p1.z));
        this.vertices.push(new Vector3(size + p1.x, -0 + p1.y, -size + p1.z));
        this.vertices.push(new Vector3(size + p1.x, -0 + p1.y, size + p1.z));
        this.vertices.push(new Vector3(-size + p1.x, -0 + p1.y, size + p1.z));

        // up
        this.faces.push(new Face(index + 0, index + 1, index + 2));
        this.faces.push(new Face(index + 2, index + 3, index + 0));

        // down
        this.faces.push(new Face(index + 4, index + 5, index + 6));
        this.faces.push(new Face(index + 6, index + 7, index + 4));

        // l
        this.faces.push(new Face(index + 0, index + 3, index + 7));
        this.faces.push(new Face(index + 7, index + 4, index + 0));

        // r
        this.faces.push(new Face(index + 2, index + 1, index + 5));
        this.faces.push(new Face(index + 5, index + 6, index + 2));

        // f
        this.faces.push(new Face(index + 1, index + 0, index + 4));
        this.faces.push(new Face(index + 4, index + 5, index + 1));

        // b
        this.faces.push(new Face(index + 3, index + 2, index + 7));
        this.faces.push(new Face(index + 7, index + 6, index + 2));
    }

    public buildConnectRod(p0: Vector3, p1: Vector3, radius: number = 0.5, subdivs: number = 4) {
        subdivs = Math.max(subdivs, 3);

        // Direction from p0 to p1
        let direction = Vector3.sub(p1, p0);
        direction.normalize();

        // Generate an arbitrary perpendicular vector
        let up = new Vector3(0, 1, 0);
        if (Math.abs(direction.y) > 0.999) {
            up = new Vector3(1, 0, 0);
        }
        let right = direction.crossProduct(up);
        right.normalize();
        up = right.crossProduct(direction);

        // Generate vertices
        const sidx = this.vertices.length;
        for (let i = 0; i <= subdivs; i++) {
            let theta = (i / subdivs) * 2 * Math.PI;
            let cosTheta = Math.cos(theta);
            let sinTheta = Math.sin(theta);
            let x = cosTheta * radius;
            let y = sinTheta * radius;

            let offsetRight = right.clone().scaleBy(x);
            let offsetUp = up.clone().scaleBy(y);

            let vertexBottom = Vector3.add(p0, Vector3.add(offsetRight, offsetUp));
            let vertexTop = Vector3.add(p1, Vector3.add(offsetRight, offsetUp));

            this.vertices.push(vertexBottom);
            this.vertices.push(vertexTop);
        }

        // Generate indices
        for (let i = 0; i < subdivs; i++) {
            let i0 = i * 2;
            let i1 = i0 + 1;
            let i2 = (i0 + 2) % (subdivs * 2);
            let i3 = (i1 + 2) % (subdivs * 2);

            this.faces.push(new Face(sidx + i1, sidx + i2, sidx + i0));
            this.faces.push(new Face(sidx + i3, sidx + i2, sidx + i1));
        }

        return this;
    }
}

export class Mesh {
    public geometry: Geometry;
    // public boundingBox: BoundingBox;

    public rawMesh: MeshRenderer;

    constructor(mesh: MeshRenderer) {
        this.rawMesh = mesh;
        this.geometry = new Geometry(this);
        this.geometry.mergeVertices();
        // this.boundingBox = new BoundingBox();
        this.shiftBaseGeometryToOrigin();
    }

    public get matrixWorld(): Matrix4 {
        // let m = new Matrix4();
        // m.rawData[12] = 72.5;
        // m.rawData[13] = 72.5;
        // m.rawData[14] = 14.161250114440918;
        // return m;

        return this.rawMesh.transform.worldMatrix;
    }

    protected shiftBaseGeometryToOrigin() {
        var mesh = this.rawMesh;
        var center = this.getCenter();
        var shift = mesh.transform.localPosition.clone().subVectors(mesh.transform.localPosition, center);

        // shift geometry center to origin
        // mesh.position.copy(center.negate());
        // mesh.updateMatrixWorld();
        // mesh.geometry.applyMatrix(mesh.matrixWorld);

        mesh.transform.localPosition = center.negate();
        this.geometry.applyMatrix(mesh.transform.worldMatrix);

        // reset mesh position to 0
        // mesh.position.set(0, 0, 0);
        // mesh.updateMatrixWorld();
        mesh.transform.localPosition = Vector3.ZERO;

        // shift bounds appropriately
        // this.boundingBox.translate(shift);

        let min = mesh.geometry.bounds.min.add(shift);
        let max = mesh.geometry.bounds.max.add(shift);
        mesh.geometry.bounds.setFromMinMax(min, max);
    }

    protected getCenter(): Vector3 {
        return this.geometry.bounds.center.clone();
    }
}
