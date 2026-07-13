# Orillusion Engine Math & Rendering Conventions

This page pins down the conventions the engine assumes everywhere. They
differ from the OpenGL-style defaults many math references use — code
ported from GL-convention engines will silently misbehave (reversed
depth sort order, mirrored X, flipped rotations) unless it follows the
table below.

| Topic | Convention |
|---|---|
| Handedness | **Left-handed** |
| Forward axis | **+Z** (camera looks down +Z; GL-style references assume −Z) |
| Up axis | +Y |
| Matrix storage | **Column-major** `Float32Array(16)`; translation lives in `rawData[12..14]` |
| Vector transform | Column vectors: `v' = M · v` |
| Euler order | **ZYX** (`Quaternion.setFromEuler` / `getEulerAngles` round-trip in ZYX) |
| Euler units | Degrees at every public API (`rotationX`, `setFromEuler`, …) |
| Depth range | `[0, 1]` (D3D-style zero-to-one, not GL `[-1, 1]`) |
| Ortho projection X | The in-use ortho path (`orthoOffCenter`) negates X (`-2/(r-l)`) — self-consistent with the LH/+Z conventions above |
| Triangle winding | Front faces follow the left-handed convention; all built-in geometry (Plane/Box/Sphere/Cylinder) is consistent |

## Matrix multiplication pitfalls

- `Matrix4.prototype.multiply(b)` computes **`this = b · this`** — i.e. it
  is a *premultiply*, the same operation as `premultiply(b)`. This is the
  opposite of what the name suggests and the opposite of the static
  `Matrix4.multiplyMatrices(a, b)` (which computes `a · b`). Prefer the
  static form or `append` when the order matters — it usually does.
- `Matrix4.getEuler(target, quat, isDegree, order)` defaults `order` to
  `'XYZ'`, but the engine's own euler round-trip convention is `'ZYX'`.
  Pass `'ZYX'` explicitly when you want values that match
  `Transform.rotationX/Y/Z` and `Quaternion.getEulerAngles`.

## Related sharp edges (fixed on this branch, kept for context)

- `decompose(Orientation3D.EULER_ANGLES)` near ±180° rotations — fixed
  (audit M1).
- `Ray.getPoint` used to mutate the ray — fixed (audit M2).
- `Matrix4.transpose` used the shared `helpMatrix` as scratch — fixed
  (audit M8). The `helpMatrix`/`help_matrix_*` statics are shared
  scratch space: never hold values in them across calls into engine
  math.
