import { View3D } from '../core/View3D';
import { Context3D } from '../gfx/graphics/webGpu/Context3D';
import { PointerEvent3D } from '../event/eventConst/PointerEvent3D';
import { InteractiveEvent } from '../event/eventConst/InteractiveEvent';
import { Interactive } from '../components/Interactive';
import { Vector3 } from '../math/Vector3';

/**
 * Per-View3D dispatcher that owns the set of `Interactive` components in the
 * view and routes pointer events to them via 2D screen-space hit testing.
 *
 * Coexists with `PickFire` (3D raycast). Interactives marked `blocking=true`
 * swallow the pointer so 3D pick doesn't also fire for the same press.
 *
 * @internal
 */
export class InteractiveDispatcher {
    private readonly _view: View3D;
    private readonly _interactives: Interactive[] = [];

    private _hovered: Interactive | null = null;
    private _downTarget: Interactive | null = null;
    private _downX: number = 0;
    private _downY: number = 0;
    private _dragging: boolean = false;
    private _dragThreshold: number = 4;

    private readonly _evOver = new InteractiveEvent(InteractiveEvent.OVER);
    private readonly _evOut = new InteractiveEvent(InteractiveEvent.OUT);
    private readonly _evMove = new InteractiveEvent(InteractiveEvent.MOVE);
    private readonly _evDown = new InteractiveEvent(InteractiveEvent.DOWN);
    private readonly _evUp = new InteractiveEvent(InteractiveEvent.UP);
    private readonly _evClick = new InteractiveEvent(InteractiveEvent.CLICK);
    private readonly _evDragStart = new InteractiveEvent(InteractiveEvent.DRAG_START);
    private readonly _evDrag = new InteractiveEvent(InteractiveEvent.DRAG);
    private readonly _evDragEnd = new InteractiveEvent(InteractiveEvent.DRAG_END);

    constructor(view: View3D) {
        this._view = view;
        const input = view.engine3D?.inputSystem;
        if (!input) {
            throw new Error(
                `InteractiveDispatcher: view.engine3D.inputSystem is not available yet. Create after engine.startRenderView(view).`,
            );
        }
        input.addEventListener(PointerEvent3D.POINTER_DOWN, this._onDown, this);
        input.addEventListener(PointerEvent3D.POINTER_UP, this._onUp, this);
        input.addEventListener(PointerEvent3D.POINTER_MOVE, this._onMove, this);
        input.addEventListener(PointerEvent3D.POINTER_CLICK, this._onClick, this);
    }

    public dispose() {
        const input = this._view.engine3D?.inputSystem;
        if (input) {
            input.removeEventListener(PointerEvent3D.POINTER_DOWN, this._onDown, this);
            input.removeEventListener(PointerEvent3D.POINTER_UP, this._onUp, this);
            input.removeEventListener(PointerEvent3D.POINTER_MOVE, this._onMove, this);
            input.removeEventListener(PointerEvent3D.POINTER_CLICK, this._onClick, this);
        }
        this._interactives.length = 0;
    }

    public register(it: Interactive) {
        if (this._interactives.indexOf(it) < 0) this._interactives.push(it);
    }

    public unregister(it: Interactive) {
        const i = this._interactives.indexOf(it);
        if (i >= 0) this._interactives.splice(i, 1);
        if (this._hovered === it) this._hovered = null;
        if (this._downTarget === it) {
            this._downTarget = null;
            this._dragging = false;
        }
    }

    /** True when the pointer is currently captured by a blocking Interactive. */
    public get isBlocked(): boolean {
        return this._dragging || (this._downTarget?.blocking === true);
    }

    /** True if any Interactive would consume the current pointer position (hover). */
    public hoverIsBlocking(): boolean {
        return this._hovered?.blocking === true;
    }

