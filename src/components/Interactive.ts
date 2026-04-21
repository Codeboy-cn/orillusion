import { View3D } from '../core/View3D';
import { InteractiveDispatcher } from '../io/InteractiveDispatcher';
import { ComponentBase } from './ComponentBase';
import { Sprite } from './renderer/Sprite';
import { Vector2 } from '../math/Vector2';
import { Vector3 } from '../math/Vector3';
import { RegisterComponent } from '../util/SerializeDecoration';

export type InteractiveHitArea = 'rect' | 'circle' | 'custom';

/**
 * Attaches pointer interaction to any `Object3D`. Hit-testing is 2D in screen
 * space: the owner's world position projects to screen and the configured
 * `hitArea` decides whether the pointer is inside.
 *
 * Events are dispatched on the owner `Object3D`'s `eventDispatcher`. See
 * `InteractiveEvent` for the full list.
 *
 * Pair with a `Sprite` component for zero-config hit rects: the Sprite's
 * `size` and `pivot` drive the hit box automatically.
 *
 * @group Components
 */
@RegisterComponent(Interactive, 'Interactive')
export class Interactive extends ComponentBase {
    /** Hit shape. Only 'rect' is implemented in this release; 'circle' / 'custom' are reserved. */
    public hitArea: InteractiveHitArea = 'rect';

    /** Hit rectangle size in CSS pixels. Ignored when a `Sprite` component exists on the same Object3D (the sprite's size is used instead). */
    public hitSize: Vector2 = new Vector2(64, 64);

    /** Pivot for the hit rectangle (0..1, 0.5 = centered). Only applied when `hitSize` is used; Sprites supply their own pivot. */
    public hitPivot: Vector2 = new Vector2(0.5, 0.5);

    /** When true, this Interactive swallows the pointer: `PickFire` 3D pick doesn't fire for the same press. */
    public blocking: boolean = true;

    /** Custom hit predicate; used when `hitArea === 'custom'`. */
    public customHitTest: ((view: View3D, mx: number, my: number) => boolean) | null = null;

    private _registeredView: View3D | null = null;
    private static readonly _tmpScreen: Vector3 = new Vector3();

    public init(param?: any): void {
        super.init(param);
    }

    public onEnable(): void {
        const view = this.transform?.view3D;
        if (!view) return;
        const disp = Interactive._dispatcherFor(view);
        disp.register(this);
        this._registeredView = view;
    }

    public onDisable(): void {
        if (this._registeredView) {
            const disp = Interactive._dispatcherFor(this._registeredView);
            disp.unregister(this);
            this._registeredView = null;
        }
    }

    /** Screen-space hit test. Returns true if (mx, my) lies inside the hit shape. */
    public hitTest(view: View3D, mx: number, my: number): boolean {
        if (this.hitArea === 'custom' && this.customHitTest) {
            return this.customHitTest(view, mx, my);
        }
        if (this.hitArea === 'circle') {
            const center = this._screenCenter(view);
            if (!center) return false;
            const r = Math.max(this._effectiveSize().x, this._effectiveSize().y) * 0.5;
            const dx = mx - center.x;
            const dy = my - center.y;
            return dx * dx + dy * dy <= r * r;
        }
        // rect
        const center = this._screenCenter(view);
        if (!center) return false;
        const size = this._effectiveSize();
        const pivot = this._effectivePivot();
        // rect top-left at center - (pivot * size). +Y is downward in screen space.
        const left = center.x - pivot.x * size.x;
        const top = center.y - pivot.y * size.y;
        return mx >= left && mx <= left + size.x && my >= top && my <= top + size.y;
    }

    private _screenCenter(view: View3D): { x: number; y: number } | null {
        if (!this.object3D) return null;
        const world = this.object3D.transform.worldPosition;
        InteractiveDispatcher.projectToScreen(view, world, Interactive._tmpScreen);
        return { x: Interactive._tmpScreen.x, y: Interactive._tmpScreen.y };
    }

    private _effectiveSize(): Vector2 {
        const sprite = this.object3D?.getComponent(Sprite) as Sprite | null;
        if (sprite && sprite.size) return sprite.size;
        return this.hitSize;
    }

    private _effectivePivot(): Vector2 {
        const sprite = this.object3D?.getComponent(Sprite) as Sprite | null;
        if (sprite && sprite.pivot) return sprite.pivot;
        return this.hitPivot;
    }

    /** Per-view dispatcher, lazily created on first Interactive.register. */
    private static _dispatcherFor(view: View3D): InteractiveDispatcher {
        if (!view.interactiveDispatcher) {
            view.interactiveDispatcher = new InteractiveDispatcher(view);
        }
        return view.interactiveDispatcher;
    }
}
