import { RenderGraphPass } from './RenderGraphPass';
import { RenderStage } from './RenderStage';

/**
 * Base class for graph-compile errors. Subclass messages embed
 * concrete pass / resource names so users can grep to the culprit.
 *
 * @group Graph
 */
export class GraphCompileError extends Error {
    constructor(message: string) {
        super(message);
        this.name = new.target.name;
    }
}

/**
 * Raised when passes form a cycle on reads/writes. The message lists
 * the pass names on the cycle in order.
 *
 * @group Graph
 */
export class CyclicDependencyError extends GraphCompileError {
    public readonly cycle: readonly string[];
    constructor(cycle: readonly string[]) {
        super(`RenderGraph: cyclic dependency detected — ${cycle.join(' → ')} → ${cycle[0]}. ` +
            `Break the cycle by removing one reads/writes edge, or split the resource into two named handles.`);
        this.cycle = cycle;
    }
}

/**
 * Raised when a pass declares `b.read('foo')` (or `b.write('foo')`
 * without factory) but no other pass is the creator of `'foo'`.
 *
 * @group Graph
 */
export class UnresolvedResourceError extends GraphCompileError {
    public readonly pass: string;
    public readonly resource: string;
    constructor(pass: string, resource: string) {
        super(`RenderGraph: pass '${pass}' reads '${resource}' but no creator pass was found. ` +
            `Add a pass that calls b.write('${resource}', factory) in its setup().`);
        this.pass = pass;
        this.resource = resource;
    }
}

/**
 * Raised when a pass calls `b.write('foo')` (mutator, no factory)
 * but no other pass is the creator of `'foo'`.
 *
 * @group Graph
 */
export class MissingCreatorError extends GraphCompileError {
    public readonly pass: string;
    public readonly resource: string;
    constructor(pass: string, resource: string) {
        super(`RenderGraph: pass '${pass}' declares write to '${resource}' (mutator) but no creator pass was found. ` +
            `Add a pass that calls b.write('${resource}', factory) in its setup(), or change this pass to be the creator.`);
        this.pass = pass;
        this.resource = resource;
    }
}

/**
 * Raised when stage ordering contradicts the data-flow ordering.
 * Reader's stage must be >= max writer stage; mutator stage must be
 * >= creator stage.
 *
 * @group Graph
 */
export class StageConstraintViolation extends GraphCompileError {
    public readonly downstream: string;
    public readonly upstream: string;
    public readonly resource: string;
    public readonly downstreamStage: RenderStage;
    public readonly upstreamStage: RenderStage;
    constructor(downstream: string, downstreamStage: RenderStage, upstream: string, upstreamStage: RenderStage, resource: string) {
        super(`RenderGraph: pass '${downstream}' at stage ${RenderStage[downstreamStage]} references '${resource}' ` +
            `but its upstream '${upstream}' runs at stage ${RenderStage[upstreamStage]} — upstream stage is later than downstream stage. ` +
            `Either move '${downstream}' to a stage >= ${RenderStage[upstreamStage]}, or move '${upstream}' to a stage <= ${RenderStage[downstreamStage]}.`);
        this.downstream = downstream;
        this.upstream = upstream;
        this.resource = resource;
        this.downstreamStage = downstreamStage;
        this.upstreamStage = upstreamStage;
    }
}

/**
 * Raised when two passes call `b.write(name, factory)` for the same
 * `name`. Only one pass may be the creator of a given resource;
 * additional passes that also write must drop their factory and
 * become mutators.
 *
 * @group Graph
 */
export class DuplicateCreatorError extends GraphCompileError {
    public readonly resource: string;
    public readonly creators: readonly string[];
    constructor(resource: string, creators: readonly string[]) {
        super(`RenderGraph: resource '${resource}' has multiple creators: ${creators.map(c => `'${c}'`).join(', ')}. ` +
            `Only one pass may call b.write('${resource}', factory). Other passes that also write must drop the factory and become mutators (b.write('${resource}')).`);
        this.resource = resource;
        this.creators = [...creators];
    }
}

/**
 * Static graph invariants enforcer. Called by `RenderGraph.compile`;
 * factored out so unit tests can exercise validation without GPU.
 *
 * @group Graph
 */
