import { test, end, expect } from '../util'
import {
    RenderStage,
    ResourceHandle,
    RenderFeature,
    RenderGraph,
    topoSort,
    GraphValidator,
    CyclicDependencyError,
    UnresolvedResourceError,
    StageConstraintViolation,
    DuplicateWriterError,
    type FeatureContext,
} from '@orillusion/core'

// -----------------------------------------------------------------------------
// Test fixtures
// -----------------------------------------------------------------------------

class FakeFeature extends RenderFeature {
    public readonly name: string
    public readonly stage: RenderStage
    public declare readonly reads: readonly string[]
    public declare readonly writes: readonly string[]
    public executed = 0
    constructor(name: string, stage: RenderStage, reads: string[] = [], writes: string[] = []) {
        super()
        this.name = name
        this.stage = stage
        ;(this as any).reads = reads
        ;(this as any).writes = writes
    }
    execute(_ctx: FeatureContext): void { this.executed++ }
}

function producersOf(features: RenderFeature[]): Map<string, string[]> {
    const m = new Map<string, string[]>()
    for (const f of features) {
        for (const w of f.writes) {
            if (!m.has(w)) m.set(w, [])
            m.get(w)!.push(f.name)
        }
    }
    return m
}

// -----------------------------------------------------------------------------
// RenderStage enum — monotone ordering
// -----------------------------------------------------------------------------

await test('RenderStage is strictly ordered from BeforeShadows to Present', async () => {
    const ordered: RenderStage[] = [
        RenderStage.BeforeShadows,
        RenderStage.Shadow,
        RenderStage.PreDepth,
        RenderStage.GI,
        RenderStage.Opaque,
        RenderStage.AfterOpaque,
        RenderStage.Transparent,
        RenderStage.AfterTransparent,
        RenderStage.PrePost,
        RenderStage.Post,
        RenderStage.AfterPost,
        RenderStage.UI,
        RenderStage.Present,
    ]
    for (let i = 1; i < ordered.length; i++) {
        expect(ordered[i] > ordered[i - 1]).toEqual(true)
    }
})

// -----------------------------------------------------------------------------
// ResourceHandle
// -----------------------------------------------------------------------------

await test('ResourceHandle.texture carries name/format/size', async () => {
    const h = ResourceHandle.texture('_MainDepth', 1920, 1080, 'depth32float')
    expect(h.name).toEqual('_MainDepth')
    expect(h.kind).toEqual('texture')
    if (h.desc.kind === 'texture') {
        expect(h.desc.width).toEqual(1920)
        expect(h.desc.height).toEqual(1080)
        expect(h.desc.format).toEqual('depth32float')
        expect(h.desc.arrayLayers).toEqual(1)
    } else {
        throw new Error('desc.kind should be texture')
    }
})

await test('ResourceHandle.buffer carries size/usage', async () => {
    const h = ResourceHandle.buffer('_ClusterLighting', 4096, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST)
    expect(h.kind).toEqual('buffer')
    if (h.desc.kind === 'buffer') {
        expect(h.desc.size).toEqual(4096)
    } else {
        throw new Error('desc.kind should be buffer')
    }
})

await test('ResourceHandle.external has no descriptor payload', async () => {
    const h = ResourceHandle.external('_CanvasTexture')
    expect(h.kind).toEqual('external')
})

// -----------------------------------------------------------------------------
// Topological sort — produces stage-first ordering
// -----------------------------------------------------------------------------

await test('topoSort: linear reads/writes chain produces producer-first order', async () => {
    const a = new FakeFeature('A', RenderStage.Shadow, [], ['_X'])
    const b = new FakeFeature('B', RenderStage.Opaque, ['_X'], ['_Y'])
    const c = new FakeFeature('C', RenderStage.Post, ['_Y'], [])
    const order = topoSort([c, b, a], producersOf([a, b, c]))
    // Stage order forces A → B → C even though insertion order was C,B,A.
    expect(order).toEqual(['A', 'B', 'C'])
})

