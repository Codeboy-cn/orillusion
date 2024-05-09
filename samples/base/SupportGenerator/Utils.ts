import { Vector3 } from "@orillusion/core";

const epsilonDefault = 1e-5;
const axisDefault = 'z';

export function cycleAxis(axis) {
  if (axis == 'x') return 'y';
  else if (axis == 'y') return 'z';
  else return 'x';
}

// for calculating triangle area and efficient cross-products

// u cross v = (uy vz - uz vy, uz vx - ux vz, ux vy - uy vx)
// u = b - a; v = c - a; u cross v = 2 * area
// (b-a) cross (c-a) = 2 * area = (
//  (by-ay)(cz-az) - (bz-az)(cy-ay),
//  (bz-az)(cx-ax) - (bx-ax)(cz-az),
//  (bx-ax)(cy-ay) - (by-ay)(cx-ax),
// )
// calculate triangle area
function triangleArea(a, b, c, axis) {
  if (axis === undefined) axis = axisDefault;

  return cornerCrossProduct(a, b, c, axis) / 2;
}
// calculates cross product of b-a and c-a
function cornerCrossProduct(a, b, c, axis) {
  if (axis === undefined) axis = axisDefault;

  if (axis == "x") return (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
  if (axis == "y") return (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
  if (axis == "z") return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return 0;
}

// returns an orthogonal vector to v
// default is vector with 0 z-component, but, if v only has a z-component,
// return vector along x 
export function orthogonalVector(v) {
  if (v.x === 0 && v.y === 0) return new Vector3(1, 0, 0);
  else return new Vector3(v.y, -v.x, 0).normalize();
}

// true if c is strictly left of a-b segment
function left(a, b, c, axis, epsilon) {
  if (axis === undefined) axis = axisDefault;
  if (epsilon === undefined) epsilon = epsilonDefault;

  var area = triangleArea(a, b, c, axis);

  return greater(area, 0, epsilon);
}

export function pointInsideTriangle(p, a, b, c, axis, epsilon) {
  if (axis === undefined) axis = axisDefault;
  if (epsilon === undefined) epsilon = epsilonDefault;

  return left(a, b, p, axis, epsilon) &&
    left(b, c, p, axis, epsilon) &&
    left(c, a, p, axis, epsilon);
}

// approximate equality for real numbers
export function equal(i, j, epsilon?) {
  if (epsilon === undefined) epsilon = epsilonDefault;

  var test = false;
  if (test) {
    if (j === 0) return Math.abs(i) < epsilon;
    else return Math.abs(i / j - 1) < epsilon;
  }
  else {
    return equalSimple(i, j, epsilon);
  }
}

function equalSimple(i, j, epsilon) {
  if (i === Infinity || j === Infinity) return i === j;

  return Math.abs(i - j) < epsilon;
}

// approximate less-than testing for real numbers
function less(i, j, epsilon) {
  if (epsilon === undefined) epsilon = epsilonDefault;
  return i < j && !equal(i, j, epsilon);
}

// approximate greater-than testing for real numbers
function greater(i, j, epsilon) {
  if (epsilon === undefined) epsilon = epsilonDefault;
  return i > j && !equal(i, j, epsilon);
}

// standard sorting-type comparator; useful when building more complicated
// comparators because calling less() and greater() together results in two
// equal() checks
function compare(i, j, epsilon) {
  if (epsilon === undefined) epsilon = epsilonDefault;

  if (equal(i, j, epsilon)) return 0;
  else if (i < j) return -1;
  else return 1;
}


// element max/min
export function vector3MaxElement(v: Vector3) {
  return Math.max(v.x, v.y, v.z);
}
export function vector3MinElement(v: Vector3) {
  return Math.min(v.x, v.y, v.z);
}
// return 'x', 'y', or 'z' depending on which element is greater/lesser
export function vector3ArgMax(v: Vector3) {
  return v.x>v.y ? (v.x>v.z ? 'x' : 'z') : (v.y>v.z ? 'y' : 'z');
}
export function vector3ArgMin(v: Vector3) {
  return v.x<v.y ? (v.x<v.z ? 'x' : 'z') : (v.y<v.z ? 'y' : 'z');
}
function clamp(x, minVal, maxVal) {
  if (x < minVal) x = minVal;
  else if (x > maxVal) x = maxVal;
  return x;
}
function inRange(x, minVal, maxVal) {
  return (minVal===undefined || x >= minVal) && (maxVal===undefined || x <= maxVal);
}
function vector3Abs(v) {
  var result = new Vector3();
  result.x = Math.abs(v.x);
  result.y = Math.abs(v.y);
  result.z = Math.abs(v.z);
  return result;
}
function vector3AxisMin(v1, v2, axis) {
  if (v1[axis] < v2[axis]) return v1;
  else return v2;
}
function vector3AxisMax(v1, v2, axis) {
  if (v1[axis] > v2[axis]) return v1;
  else return v2;
}


// clamps a to [-1, 1] range and returns its acos
export function acos(a) {
  return Math.acos(clamp(a, -1, 1));
}
// clamps a to [-1, 1] range and returns its asin
export function asin(a) {
  return Math.asin(clamp(a, -1, 1));
}

// given a point p, and a plane containing point d with normal n, project p to
// the plane along axis
// as the plane is the set of points r s.t. (r-d) dot n = 0, r dot n = d dot n;
// if axis is z, rz = (d dot n - rx*nx - ry*ny) / nz
// if nz == 0, then we can't project, so just return p
export function projectToPlaneOnAxis(p: Vector3, d: Vector3, n: Vector3, axis: string) {
  if (axis === undefined) axis = axisDefault;

  var ah = cycleAxis(axis);
  var av = cycleAxis(ah);

  // return p if can't project
  if (n[axis] === 0) return p;

  // get the .axis component
  var rz = (d.dotProduct(n) - p[ah] * n[ah] - p[av] * n[av]) / n[axis];

  // set the component
  var pp = p.clone();
  pp[axis] = rz;

  return pp;
}

// takes v and projects out the n component; n is assumed normalized
export function projectOut(v: Vector3, n: Vector3) {
  var projection = n.clone().multiplyScalar(v.dotProduct(n));
  return v.clone().subVectors(v, projection);
}

// find the highest point of intersection between two cones; the cones have
// origins p and q, both open downward on axis, and both have walls forming
// the given angle (in radians) with the axis
// if one cone's origin is inside the other cone, return null
// principle:
// points P and P cast rays at the given angle with the vertical to the closest
// intersection I; first move Q along the I-Q line such that it's level with P
// on axis, find the midpoint of the P-Q line, then move that point down by
// (1/2)|P-Q|/tan(angle)
export function coneConeIntersection(p: Vector3, q: Vector3, angle, axis) {
  if (p === q) return null;

  var up = new Vector3();
  up[axis] = 1;

  var cos = Math.cos(angle);
  var d = q.clone().subVectors(q, p).normalize();

  var dot = -d.dotProduct(up);
  // if p's cone contains q or vice versa, no intersection
  if (dot > cos || dot < cos - 1) return null;

  // horizontal (orthogonal to axis), normalized vector from p to q
  d[axis] = 0;
  d.normalize();

  var tan = Math.tan(angle);

  // lift or lower q to be level with p on axis
  var diff = q[axis] - p[axis];
  var qnew = q.clone();
  qnew.addScaledVector(up, -diff);
  qnew.addScaledVector(d, -diff * tan);

  // get the midpoint, lower it as described above, that's the intersection
  var midpoint = p.clone().add(qnew).divideScalar(2);
  var len = Vector3.distance(midpoint, p);// midpoint.distanceTo(p);
  midpoint[axis] -= len / tan;

  return midpoint;
}

// get THREE.Face3 vertices
export function faceGetVerts(face, vertices: Vector3[]): Vector3[] {
  return [
    vertices[face.a],
    vertices[face.b],
    vertices[face.c]
  ];
}


function isArray(item) {
  return (Object.prototype.toString.call(item) === '[object Array]');
}

function isString(item) {
  return (typeof item === 'string' || item instanceof String);
}

function isNumber(item) {
  return (typeof item === 'number');
}

function isFunction(item) {
  return (typeof item === 'function');
}

export function isInfinite(n) {
  return n==Infinity || n==-Infinity;
}
