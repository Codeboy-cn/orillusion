import { test, end, expect } from '../util'
import {
    RenderStage,
    RenderGraphPass,
    RenderGraph,
    topoSort,
    GraphValidator,
    CyclicDependencyError,
    UnresolvedResourceError,
    StageConstraintViolation,
    DuplicateCreatorError,
    type RenderGraphBuilder,
    type RenderGraphPassContext,
} from '@orillusion/core'

// -----------------------------------------------------------------------------
// Test fixtures
// -----------------------------------------------------------------------------

interface FakeConfig {
    name: string
    stage: RenderStage
    reads?: string[]
    writes?: string[]      // resources this pass creates (single-creator)
    mutates?: string[]     // resources this pass writes without creating (multi-mutator)
}

class FakePass extends RenderGraphPass {
    public readonly name: string
    public readonly stage: RenderStage
    public executed = 0

    constructor(public readonly config: FakeConfig) {
        super()
        this.name = config.name
        this.stage = config.stage
    }

    public setup(b: RenderGraphBuilder): void {
        for (const r of this.config.reads ?? []) b.read(r)
        for (const w of this.config.writes ?? []) b.write(w, () => ({ name: w }))
        for (const m of this.config.mutates ?? []) b.write(m)
    }

    public execute(_ctx: RenderGraphPassContext): void {
        this.executed++
    }
}

/** Build a topo input in old-style (pass list, byName, insertedOrder). */
function makeTopoInput(passes: { name: string; stage: RenderStage; reads?: string[]; writes?: string[] }[]) {
    const byName = new Map<string, RenderGraphPass>()
    const order = new Map<string, number>()
    const arr: RenderGraphPass[] = []
    passes.forEach((p, i) => {
        const fp = new FakePass({ name: p.name, stage: p.stage, reads: p.reads, writes: p.writes })
        // Test fixtures bypass graph.add() and stamp reads/writes/creates directly.
        ;(fp as any).reads = Object.freeze([...(p.reads ?? [])])
        ;(fp as any).writes = Object.freeze([...(p.writes ?? [])])
        ;(fp as any).creates = Object.freeze([...(p.writes ?? [])])
        byName.set(p.name, fp)
        order.set(p.name, i)
        arr.push(fp)
    })
    return { passes: arr, byName, insertedOrder: (p: RenderGraphPass) => order.get(p.name)! }
}

