import { describe, expect, it } from "vitest";
import { ART_KEYS, type ArtKey } from "../art/artKeys";
import { artBox, LAYOUT, type MapSlot, placeArt, proj, RING } from "./layout";

/**
 * Each art's box at its own origin in the approved design (`SPR` of co-so-vat-chat.html,
 * c-27 Phụ lục A, md5 fc3f2423): x, y, w, h in map units.
 */
const DESIGN_BOX: Record<ArtKey, { x: number; y: number; w: number; h: number }> = {
  tinh: { x: -118.9, y: -74.55, w: 240.33, h: 129.67 },
  gian: { x: -127.5, y: -111.88, w: 255, h: 171.83 },
  anh: { x: -110.63, y: -77.54, w: 227, h: 130 },
  hop: { x: -110.8, y: -79.21, w: 241.67, h: 132.67 },
  mang: { x: -120.26, y: -86.03, w: 263.33, h: 144.83 },
  buom: { x: -123.7, y: -108.3, w: 278.33, h: 169 },
  chao: { x: -116.82, y: -85.26, w: 256, h: 142.17 },
  so: { x: -116.82, y: -81.93, w: 252.33, h: 138.83 },
  mo: { x: -127.57, y: -101.64, w: 286.17, h: 164.5 },
  luoi: { x: -129.29, y: -103.78, w: 289.5, h: 167.67 },
  shop: { x: -61.02, y: -33.94, w: 120.12, h: 63.69 },
  food: { x: -65.1, y: -35.17, w: 135.12, h: 64.88 },
  park: { x: -72.28, y: -35.73, w: 152.26, h: 67.74 },
  training: { x: -127.06, y: -53.68, w: 260.29, h: 103.38 },
  medical: { x: -74.74, y: -43.96, w: 156.9, h: 78.45 },
  academy: { x: -88.4, y: -46.14, w: 186.43, h: 83.69 },
  trophy: { x: -60.54, y: -37.51, w: 125.48, h: 66.43 },
  empty: { x: -65.1, y: -31.95, w: 131.31, h: 61.67 },
  crane: { x: -9.4, y: -55.71, w: 69.4, h: 58.33 },
  ground: { x: -760, y: -430, w: 1520, h: 830 },
};

/** Where the design puts each slot on the map: its `proj(LAYOUT[slot])`, by the design's formula. */
const DESIGN_SLOT: Record<MapSlot, { x: number; y: number }> = {
  stands: { x: 0, y: 0 },
  training: { x: -304.94, y: -99.5 },
  academy: { x: -341.78, y: -18 },
  medical: { x: 283.89, y: 63.34 },
  trophy: { x: 312.89, y: -13.71 },
  shop: { x: -164.87, y: 84.7 },
  food: { x: 39.6, y: 121.85 },
  park: { x: -304.2, y: 71.14 },
};

const TOLERANCE = 0.5;
const SIZE_TOLERANCE = 2;

describe("the campus map layout", () => {
  // Given every art the tool renders and its meta.json,
  // when each art's box is read,
  // then its corner is the approved design's to within half a unit, and its size to within
  // two: `--layers` starts every piece from a fresh random seed, so a tree at the edge of a
  // piece can differ from the design's run (the academy is 1.8 units narrower).
  it("places each art's box as the design does", () => {
    for (const key of ART_KEYS) {
      const box = artBox(key);
      const design = DESIGN_BOX[key];
      for (const side of ["x", "y"] as const) {
        expect(Math.abs(box[side] - design[side]), `${key}.${side}`).toBeLessThanOrEqual(TOLERANCE);
      }
      for (const side of ["w", "h"] as const) {
        expect(Math.abs(box[side] - design[side]), `${key}.${side}`).toBeLessThanOrEqual(
          SIZE_TOLERANCE,
        );
      }
    }
  });

  // Given each slot of the campus,
  // when it is projected at 18° and 34°,
  // then it lands where the design puts it.
  it("projects each slot where the design puts it", () => {
    for (const slot of Object.keys(LAYOUT) as MapSlot[]) {
      const [x, z] = LAYOUT[slot];
      const [sx, sy] = proj(x, z);
      expect(Math.abs(sx - DESIGN_SLOT[slot].x), `${slot}.x`).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(sy - DESIGN_SLOT[slot].y), `${slot}.y`).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  // Given a slot and the art on it,
  // when the art is placed,
  // then its box is the slot's point plus the art's own box.
  it("places an art on its slot", () => {
    const placed = placeArt("training", "training");
    expect(placed.x).toBeCloseTo(DESIGN_SLOT.training.x + DESIGN_BOX.training.x, 0);
    expect(placed.y).toBeCloseTo(DESIGN_SLOT.training.y + DESIGN_BOX.training.y, 0);
    expect(placed.w).toBeCloseTo(DESIGN_BOX.training.w, 0);
    expect(placed.h).toBeCloseTo(DESIGN_BOX.training.h, 0);
  });

  // Given the height argument,
  // when a raised point is projected,
  // then it rises on screen by its height × cos 34°.
  it("raises a point by its height", () => {
    const [, ground] = proj(0, 0);
    const [, raised] = proj(0, 0, 10);
    expect(ground - raised).toBeCloseTo(10 * Math.cos((34 * Math.PI) / 180), 6);
  });

  // Given the footprint rings,
  // when they are read,
  // then every slot has one.
  it("rings every slot", () => {
    expect(Object.keys(RING).sort()).toEqual(Object.keys(LAYOUT).sort());
  });
});
