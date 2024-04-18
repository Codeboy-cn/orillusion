import { Vector3 } from "@orillusion/core";
import { acos, equal, orthogonalVector, projectOut } from "./Utils";
import { Face, Geometry } from "./Geometry";

export type TreeWriteParams = {
    geo: Geometry;
    radius: number;
    subdivs: number;
    taperFactor: number;
    endOffsetFactor: number;
    radiusFn: any;
    radiusFnK: number;
}

export class SupportTreeNode {
    public v: Vector3;
    public b0: SupportTreeNode;
    public b1: SupportTreeNode;
    public source: SupportTreeNode;

    public noTaper: boolean;
    public weight: number;

    public p0: number[];
    public p1: number[];
    public ps: number[];

    constructor(v: Vector3, b0?, b1?, params?) {
        this.v = v;

        // every node is a root when created; when connected as a branch node to
        // another node, it stops being root
        this.source = null;

        // branch nodes
        this.b0 = (b0 ? b0 : b1) || null;
        this.b1 = (b0 ? b1 : null) || null;

        // if connected a branch node, that node is no longer root
        if (b0) b0.source = this;
        if (b1) b1.source = this;

        // no-taper parameter
        this.noTaper = (params && params.noTaper) || false;

        this.weight = 0;
        if (b0) this.weight += b0.weight + Vector3.distance(v, b0.v); // v.distanceTo(b0.v);
        if (b1) this.weight += b1.weight + Vector3.distance(v, b1.v); // v.distanceTo(b1.v);
    }

    // true if at the bottom of a tree
    public isRoot(): boolean {
        return this.source === null;
    }

    // true if at the top of a tree
    public isLeaf(): boolean {
        return this.b0 === null && this.b1 === null;
    }

    // true if one strut connecting from above and one from below
    public isElbowJoint(): boolean {
        return this.b0 !== null && this.b1 === null && this.source !== null;
    }

    // true if two struts connecting from above and one from below
    public isTJoint(): boolean {
        return this.b0 !== null && this.b1 !== null && this.source !== null;
    }

    public writeToGeometry(params: TreeWriteParams) {
        if (!this.isRoot()) return null;

        params = params || {} as TreeWriteParams;
        var subdivs = params.subdivs;

        // subdivs must be at least 4 and even
        if (subdivs === undefined || subdivs < 4) subdivs = 4;
        subdivs -= subdivs % 2;

        params.subdivs = subdivs;

        this.makeProfiles(params);
        this.connectProfiles(params);
    }