export class GraphValidator {
    /** name → creator pass name (single creator per resource). */
    private readonly _creators: Map<string, string> = new Map();
    /** name → all writer pass names (creator + mutators), in registration order. */
    private readonly _writers: Map<string, string[]> = new Map();
    /** name → reader pass names. */
    private readonly _consumers: Map<string, string[]> = new Map();
    private readonly _byName: Map<string, RenderGraphPass> = new Map();
    /** Tracks duplicate creators so validateSingleCreator can report all of them. */
    private readonly _duplicateCreators: Map<string, string[]> = new Map();

    constructor(passes: readonly RenderGraphPass[]) {
        for (const p of passes) {
            if (this._byName.has(p.name)) {
                throw new GraphCompileError(`RenderGraph: duplicate pass name '${p.name}'. ` +
                    `Use distinct names or call graph.replace('${p.name}', NewCtor) instead of add.`);
            }
            this._byName.set(p.name, p);
            for (const c of p.creates) {
                if (!this._duplicateCreators.has(c)) this._duplicateCreators.set(c, []);
                this._duplicateCreators.get(c)!.push(p.name);
                if (!this._creators.has(c)) this._creators.set(c, p.name);
            }
            for (const w of p.writes) {
                if (!this._writers.has(w)) this._writers.set(w, []);
                this._writers.get(w)!.push(p.name);
            }
            for (const r of p.reads) {
                if (!this._consumers.has(r)) this._consumers.set(r, []);
                this._consumers.get(r)!.push(p.name);
            }
        }
    }

    /** Each name must have at most one creator. Mutator-only resources
     *  (no creator) are caught by validateResolvable. */
    public validateSingleCreator(): void {
        for (const [name, list] of this._duplicateCreators) {
            if (list.length > 1) {
                throw new DuplicateCreatorError(name, list);
            }
        }
    }

    /** Every read and every mutator-write must point to a resource
     *  with a creator. */
    public validateResolvable(): void {
        for (const [resource, consumers] of this._consumers) {
            if (this._creators.has(resource)) continue;
            throw new UnresolvedResourceError(consumers[0], resource);
        }
        for (const [resource, writers] of this._writers) {
            if (this._creators.has(resource)) continue;
            // No creator and yet someone writes — must be a mutator
            // without a backing creator.
            const mutator = writers[0];
            throw new MissingCreatorError(mutator, resource);
        }
    }

    /** Stage monotonicity: reader.stage >= creator.stage; mutator
     *  stage >= creator.stage (mutator must come after creator).
     *
     *  Note: readers do NOT need to come after every mutator. Reading
     *  a resource at an intermediate state (post-creator, pre-mutator)
     *  is a legitimate pattern — e.g. SceneColorPyramidPass reads the
     *  opaque-only ColorBuffer before SortedTransparentPass appends
     *  transparents. topoSort picks the writer chain version visible
     *  to each reader by stage+insertion. */
    public validateStageOrdering(): void {
        for (const [resource, writers] of this._writers) {
            const creator = this._creators.get(resource);
            if (!creator) continue; // caught by validateResolvable
            const creatorStage = this._byName.get(creator)!.stage;
            const consumers = this._consumers.get(resource) ?? [];
            for (const consumerName of consumers) {
                const consumer = this._byName.get(consumerName)!;
                if (consumer.stage < creatorStage) {
                    throw new StageConstraintViolation(
                        consumer.name,
                        consumer.stage,
                        creator,
                        creatorStage,
                        resource,
                    );
                }
            }
            // Mutators must run at stage >= creator.stage.
            for (const w of writers) {
                if (w === creator) continue;
                const wStage = this._byName.get(w)!.stage;
                if (wStage < creatorStage) {
                    throw new StageConstraintViolation(
                        creator,
                        creatorStage,
                        w,
                        wStage,
                        resource,
                    );
                }
            }
        }
    }
}