await test('topoSort: same-stage features tie-break on insertion order', async () => {
    const a = new FakeFeature('A', RenderStage.Opaque, [], [])
    const b = new FakeFeature('B', RenderStage.Opaque, [], [])
    const c = new FakeFeature('C', RenderStage.Opaque, [], [])
    expect(topoSort([a, b, c], producersOf([a, b, c]))).toEqual(['A', 'B', 'C'])
    expect(topoSort([c, a, b], producersOf([c, a, b]))).toEqual(['C', 'A', 'B'])
})

await test('topoSort: data edge beats stage ordering when stages equal', async () => {
    // Both in Opaque, but B reads A's output — A must run first.
    const a = new FakeFeature('A', RenderStage.Opaque, [], ['_X'])
    const b = new FakeFeature('B', RenderStage.Opaque, ['_X'], [])
    // Register in order [B, A] — topo sort must still place A first.
    expect(topoSort([b, a], producersOf([b, a]))).toEqual(['A', 'B'])
})

// -----------------------------------------------------------------------------
// Compile errors
// -----------------------------------------------------------------------------

await test('topoSort throws CyclicDependencyError on reads/writes cycle', async () => {
    const a = new FakeFeature('A', RenderStage.Opaque, ['_Y'], ['_X'])
    const b = new FakeFeature('B', RenderStage.Opaque, ['_X'], ['_Y'])
    let threw: Error | null = null
    try {
        topoSort([a, b], producersOf([a, b]))
    } catch (e) {
        threw = e as Error
    }
    if (!(threw instanceof CyclicDependencyError)) throw new Error('did not throw CyclicDependencyError')
    expect(threw.cycle.length > 0).toEqual(true)
    expect(threw.message.includes('A')).toEqual(true)
    expect(threw.message.includes('B')).toEqual(true)
})

await test('GraphValidator throws UnresolvedResourceError when reads has no producer', async () => {
    const a = new FakeFeature('A', RenderStage.Opaque, ['_MissingResource'], [])
    const v = new GraphValidator([a], new Set())
    let threw: Error | null = null
    try { v.validateResolvable() } catch (e) { threw = e as Error }
    if (!(threw instanceof UnresolvedResourceError)) throw new Error('wrong error type')
    expect(threw.feature).toEqual('A')
    expect(threw.resource).toEqual('_MissingResource')
    expect(threw.message.includes('_MissingResource')).toEqual(true)
    expect(threw.message.includes('A')).toEqual(true)
})

await test('GraphValidator accepts external resources as producer-less reads', async () => {
    const a = new FakeFeature('A', RenderStage.UI, ['_CanvasTexture'], [])
    const v = new GraphValidator([a], new Set(['_CanvasTexture']))
    v.validateResolvable() // should not throw
})

await test('GraphValidator throws StageConstraintViolation for backwards stage reads', async () => {
    // Post-stage feature writes _X, AfterOpaque-stage feature reads _X.
    // Reader stage < writer stage — impossible to satisfy.
    const post = new FakeFeature('LatePost', RenderStage.Post, [], ['_X'])
    const early = new FakeFeature('EarlyHook', RenderStage.AfterOpaque, ['_X'], [])
    const v = new GraphValidator([post, early], new Set())
    let threw: Error | null = null
    try { v.validateStageOrdering() } catch (e) { threw = e as Error }
    if (!(threw instanceof StageConstraintViolation)) throw new Error('wrong error type')
    expect(threw.reader).toEqual('EarlyHook')
    expect(threw.writer).toEqual('LatePost')
    expect(threw.resource).toEqual('_X')
})

await test('GraphValidator throws DuplicateWriterError when two features write the same resource', async () => {
    const a = new FakeFeature('A', RenderStage.Opaque, [], ['_X'])
    const b = new FakeFeature('B', RenderStage.Opaque, [], ['_X'])
    const v = new GraphValidator([a, b], new Set())
    let threw: Error | null = null
    try { v.validateSingleWriter() } catch (e) { threw = e as Error }
    if (!(threw instanceof DuplicateWriterError)) throw new Error('wrong error type')
    expect(threw.resource).toEqual('_X')
    expect(threw.writers.length).toEqual(2)
})

// -----------------------------------------------------------------------------
// RenderGraph
// -----------------------------------------------------------------------------

function ctxStub(): any {
    // RenderGraph only touches ctx for the RTResourceMap.forContext() call
    // and pool.dispose(). We give it a unique stub object so WeakMap works.
    return { __stub: true }
}

