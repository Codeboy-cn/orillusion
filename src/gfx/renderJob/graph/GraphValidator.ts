import { RenderFeature } from './RenderFeature';
import { RenderStage } from './RenderStage';

/**
 * Base class for all graph-compile errors. Every subclass embeds the
 * concrete feature / resource names in the message so the user can
 * `grep` the source tree from the console output.
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
 * Raised when features form a cycle on reads/writes. The message lists
 * the feature names on the cycle in order so the caller can see which
 * producer → consumer link to break.
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
 * Raised when a feature declares `reads: ['foo']` but no other feature
 * writes `'foo'` and `'foo'` is not registered as an external resource.
 *
 * @group Graph
 */
export class UnresolvedResourceError extends GraphCompileError {
    public readonly feature: string;
    public readonly resource: string;
    constructor(feature: string, resource: string) {
        super(`RenderGraph: feature '${feature}' reads '${resource}' but no writer was found. ` +
            `Add a feature that writes '${resource}' via writes:['${resource}'], or call pool.registerExternal('${resource}', getter) for externally-managed resources.`);
        this.feature = feature;
        this.resource = resource;
    }
}

/**
 * Raised when stage ordering contradicts the data-flow ordering. E.g. a
 * feature in stage `AfterOpaque` reads a resource whose only writer is
 * in stage `Post` — the reader runs before the writer, which cannot be
 * satisfied.
 *
 * @group Graph
 */
export class StageConstraintViolation extends GraphCompileError {
    public readonly reader: string;
    public readonly writer: string;
    public readonly resource: string;
    public readonly readerStage: RenderStage;
    public readonly writerStage: RenderStage;
    constructor(reader: string, readerStage: RenderStage, writer: string, writerStage: RenderStage, resource: string) {
        super(`RenderGraph: feature '${reader}' at stage ${RenderStage[readerStage]} reads '${resource}' ` +
            `but its only writer '${writer}' runs at stage ${RenderStage[writerStage]} — writer stage is later than reader stage. ` +
            `Either move '${reader}' to a stage >= ${RenderStage[writerStage]}, or move '${writer}' to a stage <= ${RenderStage[readerStage]}.`);
        this.reader = reader;
        this.readerStage = readerStage;
        this.writer = writer;
        this.writerStage = writerStage;
        this.resource = resource;
    }
}

/**
 * Raised when two features both declare `writes: ['foo']` with no
 * explicit ordering. Multiple producers for the same logical resource
 * usually indicates a naming collision or a missing rename.
 *
 * @group Graph
 */
export class DuplicateWriterError extends GraphCompileError {
    public readonly resource: string;
    public readonly writers: readonly string[];
    constructor(resource: string, writers: readonly string[]) {
        super(`RenderGraph: resource '${resource}' is written by multiple features: ${writers.map(w => `'${w}'`).join(', ')}. ` +
            `Rename one of them, or wrap the shared producer behind a single feature.`);
        this.resource = resource;
        this.writers = [...writers];
    }
}

/**
 * Validate static graph invariants. Called by
 * {@link RenderGraph.compile}; factored out so tests can exercise it
 * in isolation without running any GPU work.
 *
 * @group Graph
 */
export class GraphValidator {
    /** Features keyed by name. */
    private readonly _byName: Map<string, RenderFeature>;
    /** Producers of each resource: `resource → [featureName, ...]`. */
    private readonly _producers: Map<string, string[]>;
    /** Consumers of each resource: `resource → [featureName, ...]`. */
    private readonly _consumers: Map<string, string[]>;
    /** Names of externally-registered resources (treated as written by nobody). */
    private readonly _externals: ReadonlySet<string>;

    constructor(features: readonly RenderFeature[], externals: ReadonlySet<string>) {
        this._byName = new Map();
        this._producers = new Map();
        this._consumers = new Map();
        this._externals = externals;

        for (const f of features) {
            if (this._byName.has(f.name)) {
                throw new GraphCompileError(`RenderGraph: duplicate feature name '${f.name}'. ` +
                    `Use distinct names or call graph.replaceFeature('${f.name}', newFeature) instead of addFeature.`);
            }
            this._byName.set(f.name, f);
            for (const w of f.writes) {
                if (!this._producers.has(w)) this._producers.set(w, []);
                this._producers.get(w)!.push(f.name);
            }
            for (const r of f.reads) {
                if (!this._consumers.has(r)) this._consumers.set(r, []);
                this._consumers.get(r)!.push(f.name);
            }
        }
    }

    /** Check that every `reads` entry has a producer or is external. */
    public validateResolvable(): void {
        for (const [resource, consumers] of this._consumers) {
            if (this._producers.has(resource)) continue;
            if (this._externals.has(resource)) continue;
            throw new UnresolvedResourceError(consumers[0], resource);
        }
    }

    /** Check that no resource has more than one writer. */
    public validateSingleWriter(): void {
        for (const [resource, writers] of this._producers) {
            if (writers.length > 1) {
                throw new DuplicateWriterError(resource, writers);
            }
        }
    }

    /** Check stage monotonicity: a reader's stage must be >= its writer's. */
    public validateStageOrdering(): void {
        for (const [resource, consumers] of this._consumers) {
            const writers = this._producers.get(resource);
            if (!writers) continue;
            const writer = this._byName.get(writers[0])!;
            for (const consumerName of consumers) {
                const consumer = this._byName.get(consumerName)!;
                if (consumer.stage < writer.stage) {
                    throw new StageConstraintViolation(
                        consumer.name,
                        consumer.stage,
                        writer.name,
                        writer.stage,
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
 * Returns the ordered feature names; throws {@link CyclicDependencyError}
 * with the cycle path if a cycle is detected.
 *
 * @group Graph
 */
export function topoSort(
    features: readonly RenderFeature[],
    producers: ReadonlyMap<string, string[]>,
): string[] {
    const byName = new Map<string, RenderFeature>();
    const inserted = new Map<string, number>();
    features.forEach((f, i) => {
        byName.set(f.name, f);
        inserted.set(f.name, i);
    });

    // Build adjacency: edge from producer → consumer when consumer reads producer's write.
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const f of features) {
        inDegree.set(f.name, 0);
        adj.set(f.name, []);
    }
    for (const f of features) {
        for (const r of f.reads) {
            const writers = producers.get(r);
            if (!writers) continue; // Externals / unresolved — caught by validator.
            for (const w of writers) {
                if (w === f.name) continue; // Self-read: ignore (e.g. feature ping-pongs on its own texture).
                adj.get(w)!.push(f.name);
                inDegree.set(f.name, inDegree.get(f.name)! + 1);
            }
        }
    }

    // Priority queue keyed by (stage, insertion_order).
    const ready: RenderFeature[] = [];
    for (const f of features) {
        if (inDegree.get(f.name) === 0) ready.push(f);
    }
    const cmp = (a: RenderFeature, b: RenderFeature) =>
        a.stage !== b.stage ? a.stage - b.stage : inserted.get(a.name)! - inserted.get(b.name)!;
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

    if (order.length !== features.length) {
        // Cycle. Recover a path for the error message by walking the
        // residual subgraph via any-remaining-incoming-edge.
        const remaining = new Set<string>();
        for (const f of features) if (inDegree.get(f.name)! > 0) remaining.add(f.name);
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
