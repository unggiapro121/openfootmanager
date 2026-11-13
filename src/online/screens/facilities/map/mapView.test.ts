import { describe, expect, it } from "vitest";
import type { CardState } from "../cardState";
import { proj } from "./layout";
import {
  centreOn,
  clampToGround,
  cranePlace,
  DRAG_SLOP,
  defaultView,
  drawOrder,
  focusPoint,
  LIST_ORDER,
  labelY,
  MAX_SCALE,
  MIN_SCALE,
  mapStatus,
  ringPath,
  toSvg,
  unitOf,
  zoomAt,
} from "./mapView";

/** A map 940 × 420 CSS px: one map unit to one pixel, as the viewBox is drawn. */
const ONE_TO_ONE = { left: 0, top: 0, width: 940, height: 420 };

describe("the campus map's view (c-27 §6.2)", () => {
  // Given a map narrower than 600 px or not,
  // when it opens,
  // then it starts at the design's zoom: 2.3 close in, or 1.08 with the whole campus.
  it("starts at the design's view", () => {
    expect(defaultView(true)).toEqual({ s: 2.3, tx: 0, ty: -6 });
    expect(defaultView(false)).toEqual({ s: 1.08, tx: 20, ty: 6 });
  });

  // Given a view,
  // when it is zoomed about a point,
  // then the point stays put and the scale is held to [0.8, 4.5].
  it("zooms about a point, within its range", () => {
    const view = { s: 1, tx: 10, ty: -20 };
    const zoomed = zoomAt(view, 2, 100, 50);
    expect(zoomed.s).toBe(2);
    // The world point under (100, 50) before is under it after.
    const before = [(100 - view.tx) / view.s, (50 - view.ty) / view.s];
    const after = [(100 - zoomed.tx) / zoomed.s, (50 - zoomed.ty) / zoomed.s];
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
    expect(zoomAt(view, 100, 0, 0).s).toBe(MAX_SCALE);
    expect(zoomAt(view, 0.01, 0, 0).s).toBe(MIN_SCALE);
    expect([MIN_SCALE, MAX_SCALE]).toEqual([0.8, 4.5]);
  });

  // Given a view and a building's point,
  // when the map centres on it at a place on screen,
  // then that point is drawn there and the scale is kept.
  it("centres a point where asked", () => {
    const view = centreOn({ s: 2, tx: 0, ty: 0 }, [100, 40], [-30, 10]);
    expect(view).toEqual({ s: 2, tx: -230, ty: -70 });
  });

  // Given the map's frame on screen,
  // when its unit and a pointer's place on it are read,
  // then the unit is the viewBox's to the frame's ("meet"), and the place is in map units.
  it("reads the screen in map units", () => {
    expect(unitOf(ONE_TO_ONE)).toBe(1);
    expect(unitOf({ width: 470, height: 420 })).toBe(2);
    expect(unitOf({ width: 0, height: 0 })).toBe(1);
    expect(toSvg(ONE_TO_ONE, 470, 200)).toEqual([0, 0]);
    // Twice as tall as the viewBox's shape: letterboxed above and below.
    const tall = { left: 0, top: 0, width: 940, height: 840 };
    expect(toSvg(tall, 470, 420)).toEqual([0, 10]);
  });

  // Given a view dragged past the campus ground's edge, or a frame too big for the ground,
  // when it is held to the ground,
  // then the ground covers the frame again, or is centred in it; a frame not laid out is left be.
  it("keeps the ground under the whole frame", () => {
    // At scale 1 the frame shows x -470..470, y -200..220; the ground spans x -760..760, y -430..400.
    expect(clampToGround({ s: 1, tx: 400, ty: -300 }, ONE_TO_ONE)).toEqual({
      s: 1,
      tx: 290,
      ty: -180,
    });
    expect(clampToGround({ s: 1, tx: -10, ty: 5 }, ONE_TO_ONE)).toEqual({ s: 1, tx: -10, ty: 5 });
    // A 440 px side panel: the ground need only reach the panel's edge, x 30.
    expect(clampToGround({ s: 1, tx: -900, ty: 0 }, ONE_TO_ONE, { right: 440, bottom: 0 }).tx).toBe(
      -730,
    );
    // A frame far taller than the ground at the least zoom: centred up and down.
    const tall = { left: 0, top: 0, width: 300, height: 2000 };
    const held = clampToGround({ s: 0.8, tx: 0, ty: 900 }, tall);
    expect(held.ty).toBeCloseTo(10 - 0.8 * -15);
    expect(
      clampToGround({ s: 1, tx: 999, ty: 0 }, { left: 0, top: 0, width: 0, height: 0 }),
    ).toEqual({
      s: 1,
      tx: 999,
      ty: 0,
    });
  });

  // Given a side panel open on a wide map, or a sheet on a phone,
  // when a building is focused,
  // then it is centred in the map left of the panel, or in the top part above the sheet.
  it("centres beside the panel or above the sheet", () => {
    const frame = { left: 0, top: 0, width: 1000, height: 600 };
    expect(focusPoint(frame, "side")).toEqual([280, 300]);
    expect(focusPoint({ ...frame, width: 800 }, "side")).toEqual([400, 300]);
    const [x, y] = focusPoint(frame, "sheet");
    expect(x).toBe(500);
    expect(y).toBeCloseTo(168);
  });
});

