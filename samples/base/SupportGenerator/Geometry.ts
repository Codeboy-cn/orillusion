import { BoundingBox, GeometryBase, Matrix4, MeshRenderer, Vector3, VertexAttributeName } from "@orillusion/core";

export class Face {
    public a: number;
    public b: number;
    public c: number;
    public normal: Vector3;
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

    constructor(mesh: Mesh) {
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
    }
}

export class Mesh {
    public geometry: Geometry;
    public boundingBox: BoundingBox;

    public rawMesh: MeshRenderer;

    constructor(mesh: MeshRenderer) {
        this.rawMesh = mesh;
        this.geometry = new Geometry(this);
        this.geometry.mergeVertices();
        this.boundingBox = new BoundingBox();
        this.shiftBaseGeometryToOrigin();
    }

    public get matrixWorld(): Matrix4 {
        let m = new Matrix4();
        m.rawData[12] = 72.5;
        m.rawData[13] = 72.5;
        m.rawData[14] = 14.161250114440918;
        return m;

        // return this.rawMesh.transform.worldMatrix;
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
        this.boundingBox.setFromMinMax(min, max);
    }

    protected getCenter(): Vector3 {
        return this.geometry.bounds.center.clone();
    }
}
