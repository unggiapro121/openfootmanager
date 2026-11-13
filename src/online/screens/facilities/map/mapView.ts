import type { ArtKey } from "../art/artKeys";
import type { CardState } from "../cardState";
import { artBox, LAYOUT, type MapSlot, proj } from "./layout";

/**
 * The campus map's camera and drawing rules (c-27 §6.1–6.2, C27-16/17), as the approved design
 * (`co-so-vat-chat.html`, `attachMap`) draws them: a world group moved by `tx, ty` and scaled by
 * `s`, inside an SVG whose viewBox is fixed.
 */
export interface MapView {
  s: number;
  tx: number;
  ty: number;
}

/** The design's viewBox: the campus as it first shows, in map units. */
export const VIEW_BOX = { x: -470, y: -200, w: 940, h: 420 };
export const VIEW_BOX_ATTR = `${VIEW_BOX.x} ${VIEW_BOX.y} ${VIEW_BOX.w} ${VIEW_BOX.h}`;

export const MIN_SCALE = 0.8;
export const MAX_SCALE = 4.5;
/** One press of `+` or `−`, and one notch of the wheel. */
export const BUTTON_ZOOM = 1.3;
export const WHEEL_ZOOM = 1.15;
/** How far a press may move, in CSS px, and still pick the building under it. */
export const DRAG_SLOP = 6;
/** A map narrower than this opens close in on the stadium. */
export const NARROW_MAP = 600;
/** The side panel's column, and the map width from which a building is centred beside it. */
export const PANEL_COLUMN = 440;
const WIDE_MAP = 900;

export function defaultView(narrow: boolean): MapView {
  return narrow ? { s: 2.3, tx: 0, ty: -6 } : { s: 1.08, tx: 20, ty: 6 };
}

/** `view` zoomed by `factor` about the map point (px, py), held to [MIN_SCALE, MAX_SCALE]. */
export function zoomAt(view: MapView, factor: number, px: number, py: number): MapView {
  const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.s * factor));
  const k = s / view.s;
  return { s, tx: px - (px - view.tx) * k, ty: py - (py - view.ty) * k };
}

/** `view` moved so the world point `target` is drawn at the map point `at`. */
export function centreOn(view: MapView, target: [number, number], at: [number, number]): MapView {
  return { s: view.s, tx: at[0] - target[0] * view.s, ty: at[1] - target[1] * view.s };
}

