import { describe, expect, it } from "vitest";

import { type DrawnPlayer, type RadarPicture, drawRadar } from "./radarDraw";
import { CENTRE_LANE, HALFWAY } from "./radarGeometry";
import { PALETTE_CLASSES, type RadarPalette } from "./radarPalette";
import { recordingContext } from "./radarTestFixtures";

const palette = Object.fromEntries(
  [...Object.keys(PALETTE_CLASSES), "headingFont", "bodyFont"].map((key) => [key, key]),
) as RadarPalette;

function player(id: string, overrides: Partial<DrawnPlayer> = {}): DrawnPlayer {
  return {
    id,
    side: "Home",
    at: { x: HALFWAY, y: CENTRE_LANE },
    kit: null,
    number: 7,
    name: `Player ${id}`,
    showName: false,
    isHighlighted: false,
    isKeeper: false,
    ...overrides,
  };
}

function picture(overrides: Partial<RadarPicture> = {}): RadarPicture {
  return {
    ball: { x: HALFWAY, y: CENTRE_LANE },
    lift: 0,
    ballOpacity: 1,
    trail: [],
    overlay: null,
    players: [],
    celebration: null,
    pulse: null,
    goalLabel: "Goal",
    ...overrides,
  };
}

describe("drawRadar", () => {
  // Given players on the radar, then each is a dot with his shirt number, and
  // only those whose names are to be shown get a name.
  it("draws each player with his number, and names only those asked for", () => {
    const { context, texts } = recordingContext();
    drawRadar(
      context,
      picture({ players: [player("a"), player("b", { number: 9, showName: true })] }),
      palette,
      6,
    );
    expect(texts()).toEqual(["7", "9", "Player b"]);
  });

  // Given a player with no kit colour, then his dot wears his side's theme colour.
  it("falls back to the side's theme colour", () => {
    const { context, calls } = recordingContext();
    const fills: unknown[] = [];
    const original = context.fill.bind(context);
    context.fill = () => {
      fills.push(context.fillStyle);
      original();
    };
    drawRadar(context, picture({ players: [player("a", { side: "Away" })] }), palette, 6);
    expect(fills).toContain("awayFallback");
    expect(calls.some((call) => call.method === "arc")).toBe(true);
  });

  // Given a goal being celebrated, then the banner says so while it lasts.
  it("writes the goal banner during a celebration", () => {
    const { context, texts } = recordingContext();
    drawRadar(context, picture({ celebration: { side: "Home", progress: 0.5 } }), palette, 6);
    expect(texts()).toContain("GOAL");
  });

  // Given a booking, then a card is drawn over the booked player only.
  it("draws a card over the booked player", () => {
    const { context, calls } = recordingContext();
    drawRadar(
      context,
      picture({
        players: [player("a"), player("b")],
        overlay: { kind: "card", playerId: "b", colour: "yellow" },
      }),
      palette,
      6,
    );
    expect(calls.filter((call) => call.method === "rotate")).toHaveLength(1);
  });
});
