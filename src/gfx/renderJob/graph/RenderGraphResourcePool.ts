import { Context3D } from '../../graphics/webGpu/Context3D';

/**
 * Thin name → getter registry. Resources are owned by their creator
 * pass (or by external subsystems like `RTResourceMap` /
 * `GBufferFrame`); this pool just maps a string handle to a `() => T`
 * lookup so other passes can resolve dependencies via
 * `ctx.get(name)` at execute time.
 *
 * Each `RenderGraph` owns one pool. Pass.setup populates it via
 * `RenderGraphBuilder.write(name, factory)` (the factory's return is
 * captured into a getter that always returns that same instance).
 *
 * @group Graph
 */
export class RenderGraphResourcePool {
    private readonly _ctx: Context3D;
    private readonly _registry: Map<string, () => unknown> = new Map();

    constructor(ctx: Context3D) {
        this._ctx = ctx;
    }

    public get context(): Context3D {
        return this._ctx;
    }

    /** Register a getter under `name`. Subsequent `get(name)` /
     *  `has(name)` calls resolve through this getter. Calling twice
     *  with the same name overwrites the previous getter — the
     *  graph's single-creator validator catches the production case;
     *  in tests this is convenient for swapping fakes. */
    public register(name: string, getter: () => unknown): void {
        this._registry.set(name, getter);
    }

    /** Drop the getter for `name`. Idempotent — silently no-ops if the
     *  name isn't registered. Called from `RenderGraph.remove()` and
     *  from `RenderGraph.replace()`'s pre-install cleanup so old
     *  getters don't outlive their owning pass. */
    public unregister(name: string): void {
        this._registry.delete(name);
    }

    /** Resolve a named resource. Throws if no getter is registered. */
    public get<T>(name: string): T {
        const getter = this._registry.get(name);
        if (!getter) {
            throw new Error(`RenderGraphResourcePool.get('${name}') — resource not registered. ` +
                `Has a pass declared b.write('${name}', factory) in its setup()?`);
        }
        return getter() as T;
    }

    public has(name: string): boolean {
        return this._registry.has(name);
    }

    /** Drop all registrations. Called from `graph.destroy()` and on
     *  device-lost. The actual GPU resources are owned by the
     *  creator passes (or external maps), which manage their own
     *  destruction. */
    public dispose(): void {
        this._registry.clear();
    }
}
