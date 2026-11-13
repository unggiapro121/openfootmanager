import { type PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../../../../hooks/usePrefersReducedMotion";
import {
  type Cover,
  centreOn,
  clampToGround,
  DRAG_SLOP,
  defaultView,
  focusPoint,
  type MapView,
  NARROW_MAP,
  NO_COVER,
  panelCover,
  toSvg,
  unitOf,
  WHEEL_ZOOM,
  zoomAt,
} from "./mapView";

const GLIDE_MS = 280;

/**
 * The campus map's camera (c-27 §6.2): drag with one finger or the mouse, pinch or wheel to zoom
 * about the pointer, buttons to zoom about the middle or go back, and a glide to a picked
 * building that jumps instead when the coach asked for less motion. The wheel is caught only
 * while the pointer is over the map, so the page still scrolls elsewhere.
 */
export function useCampusCamera(onFirstDrag: () => void) {
  const [svg, setSvg] = useState<SVGSVGElement | null>(null);
  const [view, setView] = useState<MapView>(() => defaultView(false));
  const [unit, setUnit] = useState(1);
  const viewRef = useRef(view);
  const narrow = useRef(false);
  const moved = useRef(0);
  const pointers = useRef(new Map<number, [number, number]>());
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const glide = useRef(0);
  const firstDrag = useRef(onFirstDrag);
  firstDrag.current = onFirstDrag;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const cover = useRef<Cover>(NO_COVER);
  svgRef.current = svg;
  /** Show `next`, held so the ground covers the map. */
  const apply = useCallback((next: MapView) => {
    const box = svgRef.current?.getBoundingClientRect();
    const held = box ? clampToGround(next, box, cover.current) : next;
    viewRef.current = held;
    setView(held);
  }, []);
  const stopGlide = () => cancelAnimationFrame(glide.current);

  useEffect(() => {
    if (!svg) return;
    narrow.current = svg.clientWidth < NARROW_MAP;
    apply(defaultView(narrow.current));
    const measure = () => {
      setUnit(unitOf(svg.getBoundingClientRect()));
      apply(viewRef.current);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(svg);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      stopGlide();
      const [x, y] = toSvg(svg.getBoundingClientRect(), event.clientX, event.clientY);
      apply(zoomAt(viewRef.current, event.deltaY < 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM, x, y));
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer?.disconnect();
      svg.removeEventListener("wheel", wheel);
      stopGlide();
    };
  }, [svg, apply]);

  const frame = () => svg?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    stopGlide();
    pointers.current.set(event.pointerId, [event.clientX, event.clientY]);
    moved.current = 0;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        distance: Math.hypot(a[0] - b[0], a[1] - b[1]),
        scale: viewRef.current.s,
      };
    }
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, [event.clientX, event.clientY]);
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const [x, y] = toSvg(frame(), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      const wanted = (pinch.current.scale * distance) / (pinch.current.distance || 1);
      apply(zoomAt(viewRef.current, wanted / viewRef.current.s, x, y));
      moved.current = Number.POSITIVE_INFINITY;
      return;
    }
    const dx = event.clientX - previous[0];
    const dy = event.clientY - previous[1];
    const wasPress = moved.current <= DRAG_SLOP;
    moved.current += Math.abs(dx) + Math.abs(dy);
    const scale = unitOf(frame());
    const current = viewRef.current;
    apply({ ...current, tx: current.tx + dx * scale, ty: current.ty + dy * scale });
    if (wasPress && moved.current > DRAG_SLOP) firstDrag.current();
  };

  const onPointerEnd = (event: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  /** Zoom by `factor` about the middle of the map (the `+` and `−` buttons). */
  const zoomBy = (factor: number) => {
    stopGlide();
    const box = frame();
    const [x, y] = toSvg(box, box.left + box.width / 2, box.top + box.height / 2);
    apply(zoomAt(viewRef.current, factor, x, y));
  };

  const reset = () => {
    stopGlide();
    apply(defaultView(narrow.current));
  };

  /** Bring the world point `target` to where a picked building is shown beside its panel. */
  const focusOn = (target: [number, number], panel: "side" | "sheet") => {
    const box = frame();
    cover.current = panelCover(box, panel);
    const [cx, cy] = focusPoint(box, panel);
    const end = centreOn(viewRef.current, target, toSvg(box, cx, cy));
    stopGlide();
    if (prefersReducedMotion() || typeof requestAnimationFrame === "undefined") {
      apply(end);
      return;
    }
    const start = viewRef.current;
    const began = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / GLIDE_MS);
      const ease = 1 - (1 - t) ** 3;
      apply({
        s: end.s,
        tx: start.tx + (end.tx - start.tx) * ease,
        ty: start.ty + (end.ty - start.ty) * ease,
      });
      if (t < 1) glide.current = requestAnimationFrame(step);
    };
    glide.current = requestAnimationFrame(step);
  };

  /** The panel shut: the whole map is open again, and the ground held to all of it. */
  const release = () => {
    cover.current = NO_COVER;
    apply(viewRef.current);
  };

  return {
    ref: setSvg,
    view,
    /** Map units per CSS px at scale 1: labels drawn at `unit / s` keep their size on screen. */
    unit,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onPointerLeave: onPointerEnd,
    },
    zoomBy,
    reset,
    focusOn,
    release,
    /** Whether the last press moved far enough to be a drag, not a pick. */
    wasDrag: () => moved.current > DRAG_SLOP,
  };
}
