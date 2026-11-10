import { artMetaOf } from "../art/artFiles";
import type { ArtKey } from "../art/artKeys";

/**
 * The campus map's geometry (c-27 §6.1, C27-16), copied from the render tool's `lib_campus.js`
 * and the approved design: an orthographic view turned 18° and tilted 34°, 1 unit = 1 m.
 */
const TURN = (18 * Math.PI) / 180;
const TILT = (34 * Math.PI) / 180;

/** A ground point (x east, z south, h up, in metres) on the map, in map units. */
export function proj(x: number, z: number, h = 0): [number, number] {
  return [
    x * Math.cos(TURN) - z * Math.sin(TURN),
    Math.sin(TILT) * (x * Math.sin(TURN) + z * Math.cos(TURN)) - h * Math.cos(TILT),
  ];
}

/** Where each facility stands on the campus, in metres (x east, z south). */
export const LAYOUT = {
  stands: [0, 0],
  training: [-345, -75],
  academy: [-335, 75],
  medical: [305, 20],
  trophy: [290, -120],
  shop: [-110, 195],
  food: [105, 195],
  park: [-250, 215],
} as const satisfies Record<string, readonly [number, number]>;

export type MapSlot = keyof typeof LAYOUT;

/** Each slot's footprint radius in metres, for its selection ring. */
export const RING: Record<MapSlot, number> = {
  stands: 128,
  shop: 56,
  food: 60,
  park: 66,
  training: 122,
  medical: 68,
  academy: 78,
  trophy: 56,
};

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An art piece's box around its own origin. */
export function artBox(art: ArtKey): Box {
  const { x, y, w, h } = artMetaOf(art);
  return { x, y, w, h };
}

/** An art piece's box when it stands on `slot`. */
export function placeArt(slot: MapSlot, art: ArtKey): Box {
  const [x, z] = LAYOUT[slot];
  const [left, top] = proj(x, z);
  const box = artBox(art);
  return { ...box, x: left + box.x, y: top + box.y };
}
