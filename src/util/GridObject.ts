import { UnLitMaterial, Color, MeshRenderer, BlendMode, GeometryBase, VertexAttributeName, BoxGeometry } from "..";
import { Object3D } from "../core/entities/Object3D";

/**
 * An object contains grids - two dimensional arrrys of lines
 * @group Util
 */
export class GridObject extends Object3D {
    public size: number = 100;

    public divisions: number = 10;

    constructor(size: number = 100, divisions: number = 10) {
        super();
        this.size = size;
        this.divisions = divisions;
        this.buildGeometry();
        this.addAxis();
    }

    private buildGeometry() {
        // Build the grid as ONE merged mesh of thin triangle-list
        // boxes (one box per line) instead of a single line-list
        // primitive. line-list rasterization on Metal in this
        // engine's pipeline doesn't depth-test correctly against
        // opaque triangle geometry — grid lines through opaque
        // cubes / props draw on top instead of being occluded.
        // Triangle-list boxes go through the standard depth path.
        // Merging into a single buffer keeps the cost to one draw
        // call regardless of grid density.
        const step = this.size / this.divisions;
        const halfSize = this.size / 2;
        const center = this.divisions / 2;
        const thickness = halfSize * 0.0008;  // ~0.4 unit at size=1000
        const t = thickness * 0.5;

        const positions: number[] = [];
        const indices: number[] = [];

        // Append a thin box centered at (cx, 0, cz) spanning
        // (lx × ly × lz). 8 verts, 12 triangles per box.
        const addBox = (cx: number, cz: number, lx: number, lz: number) => {
            const x0 = cx - lx * 0.5, x1 = cx + lx * 0.5;
            const y0 = -t,            y1 = t;
            const z0 = cz - lz * 0.5, z1 = cz + lz * 0.5;
            const base = positions.length / 3;
            positions.push(
                x0, y0, z0,  x1, y0, z0,  x1, y1, z0,  x0, y1, z0,
                x0, y0, z1,  x1, y0, z1,  x1, y1, z1,  x0, y1, z1,
            );
            // 6 faces × 2 triangles
            const face = (a: number, b: number, c: number, d: number) => {
                indices.push(base + a, base + b, base + c, base + a, base + c, base + d);
            };
            face(0, 1, 2, 3); // -Z
            face(5, 4, 7, 6); // +Z
            face(4, 0, 3, 7); // -X
            face(1, 5, 6, 2); // +X
            face(3, 2, 6, 7); // +Y
            face(4, 5, 1, 0); // -Y
        };

        for (let i = 0, k = -halfSize; i <= this.divisions; i++, k += step) {
            if (i === center) continue;
            // Row along X at z=k
            addBox(0, k, this.size, thickness);
            // Column along Z at x=k
            addBox(k, 0, thickness, this.size);
        }

        const grid = new GeometryBase();
        grid.setIndices(indices.length > 65535 ? new Uint32Array(indices) : new Uint16Array(indices));
        grid.setAttribute(VertexAttributeName.position, new Float32Array(positions));
        grid.addSubGeometry({
            indexStart: 0,
            indexCount: indices.length,
            vertexStart: 0,
            vertexCount: 0,
            firstStart: 0,
            index: 0,
            topology: 0,
        });

        let mat = new UnLitMaterial();
        mat.baseColor = new Color(1, 1, 1, 0.5);
        mat.blendMode = BlendMode.NORMAL;
        mat.castReflection = false;
        let mr = this.addComponent(MeshRenderer);
        mr.geometry = grid;
        mr.material = mat;
    }

    private addAxis() {
        // Use a thin BoxGeometry instead of line-list topology for the
        // colored axis indicators. Line-list rasterization on Metal
        // has subtle depth interactions in this engine's pipeline
        // (zPrePass + transparent state) that let the colored axes
        // draw through opaque geometry — the workaround that fixes it
        // for triangles (BlendMode.NORMAL → opaque pass, full depth
        // test) doesn't fully fix it for line-list. Thin triangle-list
        // boxes use the standard depth path and depth-test the same
        // way as any other opaque mesh.
        const halfSize = this.size / 2;
        // ~1 unit cross-section at size=1000 (1 world unit). Thicker
        // than strictly necessary visually, but eliminates any
        // depth-precision / sub-pixel concerns that thinner geometry
        // could introduce — boxes need enough Z-range so their
        // back-face is clearly behind opaque cube fragments.
        const thickness = halfSize * 0.002;

        {
            let x = new Object3D();
            let mr = x.addComponent(MeshRenderer);
            mr.geometry = new BoxGeometry(this.size, thickness, thickness);
            let mat = mr.material = new UnLitMaterial();
            mat.baseColor = new Color(1, 0, 0, 1);
            mat.blendMode = BlendMode.NORMAL;
            mat.castReflection = false;
            this.addChild(x)
        }
        {
            let z = new Object3D();
            let mr = z.addComponent(MeshRenderer);
            mr.geometry = new BoxGeometry(thickness, thickness, this.size);
            let mat = mr.material = new UnLitMaterial();
            mat.baseColor = new Color(0, 1, 0, 1);
            mat.blendMode = BlendMode.NORMAL;
            mat.castReflection = false;
            this.addChild(z)
        }
    }
}
