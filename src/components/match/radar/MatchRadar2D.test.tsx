import { act, fireEvent, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MatchRadar2D } from "./MatchRadar2D";
import { radarEvent, radarSnapshot, recordingContext } from "./radarTestFixtures";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const kits = { home: "#c8102e", away: "#1d4ed8" };
const BANNER = "MATCH.EVENTTYPES.GOAL";

let canvas = recordingContext();

/** What the last few frames wrote on the canvas, after `ms` more of play. */
function textsAfter(ms: number): string[] {
  act(() => vi.advanceTimersByTime(ms));
  canvas.clear();
  act(() => vi.advanceTimersByTime(50));
  return canvas.texts();
}

const namesIn = (texts: string[]) => new Set(texts.filter((text) => text.startsWith("Player ")));

describe("MatchRadar2D", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    canvas = recordingContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(canvas.context as never);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // Given a live match, then the radar is a labelled region holding a labelled
  // picture of the pitch.
  it("shows the pitch as a labelled picture", () => {
    render(<MatchRadar2D snapshot={radarSnapshot()} speed="normal" kits={kits} />);
    expect(screen.getByRole("region", { name: "match.radar.title" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "match.radar.pitchLabel" })).toBeInTheDocument();
  });

  // Given the radar, when the manager turns on every name, then all 22 players
  // are named on the pitch, and the toggle says it is on.
  it("names every player when asked", () => {
    render(<MatchRadar2D snapshot={radarSnapshot()} speed="normal" kits={kits} />);
    const toggle = screen.getByRole("button", { name: "match.radar.allNames" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(namesIn(textsAfter(50)).size).toBe(0);

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    const names = namesIn(textsAfter(50));
    expect(names.has("Player h_gk")).toBe(true);
    expect(names.size).toBe(22);
  });

  // Given a player sent off, then he is not on the radar.
  it("leaves a sent-off player off the pitch", () => {
    render(
      <MatchRadar2D snapshot={radarSnapshot({ sent_off: ["h_cb2"] })} speed="normal" kits={kits} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "match.radar.allNames" }));
    const names = namesIn(textsAfter(50));
    expect(names.has("Player h_cb2")).toBe(false);
    expect(names.size).toBe(21);
  });

  // Given the radar, when the manager hides it, then the pitch goes and the
  // button offers to show it again; showing it brings the pitch back.
  it("hides and shows again", () => {
    render(<MatchRadar2D snapshot={radarSnapshot()} speed="normal" kits={kits} />);
    const hide = screen.getByRole("button", { name: "match.radar.hide" });
    expect(hide).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(hide);

    expect(screen.queryByRole("img", { name: "match.radar.pitchLabel" })).not.toBeInTheDocument();
    const show = screen.getByRole("button", { name: "match.radar.show" });
    expect(show).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(show);
    expect(screen.getByRole("img", { name: "match.radar.pitchLabel" })).toBeInTheDocument();
  });

  // Given a goal in the next minute, when it plays out, then the radar flashes
  // the goal and names the scorer; the banner clears afterwards.
  it("celebrates a goal", () => {
    const { rerender } = render(
      <MatchRadar2D snapshot={radarSnapshot()} speed="slow" kits={kits} />,
    );
    rerender(
      <MatchRadar2D
        snapshot={radarSnapshot({
          events: [radarEvent("Goal", "Home", "AwayBox", "h_st1", "h_lm")],
          ball_zone: "Midfield",
          possession: "Away",
        })}
        speed="slow"
        kits={kits}
      />,
    );
    let texts: string[] = [];
    for (let elapsed = 0; elapsed < 3000 && !texts.includes(BANNER); elapsed += 100) {
      texts = textsAfter(50);
    }
    expect(texts).toContain(BANNER);
    expect(texts).toContain("Player h_st1");
    expect(textsAfter(4000)).not.toContain(BANNER);
  });

  // Given a goal being celebrated, when the manager switches to the skip-ahead
  // speed mid-celebration, then the banner still clears.
  it("clears the goal banner after a switch to the skip-ahead speed", () => {
    const goal = radarSnapshot({
      events: [radarEvent("Goal", "Home", "AwayBox", "h_st1", "h_lm")],
      ball_zone: "Midfield",
      possession: "Away",
    });
    const { rerender } = render(
      <MatchRadar2D snapshot={radarSnapshot()} speed="slow" kits={kits} />,
    );
    rerender(<MatchRadar2D snapshot={goal} speed="slow" kits={kits} />);
    let texts: string[] = [];
    for (let elapsed = 0; elapsed < 3000 && !texts.includes(BANNER); elapsed += 100) {
      texts = textsAfter(50);
    }
    expect(texts).toContain(BANNER);

    rerender(<MatchRadar2D snapshot={goal} speed="instant" kits={kits} />);
    act(() => vi.advanceTimersByTime(4000));
    canvas.clear();
    rerender(<MatchRadar2D snapshot={goal} speed="instant" kits={kits} />);

    expect(canvas.texts()).not.toContain(BANNER);
  });

  // Given a minute playing out, then the players move without React rendering
  // the radar again: only a new snapshot or the manager's clicks render it (T4).
  it("moves the players without re-rendering", () => {
    let renders = 0;
    const tree = (snapshot: ReturnType<typeof radarSnapshot>) => (
      <Profiler id="radar" onRender={() => (renders += 1)}>
        <MatchRadar2D snapshot={snapshot} speed="slow" kits={kits} />
      </Profiler>
    );
    const { rerender } = render(tree(radarSnapshot()));
    rerender(
      tree(
        radarSnapshot({
          events: [radarEvent("Dribble", "Home", "AwayDefense", "h_st1")],
          ball_zone: "AwayDefense",
        }),
      ),
    );
    const afterSnapshot = renders;
    canvas.clear();
    act(() => vi.advanceTimersByTime(3000));
    expect(canvas.calls.filter((call) => call.method === "clearRect").length).toBeGreaterThan(60);
    expect(renders).toBe(afterSnapshot);
  });
});
