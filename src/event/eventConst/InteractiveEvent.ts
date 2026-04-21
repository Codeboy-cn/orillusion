import { CEvent } from '../CEvent';

/**
 * Events dispatched by the `Interactive` component on its owner Object3D.
 * Subscribe via `object3D.addEventListener(InteractiveEvent.CLICK, handler, thisObj)`.
 * Unlike `PointerEvent3D.PICK_*`, these fire from 2D screen-space hit testing
 * performed by `InteractiveDispatcher` — ideal for sprites, HUDs, and mixed
 * overlay / 3D pick flows where the UI needs first dibs on the pointer.
 *
 * @group Events
 */
export class InteractiveEvent extends CEvent {
    public static CLICK = 'onInteractiveClick';
    public static DOWN = 'onInteractiveDown';
    public static UP = 'onInteractiveUp';
    public static OVER = 'onInteractiveOver';
    public static OUT = 'onInteractiveOut';
    public static MOVE = 'onInteractiveMove';
    public static DRAG_START = 'onInteractiveDragStart';
    public static DRAG = 'onInteractiveDrag';
    public static DRAG_END = 'onInteractiveDragEnd';

    public mouseX: number = 0;
    public mouseY: number = 0;
    /** Accumulated pointer delta since DRAG_START (for drag events). */
    public dragDeltaX: number = 0;
    public dragDeltaY: number = 0;

    public reset() {
        super.reset();
        this.mouseX = 0;
        this.mouseY = 0;
        this.dragDeltaX = 0;
        this.dragDeltaY = 0;
    }
}
