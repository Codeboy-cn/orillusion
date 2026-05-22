import { View3D } from "../core/View3D";
import { ComponentCollect } from "../gfx/renderJob/collect/ComponentCollect";
import { RenderLayer } from "../gfx/renderJob/config/RenderLayer";
import { ComponentBase } from "./ComponentBase";

/**
 * Base class for components that want to be discoverable by type from
 * any RenderGraphPass — or any other system that calls
 * {@link ComponentCollect.collectByTypeLayered} — without having to
 * route through {@link RenderNode}.
 *
 * Subclass when your component:
 *   (a) is NOT a `RenderNode` (e.g. you draw via your own custom pass,
 *       or you participate in physics / audio / network queries), and
 *   (b) needs a per-View, layer-mask-filterable enumeration of all
 *       live instances.
 *
 * The base wires `onEnable` / `onDisable` to
 * {@link ComponentCollect.register} / {@link ComponentCollect.unregister}
 * so a custom pass can read `collectByTypeLayered(view, XXX, mask, out)`
 * with no per-component boilerplate.
 *
 * Override contract: subclasses that override `onEnable` or `onDisable`
 * MUST call `super.onEnable(view)` / `super.onDisable(view)`. Skipping
 * the super call silently breaks registration and any pass querying
 * the type will miss the instance. Mirrors the standard Unity
 * `MonoBehaviour.OnEnable()` base-call contract.
 *
 * @group Components
 */
export class DataComponentBase extends ComponentBase {
    /**
     * Composition-layer membership bitmask. The pass / camera /
     * collector filters via
     *
     *     (component.visibleLayer & pass.layerMask & camera.cullingMask) !== 0
     *
     * Defaults to {@link RenderLayer.Default} (bit 0) so a fresh
     * subclass is visible to passes whose `layerMask` is
     * {@link RenderLayer.All} (which includes bit 0). Application code
     * can assign project-specific bits (1..31) to organise the scene
     * into composition layers.
     */
    public visibleLayer: number = RenderLayer.Default;

    public onEnable(view?: View3D): void {
        if (!view) return;
        ComponentCollect.register(view, (this as any).constructor, this);
    }

    public onDisable(view?: View3D): void {
        if (!view) return;
        ComponentCollect.unregister(view, (this as any).constructor, this);
    }
}