/**
 * Kahn-style topological sort on the reads/writes DAG. Primary key is
 * stage, secondary key is insertion order — both yield a deterministic
 * output across runs, which keeps `dumpDot()` snapshots stable.
 *
 * Multi-writer support:
 * - Writers of the same resource are ordered by (stage, insertion).
 * - Each subsequent writer has an incoming edge from the previous
 *   writer (mutator after creator).
 * - Each reader has an incoming edge from the LATEST writer in the
 *   chain whose (stage, insertion) is at-or-before the reader's.
 *   This lets a reader sandwich between creator and a later mutator
 *   sample the creator's output (e.g. SceneColorPyramidPass reads
 *   the opaque-only ColorBuffer before SortedTransparentPass blends
 *   transparents on top).
 *
 * Returns the ordered pass names; throws {@link CyclicDependencyError}
 * with the cycle path if a cycle is detected.
 *
 * @group Graph
 */
export function topoSort(
    passes: readonly RenderGraphPass[],
    byName: ReadonlyMap<string, RenderGraphPass>,
    insertedOrder: (p: RenderGraphPass) => number,
): string[] {
    // Build sorted writer chain per resource.
    const writers = new Map<string, string[]>();
    for (const p of passes) {
        for (const w of p.writes) {
            if (!writers.has(w)) writers.set(w, []);
            writers.get(w)!.push(p.name);
        }
    }
    for (const [, list] of writers) {
        list.sort((a, b) => {
            const pa = byName.get(a)!;
            const pb = byName.get(b)!;
            if (pa.stage !== pb.stage) return pa.stage - pb.stage;
            return insertedOrder(pa) - insertedOrder(pb);
        });
    }

    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const p of passes) {
        inDegree.set(p.name, 0);
        adj.set(p.name, []);
    }

    const addEdge = (from: string, to: string) => {
        if (from === to) return;
        adj.get(from)!.push(to);
        inDegree.set(to, inDegree.get(to)! + 1);
    };

    // 1) Chain writers of the same resource.
    for (const [, list] of writers) {
        for (let i = 1; i < list.length; i++) {
            addEdge(list[i - 1], list[i]);
        }
    }
    // 2) Each reader depends on the latest writer in the chain whose
    //    (stage, insertion) is at-or-before the reader's. This is the
    //    writer whose output the reader actually observes.
    for (const p of passes) {
        for (const r of p.reads) {
            const ws = writers.get(r);
            if (!ws || ws.length === 0) continue;
            let picked: string | null = null;
            for (let i = ws.length - 1; i >= 0; i--) {
                const w = byName.get(ws[i])!;
                const stageCmp = w.stage - p.stage;
                const cmp = stageCmp !== 0 ? stageCmp : insertedOrder(w) - insertedOrder(p);
                if (cmp <= 0) { picked = ws[i]; break; }
            }
            // Fall back to the first writer if all writers are after
            // the reader (validator ensures the creator is at-or-before).
            if (!picked) picked = ws[0];
            addEdge(picked, p.name);
        }
    }

    // Kahn with stage-first comparator for tie-breaking.
    const ready: RenderGraphPass[] = [];
    for (const p of passes) {
        if (inDegree.get(p.name) === 0) ready.push(p);
    }
    const cmp = (a: RenderGraphPass, b: RenderGraphPass) =>
        a.stage !== b.stage ? a.stage - b.stage : insertedOrder(a) - insertedOrder(b);
    ready.sort(cmp);

    const order: string[] = [];
    while (ready.length > 0) {
        const next = ready.shift()!;
        order.push(next.name);
        for (const child of adj.get(next.name)!) {
            const d = inDegree.get(child)! - 1;
            inDegree.set(child, d);
            if (d === 0) {
                ready.push(byName.get(child)!);
                ready.sort(cmp);
            }
        }
    }

    if (order.length !== passes.length) {
        const remaining = new Set<string>();
        for (const p of passes) if (inDegree.get(p.name)! > 0) remaining.add(p.name);
        const cycle = _extractCycle(remaining, adj);
        throw new CyclicDependencyError(cycle);
    }

    return order;
}

/** Walk the residual adjacency to surface one concrete cycle path. */
function _extractCycle(remaining: Set<string>, adj: ReadonlyMap<string, string[]>): string[] {
    const start = remaining.values().next().value as string;
    const path: string[] = [];
    const seen = new Map<string, number>();
    let cur = start;
    while (!seen.has(cur)) {
        seen.set(cur, path.length);
        path.push(cur);
        const next = adj.get(cur)!.find(n => remaining.has(n));
        if (!next) break;
        cur = next;
    }
    const idx = seen.get(cur);
    return idx !== undefined ? path.slice(idx) : path;
}
