import { BoundingBox, Color, GeometryBase, Matrix4, MeshRenderer, Object3D, Ray, Struct, Vector3, VertexAttributeName } from "@orillusion/core";
import { SupportGeneratorParams } from "./SupportGeneratorParams";
import { Calculate } from "./Calculate";
import { SupportTreeNode } from "./SupportTreeNode";
import { coneConeIntersection, cycleAxis, pointInsideTriangle, projectToPlaneOnAxis } from "./Utils";
import { Face, Geometry, Mesh } from "./Geometry";
import PriorityQueue from './priority-queue.min.js';
import { Octree } from "./Octree";

export class SupportGenerator {
    public mesh: Mesh;
    public faces: Array<Face>;
    public octree: Octree;
    public vertices: Array<Vector3>;
    public matrixWorld: Matrix4;

    constructor(mesh: Mesh, octree: any) {
        this.mesh = mesh;

        this.faces = mesh.geometry.faces;
        this.vertices = mesh.geometry.vertices;

        this.matrixWorld = mesh.matrixWorld;
        this.octree = octree;
    }

    public static RadiusFunctions_constant(r, w, k): number {
        return r;
    }

    public static RadiusFunctions_sqrt(r, w, k): number {
        return r + k * Math.sqrt(w);
    }

    public Generate(params: SupportGeneratorParams, points) {
        let angleDegrees = params.angle || 45;
        let resolution = params.resolution || 0.3;
        let layerHeight = params.layerHeight || 0.1;
        let radius = params.radius || 0.1;
        let subdivs = params.subdivs || 16;
        let taperFactor = params.taperFactor || 0.5;
        let radiusFn = params.radiusFn || SupportGenerator.RadiusFunctions_sqrt;
        let radiusFnK = params.radiusFnK || 0.01;
        let axis = params.axis || "z";
        let epsilon = params.epsilon || 1e-5;

        let octree = this.octree;
        let matrixWorld = this.matrixWorld;

        let vs = this.vertices;
        let fs = this.faces;

        let nv = vs.length;
        let nf = fs.length;

        // let boundingBox = this.mesh.boundingBox.clone(); // new THREE.Box3().setFromObject(this.mesh);
        // let boundingBox = new BoundingBox();
        // boundingBox.setFromMinMax(
        //     new Vector3(32.345550537109375, 41.29034996032715, 0),
        //     new Vector3(112.65444946289062, 103.70965003967285, 28.322500228881836),
        // );
        let boundingBox = this.mesh.geometry.bounds.clone();

        // axes in the horizontal plane
        let ah = cycleAxis(axis);
        let av = cycleAxis(ah);

        // angle in radians
        let angle = (90 - angleDegrees) * Math.PI / 180;
        let minHeight = 0;
        // let resolution = resolution;
        let minSupportLength = 3 * radius;

        // used to determine overhangs
        let dotProductCutoff = Math.cos(Math.PI / 2 - angle);

        let down = new Vector3();
        down[axis] = -1;
        let up = down.clone().negate();

        // generate an array of faces that require support
        // let supportFaces = getSupportFaces();

        const resolutionBackup = resolution;

        // let supportFaces = getBottomEdgesSupportFaces();

        // rasterize each overhang face set to find sampling points over every set

        resolution /= 4;
        // let points = samplePoints(supportFaces);
        resolution = resolutionBackup;

        // create the underlying structure for the support trees
        let supportTrees = buildSupportTrees(points);

        // let supportTreeGeometry = new Geometry();

        let result = {
            supportPoint: new Geometry(),
            supportTree: new Geometry(),
            supportFaces: new Geometry(),
            testPoints: [],
        };

        const supportTreeGeometry = result.supportTree;

        // Debug: show support faces
        if (false) {
            let i = 0;
            const supportFaces = getBottomEdgesSupportFaces();
            for (let face of supportFaces) {
                let a = this.mesh.geometry.vertices[face.a];
                let b = this.mesh.geometry.vertices[face.b];
                let c = this.mesh.geometry.vertices[face.c];

                a = matrixWorld.transformVector(a);
                b = matrixWorld.transformVector(b);
                c = matrixWorld.transformVector(c);

                // let a = new Vector3();
                // let b = new Vector3();
                // let c = new Vector3();
                // Calculate.faceVertices(face, vs, matrixWorld, a, b, c);

                const index = result.supportFaces.vertices.length;
                result.supportFaces.vertices.push(a);
                result.supportFaces.vertices.push(b);
                result.supportFaces.vertices.push(c);
                const f = new Face(index + 0, index + 1, index + 2);

                i++;
                result.supportFaces.faces.push(f);
            }
        }

        // Debug: show sample Points
        if (true) {
            for (let p of points) {
                const v = p.v;
                result.supportPoint.pushSphere(v);
                // console.warn(v.x, v.y, v.z);
            }
        }

        let treeWriteParams = {
            geo: supportTreeGeometry,
            radius: radius,
            subdivs: subdivs,
            taperFactor: taperFactor,
            endOffsetFactor: 0.5,
            radiusFn: radiusFn,
            radiusFnK: radiusFnK
        };

        if (true) for (let s = 0; s < supportTrees.length; s++) {
            let tree = supportTrees[s];
            //tree.debug();
            tree.writeToGeometry(treeWriteParams);

            result.testPoints.push(tree.p);
        }

        // TODO: impl computeFaceNormals
        // supportTreeGeometry.computeFaceNormals();

        return result;

        function getSupportFaces(): Face[] {
            let normal = new Vector3();
            let a = new Vector3();
            let b = new Vector3();
            let c = new Vector3();

            let minFaceMax = minHeight + layerHeight / 2;
            let supportFaces: Face[] = [];

            for (let f = 0, l = fs.length; f < l; f++) {
                let face = fs[f];

                Calculate.faceVertices(face, vs, matrixWorld, a, b, c);
                let faceMax = Math.max(a[axis], b[axis], c[axis]); // axis == 'y'

                // normal.copy(face.normal).transformDirection(matrixWorld);
                matrixWorld.transformVector(normal.copy(face.normal), normal);

                if (down.dotProduct(normal) > dotProductCutoff && faceMax > minFaceMax) {
                    supportFaces.push(face);
                }
            }

            return supportFaces;
        }

        function samplePoints(supportFaces: Face[]) {
            // rasterization lower bounds on h and v axes
            let rhmin = boundingBox.min[ah];
            let rvmin = boundingBox.min[av];

            let pt = new Vector3();
            let a = new Vector3();
            let b = new Vector3();
            let c = new Vector3();

            let points = [];

            // iterate over all faces in the face set
            for (let f = 0, l = supportFaces.length; f < l; f++) {
                let face = supportFaces[f];

                Calculate.faceVertices(face, vs, matrixWorld, a, b, c);

                // bounding box for the face
                let facebb = Calculate.faceBoundingBox(face, vs, matrixWorld);

                // normal in world space
                let normal = matrixWorld.transformVector(face.normal); //face.normal.clone().transformDirection(matrixWorld);

                // this face's lower bounds in rasterization space
                let hmin = rhmin + Math.floor((facebb.min[ah] - rhmin) / resolution) * resolution;
                let vmin = rvmin + Math.floor((facebb.min[av] - rvmin) / resolution) * resolution;
                // this face's upper bounds in rasterization space
                let hmax = rhmin + Math.ceil((facebb.max[ah] - rhmin) / resolution) * resolution;
                let vmax = rvmin + Math.ceil((facebb.max[av] - rvmin) / resolution) * resolution;

                // iterate over all possible points
                for (let ph = hmin; ph < hmax; ph += resolution) {
                    for (let pv = vmin; pv < vmax; pv += resolution) {
                        pt[ah] = ph;
                        pt[av] = pv;

                        // two triangle verts are flipped because the triangle faces down
                        // and is thus wound CW when looking into the plane
                        if (pointInsideTriangle(pt, b, a, c, axis, epsilon)) {
                            points.push({
                                v: projectToPlaneOnAxis(pt, a, normal, axis),
                                normal: normal
                            });
                        }
                    }
                }
            }

            return points;
        }

        function buildSupportTrees(points): SupportTreeNode[] {
            // iterate through sampled points, build support trees

            // list of support tree roots
            let result: SupportTreeNode[] = [];

            // support tree nodes for this island
            let nodes: SupportTreeNode[] = [];

            let ray = new Ray();
            let faceNormal = new Vector3();

            // orders a priority queue from highest to lowest coordinate on axis
            let pqComparator = function (a, b) { return nodes[b].v[axis] - nodes[a].v[axis]; }
            let pq = new PriorityQueue({
                comparator: pqComparator
            });
            let activeIndices = new Set<number>();

            // put the point indices on the priority queue;
            // also put them into a set of active indices so that we can take a point
            // and test it against all other active points to find the nearest
            // intersection; we could just iterate over the pq.priv.data to do the same,
            // but that's a hack that breaks encapsulation
            for (let pi = 0; pi < points.length; pi++) {
                let point = points[pi];
                let v: Vector3 = point.v;
                let normal = point.normal;

                // one of the leaves of the support tree ends here
                let startNode = new SupportTreeNode(v);
                let idx = nodes.length;

                nodes.push(startNode);

                // attempt to extend a short support strut from the starting point
                // along the normal
                ray.set(v, normal);
                let raycastNormal = octree.raycast(ray);
                let nv = v.clone().addScaledVector(normal, minSupportLength);

                // if a ray cast along the normal hits too close, goes below mesh
                // min, or can be more directly extended less than a strut length
                // straight down, just leave the original node
                if ((raycastNormal && raycastNormal.distance < minSupportLength) ||
                    (nv[axis] < minHeight) ||
                    (v[axis] - minHeight < minSupportLength)) {
                    activeIndices.add(idx);
                    pq.queue(idx);
                }
                // else, connect a new support node to the start node
                else {
                    let newNode = new SupportTreeNode(nv, startNode);

                    nodes.push(newNode);
                    idx++;
                    activeIndices.add(idx);
                    pq.queue(idx);
                }
            }

            let ct = 0;
            while (pq.length > 0) {
                let pi = pq.dequeue();

                if (!activeIndices.has(pi)) continue;
                activeIndices.delete(pi);

                let p = nodes[pi];

                // find the closest intersection between p's cone and another cone
                let intersection: Vector3 = null;
                let intersectionDist = Infinity;
                let qiFinal = -1;

                for (let qi of activeIndices) {
                    let q = nodes[qi];
                    let ixn = coneConeIntersection(p.v, q.v, angle, axis);

                    // if valid intersection and it's inside the mesh boundary
                    if (ixn && (ixn[axis] - minHeight > radius)) {
                        let pidist = Vector3.distance(p.v, ixn); // p.v.distanceTo(ixn);
                        let qidist = Vector3.distance(q.v, ixn); // q.v.distanceTo(ixn);
                        if (pidist < intersectionDist && pidist > radius && qidist > radius) {
                            intersectionDist = pidist;
                            intersection = ixn;
                            qiFinal = qi;
                        }
                    }
                }

                // build one or two struts

                // will need to check if connecting down is cheaper than connecting in
                // the direction of intersection
                let raycastDown = octree.raycast(ray.set(p.v, down));
                // ray may hit the bottom side of the octree, which may not coincide
                // with mesh min; calculate the point and distance for a ray pointed
                // straight down
                let pointDown = new Vector3();
                let distanceDown = 0;

                if (raycastDown) {
                    pointDown.copy(raycastDown.point);
                    pointDown[axis] = Math.max(pointDown[axis], minHeight);
                    distanceDown = Math.min(raycastDown.distance, p.v[axis] - minHeight);
                }
                else {
                    pointDown.copy(p.v);
                    pointDown[axis] = minHeight;
                    distanceDown = p.v[axis] - minHeight;
                }

                // one or two nodes will connect to the target point
                let q = null;
                let target = null;
                let dist = 0;

                // if p-q intersection exists, either p and q connect or p's ray to
                // intersection hits the mesh first
                if (intersection) {
                    let d = intersection.clone().subVectors(intersection, p.v).normalize();
                    // cast a ray from p to the intersection
                    let raycastP = octree.raycast(ray.set(p.v, d));

                    // if p's ray to the intersection hits the mesh first, join it to the
                    // mesh and leave q to join to something else later
                    if (raycastP && raycastP.distance < intersectionDist) {
                        // hit along p's ray to intersection is closer than intersection
                        // itself, so join there
                        if (raycastP.distance < distanceDown) {
                            // get face normal in world space at the ray hit
                            // faceNormal.copy(raycastP.face.normal).transformDirection(matrixWorld);
                            matrixWorld.transformVector(faceNormal.copy(raycastP.face.normal), faceNormal);

                            // if angle is not too shallow, connect at the mesh
                            if (Math.acos(Math.abs(faceNormal.dotProduct(d))) <= Math.PI / 4 + epsilon) {
                                target = raycastP.point;
                                dist = raycastP.distance;
                            }
                            // else, connect down
                            else {
                                target = pointDown;
                                dist = distanceDown;
                            }
                        }
                        // downward connection is closer, so join downward
                        else {
                            target = pointDown;
                            dist = distanceDown;
                        }
                    }
                    // no obstacle for p's strut
                    else {
                        // intersection joint may be too close to a point on the mesh - cast
                        // a ray down from there, and, if it's too close, join p downward
                        let raycastIntersectionDown = octree.raycast(ray.set(intersection, down));

                        if (raycastIntersectionDown && raycastIntersectionDown.distance < minSupportLength) {
                            target = pointDown;
                            dist = distanceDown;
                        }
                        else {
                            q = nodes[qiFinal];
                            target = intersection;
                            dist = Vector3.distance(p.v, intersection); // p.v.distanceTo(intersection);
                        }
                    }
                }
                // if no intersection between p and q, cast a ray down and build a strut
                // where it intersects the mesh or the ground
                else {
                    target = pointDown;
                    dist = distanceDown;
                }

                // if distance somehow ended up as 0, ignore this point
                if (dist === 0) continue;

                // if the strut hits the bottom of the mesh's bounding box, force it
                // to not taper at the end
                let noTaper = target.equals(pointDown) && !raycastDown;

                nodes.push(new SupportTreeNode(target, p, q, { noTaper: noTaper }));

                if (q !== null) {
                    activeIndices.delete(qiFinal);

                    let newidx = nodes.length - 1;
                    activeIndices.add(newidx);
                    pq.queue(newidx);
                }
            }

            // store the root nodes
            for (let i = 0; i < nodes.length; i++) {
                if (nodes[i].isRoot()) result.push(nodes[i]);
            }

            return result;
        }

        function getBottomEdgesSupportFaces(): Face[] {
            let minHeight = 0;
            let angleDegrees = 45;
            let angle = (90 - angleDegrees) * Math.PI / 180;
            let dotProductCutoff = Math.cos(Math.PI / 2 - angle);

            let normal = new Vector3();
            let a = new Vector3();
            let b = new Vector3();
            let c = new Vector3();

            // let min = matrixWorld.transformPoint(boundingBox.min);

            let minFaceHeight = 8;
            let supportFaces: Face[] = [];

            for (let f = 0, l = fs.length; f < l; f++) {
                let face = fs[f];

                Calculate.faceVertices(face, vs, matrixWorld, a, b, c);
                let faceMin = Math.min(a[axis], b[axis], c[axis]);

                matrixWorld.transformVector(normal.copy(face.normal), normal);

                if (down.dotProduct(normal) > dotProductCutoff && faceMin <= minFaceHeight) {
                    supportFaces.push(face);
                }
            }

            return supportFaces;
        }

        function getSupportFacesNotBottomEdges(): Face[] {
            let bottomEdges_angleDegrees = 45;
            let bottomEdges_angle = (90 - bottomEdges_angleDegrees) * Math.PI / 180;
            let bottomEdges_dotProductCutoff = Math.cos(Math.PI / 2 - bottomEdges_angle);

            let normal = new Vector3();
            let a = new Vector3();
            let b = new Vector3();
            let c = new Vector3();

            let minFaceHeight = 8;
            let supportFaces: Face[] = [];

            let minHeight = 0;
            let minFaceMax = minHeight + layerHeight / 2;

            for (let f = 0, l = fs.length; f < l; f++) {
                let face = fs[f];

                Calculate.faceVertices(face, vs, matrixWorld, a, b, c);
                let faceMin = Math.min(a[axis], b[axis], c[axis]);

                matrixWorld.transformVector(normal.copy(face.normal), normal);

                let value = down.dotProduct(normal);

                if (value > bottomEdges_dotProductCutoff && faceMin <= minFaceHeight) {
                    continue;
                }

                let faceMax = Math.max(a[axis], b[axis], c[axis]);
                if (value > dotProductCutoff && faceMax > minFaceMax) {
                    supportFaces.push(face);
                }
            }

            return supportFaces;
        }
    }
}
