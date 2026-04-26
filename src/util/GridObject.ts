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
        const vertices = []
        const indices = []
		const step = this.size / this.divisions;
		const halfSize = this.size / 2;
        const center = this.divisions / 2;

        for ( let i = 0, k = - halfSize; i <= this.divisions; i ++, k += step ) {
            if(i === center )
                continue;
			vertices.push( - halfSize, 0, k, halfSize, 0, k );
			vertices.push( k, 0, - halfSize, k, 0, halfSize );
		}
        for( let i = 0; i < vertices.length/3; i +=2 )
            indices.push(i, i + 1);

        let grid = new GeometryBase()
        grid.setIndices(indices.length > Uint16Array.length ? new Uint32Array(indices) : new Uint16Array(indices));
        grid.setAttribute(VertexAttributeName.position, new Float32Array(vertices));
        grid.addSubGeometry({
            indexStart: 0,
            indexCount: indices.length,
            vertexStart: 0,
            vertexCount: 0,
            firstStart: 0,
            index: 0,
            topology: 0
        })

        let mat = new UnLitMaterial();
        mat.topology = "line-list";
        mat.baseColor = new Color(1, 1, 1, 0.15);
        mat.blendMode = BlendMode.ADD;
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