await test('RenderGraph.addFeature preserves insertion order', async () => {
    const g = new RenderGraph(ctxStub())
    const a = new FakeFeature('A', RenderStage.Shadow, [], [])
    const b = new FakeFeature('B', RenderStage.Opaque, [], [])
    g.addFeature(a).addFeature(b)
    expect(g.features.length).toEqual(2)
    expect(g.features[0].name).toEqual('A')
})

await test('RenderGraph.addFeature rejects duplicate names', async () => {
    const g = new RenderGraph(ctxStub())
    g.addFeature(new FakeFeature('Shared', RenderStage.Opaque, [], []))
    let threw: Error | null = null
    try { g.addFeature(new FakeFeature('Shared', RenderStage.Post, [], [])) } catch (e) { threw = e as Error }
    if (!threw) throw new Error('did not throw')
    expect(threw.message.includes('Shared')).toEqual(true)
})

await test('RenderGraph.insertAfter / insertBefore respect anchor position', async () => {
    const g = new RenderGraph(ctxStub())
    g.addFeature(new FakeFeature('A', RenderStage.Shadow, [], []))
    g.addFeature(new FakeFeature('C', RenderStage.Opaque, [], []))
    g.insertAfter('A', new FakeFeature('B', RenderStage.Shadow, [], []))
    g.insertBefore('A', new FakeFeature('Z', RenderStage.BeforeShadows, [], []))
    expect(g.features.map(f => f.name)).toEqual(['Z', 'A', 'B', 'C'])
})

await test('RenderGraph.disableFeature skips execute without removing from graph', async () => {
    const g = new RenderGraph(ctxStub())
    const a = new FakeFeature('A', RenderStage.Shadow, [], ['_X'])
    const b = new FakeFeature('B', RenderStage.Opaque, ['_X'], [])
    g.addFeature(a).addFeature(b)
    g.compile()
    g.disableFeature('A')
    g.execute({} as any, {} as any, 0)
    expect(a.executed).toEqual(0)
    expect(b.executed).toEqual(1)
})

await test('RenderGraph.replaceFeature swaps implementation and keeps order', async () => {
    const g = new RenderGraph(ctxStub())
    g.addFeature(new FakeFeature('Color', RenderStage.Opaque, [], ['_ColorBuffer']))
    const custom = new FakeFeature('Color', RenderStage.Opaque, [], ['_ColorBuffer'])
    g.replaceFeature('Color', custom)
    expect(g.getFeature('Color')).toEqual(custom)
})

await test('RenderGraph.compile is idempotent and caches across calls', async () => {
    const g = new RenderGraph(ctxStub())
    g.addFeature(new FakeFeature('A', RenderStage.Shadow, [], ['_X']))
    g.addFeature(new FakeFeature('B', RenderStage.Opaque, ['_X'], []))
    g.compile()
    g.compile() // second call must not throw
})

// -----------------------------------------------------------------------------
// dumpDot — stable output for snapshot testing
// -----------------------------------------------------------------------------

await test('RenderGraph.dumpDot emits stage clusters and reads/writes edges', async () => {
    const g = new RenderGraph(ctxStub())
    g.addFeature(new FakeFeature('Shadow', RenderStage.Shadow, [], ['_ShadowMap']))
    g.addFeature(new FakeFeature('Color', RenderStage.Opaque, ['_ShadowMap'], ['_ColorBuffer']))
    g.addFeature(new FakeFeature('Post', RenderStage.Post, ['_ColorBuffer'], ['_FinalColor']))
    const dot = g.dumpDot()
    expect(dot.startsWith('digraph RenderGraph {')).toEqual(true)
    expect(dot.includes('cluster_10')).toEqual(true) // Shadow
    expect(dot.includes('cluster_40')).toEqual(true) // Opaque
    expect(dot.includes('cluster_90')).toEqual(true) // Post
    expect(dot.includes('"Shadow" -> "Color"')).toEqual(true)
    expect(dot.includes('"Color" -> "Post"')).toEqual(true)
    expect(dot.includes('label="_ShadowMap"')).toEqual(true)
})

setTimeout(end, 500)
