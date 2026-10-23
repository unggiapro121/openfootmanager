import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MatchRadar2D } from "./MatchRadar2D";
import { radarSnapshot, recordingContext } from "./radarTestFixtures";
import { RADAR_PACING, useRadarDirector } from "./useRadarDirector";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("./useRadarDirector", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useRadarDirector")>();
  return { ...actual, useRadarDirector: vi.fn(actual.useRadarDirector) };
});

const kits = { home: null, away: null };

function radar(pacing?: { timeScale: number; maxLagMs: number }) {
  render(
    <MatchRadar2D
      roster={new Map()}
      snapshot={radarSnapshot()}
      kits={kits}
      isOpen
      onToggle={() => {}}
      paused={false}
      {...(pacing ? { pacing } : {})}
    />,
  );
}

describe("MatchRadar2D pacing", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      recordingContext().context as never,
    );
    vi.mocked(useRadarDirector).mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  // Given the desktop match, which names no pacing,
  // when the radar plays,
  // then it waits for the radar as before (no lag limit).
  it("keeps the desktop's pacing by default", () => {
    radar();
    expect(vi.mocked(useRadarDirector).mock.calls[0]?.[1]).toBe(RADAR_PACING);
  });

  // Given a live online match that may not fall more than two steps behind,
  // when the radar plays,
  // then that limit is the one the director keeps.
  it("plays to the pacing it is given", () => {
    const pacing = { timeScale: 0.7, maxLagMs: 4000 };
    radar(pacing);
    expect(vi.mocked(useRadarDirector).mock.calls[0]?.[1]).toBe(pacing);
  });
});