/** A view stub that satisfies RenderGraph's constructor minimum. */
function viewStub(): any {
    const ctxStub = { __stub: true, addEventListener: undefined, removeEventListener: undefined }
    return { engine3D: { context3D: ctxStub } }
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
// Topological sort — produces stage-first ordering
// -----------------------------------------------------------------------------

await test('topoSort: linear reads/writes chain produces producer-first order', async () => {
    const { passes, byName, insertedOrder } = makeTopoInput([
        { name: 'C', stage: RenderStage.Post, reads: ['_Y'], writes: [] },
        { name: 'B', stage: RenderStage.Opaque, reads: ['_X'], writes: ['_Y'] },
        { name: 'A', stage: RenderStage.Shadow, reads: [], writes: ['_X'] },
    ])
    const order = topoSort(passes, byName, insertedOrder)
    // Stage order forces A → B → C even though insertion order was C,B,A.
    expect(order).toEqual(['A', 'B', 'C'])
})

await test('topoSort: same-stage passes tie-break on insertion order', async () => {
    const t1 = makeTopoInput([
        { name: 'A', stage: RenderStage.Opaque },
        { name: 'B', stage: RenderStage.Opaque },
        { name: 'C', stage: RenderStage.Opaque },
    ])
    expect(topoSort(t1.passes, t1.byName, t1.insertedOrder)).toEqual(['A', 'B', 'C'])
    const t2 = makeTopoInput([
        { name: 'C', stage: RenderStage.Opaque },
        { name: 'A', stage: RenderStage.Opaque },
        { name: 'B', stage: RenderStage.Opaque },
    ])
    expect(topoSort(t2.passes, t2.byName, t2.insertedOrder)).toEqual(['C', 'A', 'B'])
})

await test('topoSort: data edge beats stage ordering when stages equal', async () => {
    const { passes, byName, insertedOrder } = makeTopoInput([
        { name: 'B', stage: RenderStage.Opaque, reads: ['_X'], writes: [] },
        { name: 'A', stage: RenderStage.Opaque, reads: [], writes: ['_X'] },
    ])
    expect(topoSort(passes, byName, insertedOrder)).toEqual(['A', 'B'])
})

// -----------------------------------------------------------------------------
// Compile errors
// -----------------------------------------------------------------------------

await test('topoSort throws CyclicDependencyError on reads/writes cycle', async () => {
    const { passes, byName, insertedOrder } = makeTopoInput([
        { name: 'A', stage: RenderStage.Opaque, reads: ['_Y'], writes: ['_X'] },
        { name: 'B', stage: RenderStage.Opaque, reads: ['_X'], writes: ['_Y'] },
    ])
    let threw: Error | null = null
    try { topoSort(passes, byName, insertedOrder) } catch (e) { threw = e as Error }
    if (!(threw instanceof CyclicDependencyError)) throw new Error('did not throw CyclicDependencyError')
    expect(threw.cycle.length > 0).toEqual(true)
    expect(threw.message.includes('A')).toEqual(true)
    expect(threw.message.includes('B')).toEqual(true)
})

await test('GraphValidator throws UnresolvedResourceError when reads has no creator', async () => {
    const { passes } = makeTopoInput([
        { name: 'A', stage: RenderStage.Opaque, reads: ['_MissingResource'], writes: [] },
    ])
    const v = new GraphValidator(passes)
    let threw: Error | null = null
    try { v.validateResolvable() } catch (e) { threw = e as Error }
    if (!(threw instanceof UnresolvedResourceError)) throw new Error('wrong error type')
    expect(threw.pass).toEqual('A')
    expect(threw.resource).toEqual('_MissingResource')
})

await test('GraphValidator throws StageConstraintViolation for backwards stage reads', async () => {
    const { passes } = makeTopoInput([
        { name: 'LatePost', stage: RenderStage.Post, reads: [], writes: ['_X'] },
        { name: 'EarlyHook', stage: RenderStage.AfterOpaque, reads: ['_X'], writes: [] },
    ])
    const v = new GraphValidator(passes)
    let threw: Error | null = null
    try { v.validateStageOrdering() } catch (e) { threw = e as Error }
    if (!(threw instanceof StageConstraintViolation)) throw new Error('wrong error type')
    expect(threw.downstream).toEqual('EarlyHook')
    expect(threw.upstream).toEqual('LatePost')
    expect(threw.resource).toEqual('_X')
})

await test('GraphValidator throws DuplicateCreatorError when two passes create the same resource', async () => {
    const { passes } = makeTopoInput([
        { name: 'A', stage: RenderStage.Opaque, reads: [], writes: ['_X'] },
        { name: 'B', stage: RenderStage.Opaque, reads: [], writes: ['_X'] },
    ])
    const v = new GraphValidator(passes)
    let threw: Error | null = null
    try { v.validateSingleCreator() } catch (e) { threw = e as Error }
    if (!(threw instanceof DuplicateCreatorError)) throw new Error('wrong error type')
    expect(threw.resource).toEqual('_X')
    expect(threw.creators.length).toEqual(2)
})

// -----------------------------------------------------------------------------
// RenderGraph — factory API
// -----------------------------------------------------------------------------

await test('RenderGraph.add preserves insertion order', async () => {
    const g = new RenderGraph(viewStub())
    g.add(FakePass, { name: 'A', stage: RenderStage.Shadow })
    g.add(FakePass, { name: 'B', stage: RenderStage.Opaque })
    expect(g.passes.length).toEqual(2)
    expect(g.passes[0].name).toEqual('A')
})

await test('RenderGraph.add rejects duplicate names at compile time', async () => {
    const g = new RenderGraph(viewStub())
    g.add(FakePass, { name: 'Shared', stage: RenderStage.Opaque })
    g.add(FakePass, { name: 'Shared', stage: RenderStage.Post })
    let threw: Error | null = null
    try { g.compile() } catch (e) { threw = e as Error }
    if (!threw) throw new Error('did not throw')
    expect(threw.message.includes('Shared')).toEqual(true)
})

await test('RenderGraph.insertAfter / insertBefore respect anchor position', async () => {
    const g = new RenderGraph(viewStub())
    g.add(FakePass, { name: 'A', stage: RenderStage.Shadow })
    g.add(FakePass, { name: 'C', stage: RenderStage.Opaque })
    g.insertAfter('A', FakePass, { name: 'B', stage: RenderStage.Shadow })
    g.insertBefore('A', FakePass, { name: 'Z', stage: RenderStage.BeforeShadows })
    expect(g.passes.map(f => f.name)).toEqual(['Z', 'A', 'B', 'C'])
})

await test('RenderGraph.disablePass skips execute without removing from graph', async () => {
    const g = new RenderGraph(viewStub())
    const a = g.add(FakePass, { name: 'A', stage: RenderStage.Shadow, writes: ['_X'] })
    const b = g.add(FakePass, { name: 'B', stage: RenderStage.Opaque, reads: ['_X'] })
    g.compile()
    g.disablePass('A')
    g.execute({} as any, 0)
    expect(a.executed).toEqual(0)
    expect(b.executed).toEqual(1)
})

await test('RenderGraph.replace swaps implementation and keeps order', async () => {
    const g = new RenderGraph(viewStub())
    g.add(FakePass, { name: 'Color', stage: RenderStage.Opaque, writes: ['_ColorBuffer'] })
    const replaced = g.replace('Color', FakePass, { name: 'Color', stage: RenderStage.Opaque, writes: ['_ColorBuffer'] })
    expect(g.getPass('Color')).toEqual(replaced)
})

await test('RenderGraph.compile is idempotent and caches across calls', async () => {
    const g = new RenderGraph(viewStub())
    g.add(FakePass, { name: 'A', stage: RenderStage.Shadow, writes: ['_X'] })
    g.add(FakePass, { name: 'B', stage: RenderStage.Opaque, reads: ['_X'] })
    g.compile()
    g.compile() // second call must not throw
})

// -----------------------------------------------------------------------------
// Multi-writer (creator + mutator)
// -----------------------------------------------------------------------------

await test('Multi-writer: creator + mutator + reader chain orders correctly', async () => {
    const g = new RenderGraph(viewStub())
    g.add(FakePass, { name: 'Creator', stage: RenderStage.Opaque, writes: ['_Color'] })
    g.add(FakePass, { name: 'Mutator', stage: RenderStage.Transparent, mutates: ['_Color'] })
    g.add(FakePass, { name: 'Reader', stage: RenderStage.Post, reads: ['_Color'] })
    g.compile()
    // Reader must run AFTER both Creator and Mutator (they all write _Color).
    const order = g.passes.map(p => p.name)
    expect(order.indexOf('Creator') < order.indexOf('Mutator')).toEqual(true)
    expect(order.indexOf('Mutator') < order.indexOf('Reader')).toEqual(true)
})

// -----------------------------------------------------------------------------
// dumpDot — stable output for snapshot testing
// -----------------------------------------------------------------------------

await test('RenderGraph.dumpDot emits stage clusters and reads/writes edges', async () => {
    const g = new RenderGraph(viewStub())
    g.add(FakePass, { name: 'Shadow', stage: RenderStage.Shadow, writes: ['_ShadowMap'] })
    g.add(FakePass, { name: 'Color', stage: RenderStage.Opaque, reads: ['_ShadowMap'], writes: ['_ColorBuffer'] })
    g.add(FakePass, { name: 'Post', stage: RenderStage.Post, reads: ['_ColorBuffer'], writes: ['_FinalColor'] })
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
