import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

/** How far a finger moves on a token before it is a drag rather than a tap, in px. */
const DRAG_FROM = 8;
/** A click this soon after a drop is the drop's own click, not a tap. */
const CLICK_AFTER_DROP_MS = 400;

/** A token being dragged: who, where the finger is on the pitch (px), the token under it. */
export interface PitchDrag {
  id: string;
  x: number;
  y: number;
  over: string | null;
}

/** The player token under a point of the screen: its `data-swap-id`, if any. */
function tokenAt(x: number, y: number): string | null {
  const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-swap-id]");
  return element?.dataset.swapId ?? null;
}

/**
 * Dragging one player's token onto another's with a finger (or the mouse), the phone's
 * counterpart of the desktop pitch's drag and drop, which touch screens do not fire. A press
 * that barely moves stays a tap. `area` is the element the drag's position is measured from;
 * each token carries `data-swap-id` and spreads `handlers(id, canDrag)`.
 *
 * The finger is followed on the window from the press on, so a drag that leaves its token (or
 * the pitch) is still followed, with no pointer capture to ask for.
 */
export function usePitchDrag(onDrop: (draggedId: string, targetId: string) => void) {
  const area = useRef<HTMLElement>(null);
  const droppedAt = useRef(0);
  const stopFollowing = useRef<() => void>(() => {});
  const [drag, setDrag] = useState<PitchDrag | null>(null);
  useEffect(() => () => stopFollowing.current(), []);

  const follow = (id: string, press: ReactPointerEvent<HTMLElement>) => {
    stopFollowing.current();
    const { pointerId, clientX: startX, clientY: startY } = press;
    let current: PitchDrag | null = null;
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const moved = Math.hypot(event.clientX - startX, event.clientY - startY);
      if (!current && moved < DRAG_FROM) return;
      const box = area.current?.getBoundingClientRect();
      const over = tokenAt(event.clientX, event.clientY);
      current = {
        id,
        x: event.clientX - (box?.left ?? 0),
        y: event.clientY - (box?.top ?? 0),
        over: over === id ? null : over,
      };
      setDrag(current);
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      stop();
      if (!current) return;
      droppedAt.current = Date.now();
      if (current.over) onDrop(id, current.over);
    };
    const cancel = (event: PointerEvent) => {
      if (event.pointerId === pointerId) stop();
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      stopFollowing.current = () => {};
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    stopFollowing.current = stop;
  };

  const handlers = (id: string, canDrag: boolean) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (!canDrag || (event.pointerType === "mouse" && event.button !== 0)) return;
      follow(id, event);
    },
    // A desktop browser would start its own drag of the face's picture.
    onDragStart: (event: { preventDefault: () => void }) => event.preventDefault(),
  });

  /** True for the click a drop leaves behind, which must not count as a tap. */
  const isDropClick = () => Date.now() - droppedAt.current < CLICK_AFTER_DROP_MS;

  return { area, drag, handlers, isDropClick };
}