interface Frame {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Map units per CSS px, the viewBox fitted inside the frame ("meet"); 1 before layout. */
export function unitOf({ width, height }: Pick<Frame, "width" | "height">): number {
  if (width <= 0 || height <= 0) return 1;
  return Math.max(VIEW_BOX.w / width, VIEW_BOX.h / height);
}

/** A point on screen, in map units of the SVG drawn in `frame`. */
export function toSvg(frame: Frame, clientX: number, clientY: number): [number, number] {
  const unit = unitOf(frame);
  return [
    VIEW_BOX.x + (clientX - frame.left) * unit - (frame.width * unit - VIEW_BOX.w) / 2,
    VIEW_BOX.y + (clientY - frame.top) * unit - (frame.height * unit - VIEW_BOX.h) / 2,
  ];
}

/** One axis of `clampToGround`: the offset that keeps [lo, hi] (at scale s) over [from, to]. */
function holdAxis(offset: number, s: number, lo: number, hi: number, from: number, to: number) {
  if ((hi - lo) * s <= to - from) return (from + to) / 2 - ((lo + hi) / 2) * s;
  return Math.min(from - lo * s, Math.max(to - hi * s, offset));
}

/**
 * `view` held so the campus ground covers the frame, or the part of it a panel leaves: a drag or a
 * zoom stops at the ground's edge instead of showing what lies past it. A frame bigger than the
 * ground at this zoom has the ground centred in it; a frame not laid out yet is left be.
 */
export function clampToGround(view: MapView, frame: Frame, cover: Cover = NO_COVER): MapView {
  if (frame.width <= 0 || frame.height <= 0) return view;
  const ground = artBox("ground");
  const [x0, y0] = toSvg(frame, frame.left, frame.top);
  const [x1, y1] = toSvg(
    frame,
    frame.left + frame.width - cover.right,
    frame.top + frame.height - cover.bottom,
  );
  return {
    s: view.s,
    tx: holdAxis(view.tx, view.s, ground.x, ground.x + ground.w, x0, x1),
    ty: holdAxis(view.ty, view.s, ground.y, ground.y + ground.h, y0, y1),
  };
}

/** The part of the map a picked building's panel covers, in CSS px from the right and bottom. */
export interface Cover {
  right: number;
  bottom: number;
}

export const NO_COVER: Cover = { right: 0, bottom: 0 };

/**
 * What the panel covers: the side column on a wide map, the sheet's rise on a phone (its building
 * then sits at 28 % of the map's height, as the design centres it).
 */
export function panelCover(frame: Frame, panel: "side" | "sheet"): Cover {
  if (panel === "sheet") return { right: 0, bottom: frame.height * 0.44 };
  return { right: frame.width >= WIDE_MAP ? PANEL_COLUMN : 0, bottom: 0 };
}

/** The middle of the part of the frame a panel leaves, on screen. */
export function freeCentre(frame: Frame, cover: Cover): [number, number] {
  return [
    frame.left + (frame.width - cover.right) / 2,
    frame.top + (frame.height - cover.bottom) / 2,
  ];
}

/** How far inside the free part of the map, in CSS px, a building counts as in sight. */
const SIGHT_MARGIN = 32;

/**
 * Whether the world point `target` is drawn inside the part of the frame a panel leaves, with a
 * margin for its label; a frame not laid out yet sees everything.
 */
export function inSight(
  view: MapView,
  target: [number, number],
  frame: Frame,
  cover: Cover,
): boolean {
  if (frame.width <= 0 || frame.height <= 0) return true;
  const x = view.tx + target[0] * view.s;
  const y = view.ty + target[1] * view.s;
  const [x0, y0] = toSvg(frame, frame.left + SIGHT_MARGIN, frame.top + SIGHT_MARGIN);
  const [x1, y1] = toSvg(
    frame,
    frame.left + frame.width - cover.right - SIGHT_MARGIN,
    frame.top + frame.height - cover.bottom - SIGHT_MARGIN,
  );
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

/** The slots in the List's order (c-27 §5.3): the keyboard walks the map in this order. */
export const LIST_ORDER: readonly MapSlot[] = [
  "stands",
  "shop",
  "food",
  "park",
  "training",
  "medical",
  "academy",
  "trophy",
];

/** Where a slot stands on the map, in map units. */
export function slotPoint(slot: MapSlot): [number, number] {
  const [x, z] = LAYOUT[slot];
  return proj(x, z);
}

/** The slots far first: by their place on the map from top to bottom, so near art covers far. */
export function drawOrder(): MapSlot[] {
  return [...LIST_ORDER].sort((a, b) => slotPoint(a)[1] - slotPoint(b)[1]);
}

/** A footprint's selection ring: an ellipse of radius `r` flattened by the 34° tilt. */
export function ringPath(r: number): string {
  const ry = (r * Math.sin((34 * Math.PI) / 180)).toFixed(1);
  return `M${-r},0a${r},${ry} 0 1,0 ${2 * r},0a${r},${ry} 0 1,0 ${-2 * r},0`;
}

/** A building's dot on the map: building, can go up a level, waiting or locked, at the top. */
export type MapStatus = "building" | "upgradable" | "waiting" | "top";

export function mapStatus(state: CardState): MapStatus {
  switch (state.kind) {
    case "building":
      return "building";
    case "top":
      return "top";
    case "ready":
    case "unbuilt":
      return "upgradable";
    default:
      return "waiting";
  }
}

/** Where a slot's label stands: over its art's top, at most the design's cap above the slot. */
export function labelY(slot: MapSlot, art: ArtKey): number {
  const cap = slot === "stands" ? -70 : -60;
  return slotPoint(slot)[1] + Math.max(artBox(art).y + 14, cap);
}

/** The crane over a build: behind the stadium full size, or beside a building smaller. */
export function cranePlace(slot: MapSlot): { x: number; y: number; scale: number } {
  if (slot === "stands") {
    const [x, y] = proj(-118, -42);
    return { x, y, scale: 1 };
  }
  const [sx, sz] = LAYOUT[slot];
  const [x, y] = proj(sx + 26, sz - 16);
  return { x, y, scale: 0.75 };
}