    public makeProfiles(params: TreeWriteParams) {

        var pi2 = Math.PI * 2;

        var vertices = params.geo.vertices;

        var isRoot = this.isRoot();
        var isLeaf = this.isLeaf();
        var isElbowJoint = this.isElbowJoint();

        var radius = params.radius;
        var subdivs = params.subdivs;
        var endOffsetFactor = params.endOffsetFactor;

        // calculate radius at this strut from base radius, weight supported by this
        // node, and the given constant
        var r: number = params.radiusFn(radius, this.weight, params.radiusFnK);

        if (isRoot || isLeaf) {
            // node's neighbor; if root, then this is the single branch node; if leaf,
            // this is the source
            var n = isRoot ? this.b0 : this.source;

            if (!n) return;

            // outgoing vector up to the neighbor
            // var vn = n.v.clone().sub(this.v).normalize();
            var vn = n.v.clone().subVectors(n.v, this.v).normalize();

            // point where the profile center will go
            var endOffset = this.noTaper ? 0 : -endOffsetFactor * r;
            var p = this.v.clone().addScaledVector(vn, endOffset);

            // two axes orthogonal to strut axis
            var b = orthogonalVector(vn).normalize();
            // var c = vn.clone().crossProduct(b);
            var c = vn.crossProduct(b);

            // starting index for the profile
            var sidx = vertices.length;

            // profile - array of vertex indices
            var ps = [];

            // angle increment
            var aincr = (isRoot ? 1 : -1) * pi2 / subdivs;

            var r = this.noTaper ? r : params.taperFactor * r;

            // push verts and vertex indices to profile
            for (var ia = 0; ia < subdivs; ia++) {
                var a = ia * aincr;
                vertices.push(
                    p.clone()
                        .addScaledVector(b, r * Math.cos(a))
                        .addScaledVector(c, r * Math.sin(a))
                );
                ps.push(sidx + ia);
            }

            // push center point
            vertices.push(p);
            ps.push(sidx + subdivs);

            if (isRoot) this.p0 = ps;
            else this.ps = ps;
        }
        else if (isElbowJoint) {
            var v = this.v;

            // outgoing vectors along the adjoining struts
            // var v0 = this.b0.v.clone().sub(v).normalize();
            // var vs = this.source.v.clone().sub(v).normalize();
            var v0 = this.b0.v.clone().subVectors(this.b0.v, v).normalize();
            var vs = this.source.v.clone().subVectors(this.source.v, v).normalize();

            // calculate bisector of the outgoing struts (just use an orthogonal vector
            // if struts are parallel)
            var s = v0.clone().add(vs);
            var b = equal(s.length, 0) ? orthogonalVector(v0) : s;
            b.normalize();

            // half-angle between the struts
            var ha = acos(v0.dotProduct(vs)) / 2;

            // distance from center to the farthest intersection of the struts
            var m = r / Math.sin(ha);

            // minor axis vector and magnitude
            var c = v0.crossProduct(b);
            var n_ = r;

            // starting index for the profile
            var sidx = vertices.length;

            // profile - array of vertex indices
            var p0 = [];

            // angle increment
            var aincr = pi2 / subdivs;

            // make the profile, wound CCW looking down (against) upward branch
            for (var ia = 0; ia < subdivs; ia++) {
                var a = ia * aincr;
                vertices.push(v.clone()
                    .addScaledVector(b, m * Math.cos(a))
                    .addScaledVector(c, n_ * Math.sin(a))
                );
                p0.push(sidx + ia);
            }
 
            // upward-facing profile is wound CCW (looking down the upward strut) and
            // downward-facing profile is would CW (looking up), so both are the same
            this.p0 = p0;
            this.ps = p0;
        }
        else {
            // outgoing vectors down the adjoining struts
            var v0 = this.b0.v.clone().subVectors(this.b0.v, this.v).normalize();
            var v1 = this.b1.v.clone().subVectors(this.b1.v, this.v).normalize();
            var vs = this.source.v.clone().subVectors(this.source.v, this.v).normalize();

            // sums of adjacent strut vectors
            var sm01 = v0.clone().add(v1);
            var sm0s = v0.clone().add(vs);
            var sm1s = v1.clone().add(vs);

            // bisectors between adjoining struts
            // default method is to add the two strut vectors; if two strut vectors are
            // antiparallel, use the third strut vector to get the correct bisector
            var b01 = equal(sm01.length, 0) ? projectOut(vs, v0).negate() : sm01;
            var b0s = equal(sm0s.length, 0) ? projectOut(v1, vs).negate() : sm0s;
            var b1s = equal(sm1s.length, 0) ? projectOut(v0, v1).negate() : sm1s;
            // normalize bisectors
            b01.normalize();
            b0s.normalize();
            b1s.normalize();

            // angles between each strut and the halfplanes separating them from the
            // adjoining struts
            var a01 = acos(v0.dotProduct(v1)) / 2;
            var a0s = acos(v0.dotProduct(vs)) / 2;
            var a1s = acos(v1.dotProduct(vs)) / 2;

            // distance from center to the farthest intersection of two struts
            var m01 = r / Math.sin(a01);
            var m0s = r / Math.sin(a0s);
            var m1s = r / Math.sin(a1s);

            // find the normal to the plane formed by the strut vectors
            var v01 = v1.clone().subVectors(v1, v0);
            var v0s = vs.clone().subVectors(vs, v0);
            // unit vector to inward vertex; its inverse points to outward vertex
            var ihat = v01.crossProduct(v0s).normalize();

            // correct sign in case inward vector points outward
            var dot = ihat.dotProduct(v1);
            if (dot < 0) ihat.negate();

            // magnitude of in/out vector is r / sin(acos(dot)), where dot is the
            // cosine of the angle between ihat and one of the strut vectors (this is
            // mathematically equivalent to the square root thing)
            var mio = r / Math.sqrt(1 - dot * dot);

            // An ellipse is specified like so:
            //  x = m cos t
            //  y = n sin t
            // where t is an angle CCW from the major axis. t here is not an actual
            // angle between the (x,y) point and the major axis, but a parameter, so we
            // can't get it straight from a dot product between a point and the axis.
            // I'll call it an angle, though.

            // dot products between inward unit vector and intersection vectors
            var d01 = ihat.dotProduct(b01);
            var d0s = ihat.dotProduct(b0s);
            var d1s = ihat.dotProduct(b1s);

            // determine starting angle params for each ellipse; the major axis is at
            // 0, the intersection of the ellipse with the inward point is at the
            // starting angle, (starting angle - pi) is the ending angle
            var s01 = acos(mio * d01 / m01);
            var s0s = acos(mio * d0s / m0s);
            var s1s = acos(mio * d1s / m1s);

            // ellipse major axis length is m01... with unit vectors b01...; now
            // compute minor axes with length n01... and unit vectors c01...

            // unit vectors along minor axes
            var c01 = projectOut(ihat, b01).normalize();
            var c0s = projectOut(ihat, b0s).normalize();
            var c1s = projectOut(ihat, b1s).normalize();

            // minor axis magnitudes
            var n01 = mio * Math.sqrt(1 - d01 * d01) / Math.sin(s01);
            var n0s = mio * Math.sqrt(1 - d0s * d0s) / Math.sin(s0s);
            var n1s = mio * Math.sqrt(1 - d1s * d1s) / Math.sin(s1s);

            // put the calculated points into the geometry

            // indices of inward and outward vertices
            var inidx = vertices.length;
            var outidx = inidx + 1;
            // push inward and outward vertices
            vertices.push(this.v.clone().addScaledVector(ihat, mio));
            vertices.push(this.v.clone().addScaledVector(ihat, -mio));

            // number of verts in each elliptical arc, excluding endpoints
            var scount = (subdivs - 2) / 2;
            var scount1 = scount + 1;

            // start indices of each arc
            var s01idx = vertices.length;
            var s0sidx = s01idx + scount;
            var s1sidx = s0sidx + scount;

            // push the arc vertices, excluding inward and outward vertices (which are
            // the endpoints of all three arcs)
            for (var ia = 1; ia < scount1; ia++) {
                var a = s01 - ia * Math.PI / scount1;
                vertices.push(
                    this.v.clone()
                        .addScaledVector(b01, m01 * Math.cos(a))
                        .addScaledVector(c01, n01 * Math.sin(a))
                );
            }
            for (var ia = 1; ia < scount1; ia++) {
                var a = s0s - ia * Math.PI / scount1;
                vertices.push(
                    this.v.clone()
                        .addScaledVector(b0s, m0s * Math.cos(a))
                        .addScaledVector(c0s, n0s * Math.sin(a))
                );
            }
            for (var ia = 1; ia < scount1; ia++) {
                var a = s1s - ia * Math.PI / scount1;
                vertices.push(
                    this.v.clone()
                        .addScaledVector(b1s, m1s * Math.cos(a))
                        .addScaledVector(c1s, n1s * Math.sin(a))
                );
            }

            // build the profiles; each profile is an array of indices into the vertex
            // array, denoting a vertex loop

            // looking into (against) the strut vectors, profiles 0 and 1 are wound CCW,
            // while profile s is wound CW
            // determining orientation: looking down the inward vector with vs pointing
            // down, there are two possibilities for 0/1 (0 on the left and 1 on the
            // right or vice versa), and we can determine which with a cross product;
            // given this, for every profile there will be a left and right arc (looking
            // into the strut vector) and the right arc will wind in reverse order

            // if this is > 0, 0 is on the left; else 1 is on the left
            var dir = ihat.clone().crossProduct(vs).dotProduct(v0);
            if (equal(dir, 0)) dir = -ihat.clone().crossProduct(vs).dotProduct(v1);

            // s strut left and right indices
            var idxsL = dir > 0 ? s0sidx : s1sidx;
            var idxsR = dir > 0 ? s1sidx : s0sidx;
            // 0 strut left and right indices
            var idx0L = dir > 0 ? s0sidx : s01idx;
            var idx0R = dir > 0 ? s01idx : s0sidx;
            // 1 strut left and right indices
            var idx1L = dir > 0 ? s01idx : s1sidx;
            var idx1R = dir > 0 ? s1sidx : s01idx;

            // profile arrays
            var ps = [];
            var p0 = [];
            var p1 = [];

            // write inward verts
            ps.push(inidx);
            p0.push(inidx);
            p1.push(inidx);

            // write left arcs
            for (var ia = 0; ia < scount; ia++) {
                ps.push(idxsL + ia);
                p0.push(idx0L + ia);
                p1.push(idx1L + ia);
            }

            // write outward verts
            ps.push(outidx);
            p0.push(outidx);
            p1.push(outidx);

            // write right arcs
            for (var ia = scount - 1; ia >= 0; ia--) {
                ps.push(idxsR + ia);
                p0.push(idx0R + ia);
                p1.push(idx1R + ia);
            }

            // store profiles
            this.ps = ps;
            this.p0 = p0;
            this.p1 = p1;
        }

        if (this.b0) this.b0.makeProfiles(params);
        if (this.b1) this.b1.makeProfiles(params);
    }