    /**
     * Spatial query used by PickFire: returns true if a pointer press at
     * (mx, my) would land on an Interactive marked `blocking=true`. Stateless
     * — safe to call from any pointer handler regardless of listener order.
     */
    public hitWouldBlock(mx: number, my: number): boolean {
        if (this._dragging && this._downTarget?.blocking) return true;
        const hit = this._hitAt(mx, my);
        return hit?.blocking === true;
    }

    private _hitAt(mx: number, my: number): Interactive | null {
        // Back-to-front order. Later additions render on top, so they're
        // tested first.
        for (let i = this._interactives.length - 1; i >= 0; i--) {
            const it = this._interactives[i];
            if (!it.enable || !it.object3D) continue;
            if (it.hitTest(this._view, mx, my)) return it;
        }
        return null;
    }

    private _onDown(e: PointerEvent3D) {
        const hit = this._hitAt(e.mouseX, e.mouseY);
        this._downTarget = hit;
        this._downX = e.mouseX;
        this._downY = e.mouseY;
        this._dragging = false;
        if (hit) this._dispatch(hit, this._evDown, e.mouseX, e.mouseY);
    }

    private _onUp(e: PointerEvent3D) {
        if (this._dragging && this._downTarget) {
            this._evDragEnd.reset();
            this._dispatch(this._downTarget, this._evDragEnd, e.mouseX, e.mouseY);
        } else if (this._downTarget) {
            const overNow = this._hitAt(e.mouseX, e.mouseY);
            this._dispatch(this._downTarget, this._evUp, e.mouseX, e.mouseY);
            // InputSystem emits POINTER_CLICK separately for quick-taps, so
            // we don't synthesize CLICK here — _onClick handles it.
            void overNow;
        }
        this._downTarget = null;
        this._dragging = false;
    }

    private _onMove(e: PointerEvent3D) {
        if (this._downTarget && !this._dragging) {
            const dx = e.mouseX - this._downX;
            const dy = e.mouseY - this._downY;
            if (dx * dx + dy * dy > this._dragThreshold * this._dragThreshold) {
                this._dragging = true;
                this._evDragStart.dragDeltaX = dx;
                this._evDragStart.dragDeltaY = dy;
                this._dispatch(this._downTarget, this._evDragStart, e.mouseX, e.mouseY);
            }
        }

        if (this._dragging && this._downTarget) {
            this._evDrag.dragDeltaX = e.mouseX - this._downX;
            this._evDrag.dragDeltaY = e.mouseY - this._downY;
            this._dispatch(this._downTarget, this._evDrag, e.mouseX, e.mouseY);
            return;
        }

        const hit = this._hitAt(e.mouseX, e.mouseY);
        if (hit !== this._hovered) {
            if (this._hovered) this._dispatch(this._hovered, this._evOut, e.mouseX, e.mouseY);
            if (hit) this._dispatch(hit, this._evOver, e.mouseX, e.mouseY);
            this._hovered = hit;
        }
        if (hit) this._dispatch(hit, this._evMove, e.mouseX, e.mouseY);
    }

    private _onClick(e: PointerEvent3D) {
        // Only synthesize a click if the pointer didn't turn into a drag.
        if (this._dragging) return;
        const hit = this._hitAt(e.mouseX, e.mouseY);
        if (hit) this._dispatch(hit, this._evClick, e.mouseX, e.mouseY);
    }

    private _dispatch(it: Interactive, event: InteractiveEvent, mx: number, my: number) {
        if (!it.object3D) return;
        event.mouseX = mx;
        event.mouseY = my;
        it.object3D.dispatchEvent(event);
    }

    /** @internal — used by Interactive.hitTest for AABB projection. */
    public static projectToScreen(view: View3D, world: Vector3, out: Vector3): Vector3 {
        // Convert projected canvas-pixel coords back to CSS pixels so the
        // result lines up with InputSystem.mouseX/mouseY.
        const ctx: Context3D | undefined = view.engine3D?.context3D;
        const ratio = ctx?.pixelRatio ?? 1;
        const screen = view.camera.object3DToScreenRay(world, out);
        screen.x /= ratio;
        screen.y /= ratio;
        return screen;
    }
}