describe("the campus map's drawing (c-27 §6.1)", () => {
  // Given the eight slots,
  // when they are drawn,
  // then the far ones come first, by their place on the map from top to bottom.
  it("draws the far buildings first", () => {
    const order = drawOrder();
    expect(order).toEqual([
      "training",
      "academy",
      "trophy",
      "stands",
      "medical",
      "park",
      "shop",
      "food",
    ]);
    expect([...order].sort()).toEqual([...LIST_ORDER].sort());
  });

  // Given the list's order,
  // when the map is walked with Tab,
  // then it goes as the list does, not as the picture.
  it("keeps the list's order for the keyboard", () => {
    expect(LIST_ORDER).toEqual([
      "stands",
      "shop",
      "food",
      "park",
      "training",
      "medical",
      "academy",
      "trophy",
    ]);
  });

  // Given a slot's footprint radius,
  // when its ring is drawn,
  // then it is the design's ellipse, flattened by the tilt.
  it("draws the design's ring", () => {
    expect(ringPath(100)).toBe("M-100,0a100,55.9 0 1,0 200,0a100,55.9 0 1,0 -200,0");
  });

  // Given each card state,
  // when its dot is chosen,
  // then building, up a level, waiting and top each have their own.
  it("gives each state its dot", () => {
    const cases: [CardState, string][] = [
      [{ kind: "building", build: {} as never }, "building"],
      [{ kind: "top" }, "top"],
      [{ kind: "ready", cost: 1 }, "upgradable"],
      [{ kind: "unbuilt", cost: 1 }, "upgradable"],
      [{ kind: "short", cost: 2, missing: 1 }, "waiting"],
      [{ kind: "builderBusy", busy: {} as never }, "waiting"],
      [{ kind: "coachLocked", coachLevel: 6, current: 5 }, "waiting"],
      [{ kind: "writesOff", reason: "economy" }, "waiting"],
    ];
    for (const [state, status] of cases) expect(mapStatus(state)).toBe(status);
  });

  // Given a building and its art,
  // when its label is placed,
  // then it floats over the art's top, never further than the design's cap above the slot.
  it("places the label over the art", () => {
    const [, standsY] = proj(0, 0);
    expect(labelY("stands", "tinh")).toBeCloseTo(standsY - 60.55);
    expect(labelY("stands", "luoi")).toBeCloseTo(standsY - 70);
    const [, shopY] = proj(-110, 195);
    expect(labelY("shop", "shop")).toBeCloseTo(shopY - 19.94);
    expect(labelY("training", "training")).toBeCloseTo(proj(-345, -75)[1] - 39.68);
  });

  // Given a build on the stands or elsewhere,
  // when its crane is placed,
  // then it stands behind the stadium full size, or beside the building smaller.
  it("places the crane", () => {
    const [sx, sy] = proj(-118, -42);
    expect(cranePlace("stands")).toEqual({ x: sx, y: sy, scale: 1 });
    const [mx, my] = proj(305 + 26, 20 - 16);
    expect(cranePlace("medical")).toEqual({ x: mx, y: my, scale: 0.75 });
  });

  // Given the slop a press may move,
  // then it is the design's 6 px.
  it("lets a press move 6 px", () => {
    expect(DRAG_SLOP).toBe(6);
  });
});