    public connectProfiles(params: TreeWriteParams) {
        var geo = params.geo;
        var vertices = geo.vertices;
        var faces = geo.faces;

        if (this.isRoot()) {
            this.connectToBranch(this.b0, params);
            this.makeCap(params);
        }
        else if (this.isLeaf()) {
            this.makeCap(params);
        }
        else {
            this.connectToBranch(this.b0, params);
            this.connectToBranch(this.b1, params);
        }

        if (this.b0) this.b0.connectProfiles(params);
        if (this.b1) this.b1.connectProfiles(params);
    }

    public connectToBranch(n: SupportTreeNode, params) {
        if (!n) return;

        var geo = params.geo;
        var vertices = geo.vertices;
        var faces = geo.faces;

        var subdivs = params.subdivs;

        // source and target profiles
        var sp = (n === this.b0) ? this.p0 : this.p1;
        var tp = n.ps;

        // unit vector pointing up to other node
        var vn = n.v.clone().subVectors(n.v, this.v).normalize();

        // start index on target profile
        var tidx = 0;
        // maximal dot product between points from source to target
        var maxdot = 0;

        // arbitrary point on source profile
        var spt = vertices[sp[0]];

        // given this point on source profile, find the most closely matching point
        // on target profile
        for (var ii = 0; ii < subdivs; ii++) {
            var vst, dot;

            // unit vector from source point to target point
            vst = vertices[tp[ii]].clone().subVectors(vertices[tp[ii]], spt).normalize();

            dot = vst.dotProduct(vn);
            if (dot > maxdot) {
                maxdot = dot;
                tidx = ii;
            }
        }

        for (var ii = 0; ii < subdivs; ii++) {
            var a = tp[(tidx + ii) % subdivs];
            var b = tp[(tidx + ii + 1) % subdivs];
            var c = sp[ii];
            var d = sp[(ii + 1) % subdivs];

            faces.push(new Face(a, c, d));
            faces.push(new Face(a, d, b));
        }
    }

