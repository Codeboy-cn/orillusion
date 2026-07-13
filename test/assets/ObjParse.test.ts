import { test, expect, end } from '../util'
import { Engine3D, MeshRenderer, OBJParser, Object3D, VertexAttributeName } from '@orillusion/core'

// Regression tests for audit finding L2: the OBJ parser only split on
// CRLF and only created geometry from `# object` comments, so any
// standard (Blender/Unix) export parsed into garbage or crashed.

function makeParser(engine: any): OBJParser {
    const parser = new OBJParser()
    ;(parser as any).ctx = engine.context3D
    parser.baseUrl = '/'
    parser.initUrl = '/mem.obj'
    return parser
}

const TRI_BODY = [
    'v 0 0 0',
    'v 1 0 0',
    'v 0 1 0',
    'vt 0 0',
    'vt 1 0',
    'vt 0 1',
    'vn 0 0 1',
    'vn 0 0 1',
    'vn 0 0 1',
    'f 1/1/1 2/2/2 3/3/3',
]

function firstGeometry(root: Object3D) {
    const child = (root as any).entityChildren[0]
    return child.getComponent(MeshRenderer).geometry
}

await test('LF-only OBJ with standard o directive parses correct geometry [audit L2]', async () => {
    const engine = await Engine3D.init()
    const parser = makeParser(engine)
    // \n-joined — the old split("\r\n") saw one giant line and crashed.
    await parser.parseString(['o Tri', ...TRI_BODY].join('\n'))

    const root = parser.data as Object3D
    expect((root as any).entityChildren.length).toEqual(1)
    const geo = firstGeometry(root)
    expect(geo.getAttribute(VertexAttributeName.position).data.length).toEqual(9)
    expect(geo.getAttribute(VertexAttributeName.indices).data.length).toEqual(3)
})

await test('OBJ without any object declaration falls back to a default bucket [audit L2]', async () => {
    const engine = await Engine3D.init()
    const parser = makeParser(engine)
    await parser.parseString(TRI_BODY.join('\n'))

    const root = parser.data as Object3D
    expect((root as any).entityChildren.length).toEqual(1)
    expect(firstGeometry(root).getAttribute(VertexAttributeName.position).data.length).toEqual(9)
})

await test('g directive and usemtl without mtllib parse safely [audit L2]', async () => {
    const engine = await Engine3D.init()
    const parser = makeParser(engine)
    await parser.parseString(['g Grouped', 'usemtl missingMat', ...TRI_BODY].join('\n'))

    const root = parser.data as Object3D
    // usemtl referencing a material with no mtllib keeps the default
    // material instead of crashing on matData.map_Kd.
    expect((root as any).entityChildren.length).toEqual(1)
})

await test('legacy CRLF "# object" format does not regress [audit L2]', async () => {
    const engine = await Engine3D.init()
    const parser = makeParser(engine)
    await parser.parseString(['# object Legacy', ...TRI_BODY].join('\r\n'))

    const root = parser.data as Object3D
    expect((root as any).entityChildren.length).toEqual(1)
    expect(firstGeometry(root).getAttribute(VertexAttributeName.position).data.length).toEqual(9)
})

setTimeout(end, 500)