    public makeCap(params) {
        var geo = params.geo;
        var vertices = geo.vertices;
        var faces = geo.faces;

        var subdivs = params.subdivs;

        // get the profile and the incoming strut vector
        var p, vn;

        if (this.isRoot()) {
            p = this.p0;
            vn = this.v.clone().subVectors(this.v, this.b0.v).normalize();
        }
        else if (this.isLeaf()) {
            p = this.ps;
            vn = this.v.clone().subVectors(this.v, this.source.v).normalize();
        }
        else return;

        // index increment (accounts for opposite winding)
        var iincr = this.isRoot() ? subdivs - 1 : 1

        // index of center vertex
        var pc = p[subdivs];

        // write faces
        for (var ii = 0; ii < subdivs; ii++) {
            faces.push(new Face(pc, p[ii], p[(ii + iincr) % subdivs]));
        }
    }

    public offsetLimit(radius) {
        var isRoot = this.isRoot();
        var isLeaf = this.isLeaf();

        // if internal node, return no limit
        if (!(isRoot || isLeaf)) return Infinity;

        // other node connected to this node, and the two nodes connected to that
        var n: SupportTreeNode, a: SupportTreeNode, b: SupportTreeNode;

        // branch node 0 if root; source if leaf
        n = isRoot ? this.b0 : this.source;

        // if node is isolated (shouldn't happen), return 0
        if (!n) return 0;

        // length of the strut
        // var l = this.v.distanceTo(n.v);
        var l = Vector3.distance(this.v, n.v);

        // root connects to leaf - can offset by <= half the length of the strut
        if (n.isLeaf() || n.isRoot()) return l / 2;

        // if root, a and b are the two branch nodes from n
        if (isRoot) {
            a = n.b0;
            b = n.b1;
        }
        // if leaf, a and b are n's other branch and its source
        else {
            a = (this === n.b0) ? n.b1 : n.b0;
            b = n.source;
        }

        // unit vectors along n strut
        var vn: Vector3 = this.v.clone().subVectors(this.v, n.v).normalize();

        // extents of struts a and b (due to their thickness) along n
        var ea = 0, eb = 0;

        if (a) {
            // unit vector along a strut
            var va = a.v.clone().subVectors(a.v, n.v).normalize();

            // bisector between n and a
            var bna = vn.clone().add(va).normalize();

            // dot product between vn and a-n bisector
            var dna = vn.dotProduct(bna);

            // how far strut a's intersection point with n extends along n strut;
            // equal to radius / tan (acos (vn dot bna)) with
            // tan (acos x) = sqrt (1 - x*x) / x
            var ea = radius * dna / Math.sqrt(1 - dna * dna);
        }

        // failsafe in case either strut is parallel to n strut
        //if (equal(dna, 0) || equal(dnb, 0)) return 0;

        if (b) {
            // unit vector along b strut
            var vb = b.v.clone().subVectors(b.v, n.v).normalize();

            // bisector between n and b
            var bnb = vn.clone().add(vb).normalize();

            // dot product between vn and b-n bisector
            var dnb = vn.dotProduct(bnb);

            // // how far strut a's intersection point with n extends along n strut;
            // // equal to radius / tan (acos (vn dot bna)) with
            // // tan (acos x) = sqrt (1 - x*x) / x
            // b = radius * dnb / Math.sqrt(1 - dnb * dnb);
        }

        // limit is strut length minus the largest of these two extents
        var limit = l - Math.max(ea, eb);

        return limit;
    }

    public debug() {
        // if (this.b0) {
        //     debug.line(this.v, this.b0.v);
        //     this.b0.debug();
        // }
        // if (this.b1) {
        //     debug.line(this.v, this.b1.v);
        //     this.b1.debug();
        // }

        // if (this.isRoot()) debug.lines(12);
    }
}
