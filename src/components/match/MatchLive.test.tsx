import { act, fireEvent, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameStateData } from "../../store/gameStore";
import MatchLive from "./MatchLive";
import { radarEvent, radarSnapshot, recordingContext } from "./radar/radarTestFixtures";
import type { MatchSnapshot, MinuteResult } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({ isDark: false, toggleTheme: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const gameState = { teams: [], players: [] } as unknown as GameStateData;

/** The engine, one minute at a time: each step brings a goal, and the snapshot after it. */
function engineScoringEachMinute() {
  let events = [] as ReturnType<typeof radarEvent>[];
  let latest: MatchSnapshot = radarSnapshot();
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === "step_live_match") {
      const minute = latest.current_minute + 1;
      const goal = radarEvent("Goal", "Home", "AwayBox", "h_st1", null, minute);
      events = [...events, goal];
      latest = radarSnapshot({
        current_minute: minute,
        events,
        home_score: events.length,
        ball_zone: "Midfield",
        possession: "Away",
      });
      const result: MinuteResult = {
        minute,
        phase: "FirstHalf",
        events: [goal],
        home_score: events.length,
        away_score: 0,
        possession: "Away",
        ball_zone: "Midfield",
        is_finished: false,
      };
      return [result];
    }
    if (command === "get_match_snapshot") return latest;
    return undefined;
  });
}

function renderMatch(onSnapshotUpdate: (snap: MatchSnapshot) => void) {
  return render(
    <MatchLive
      snapshot={radarSnapshot()}
      gameState={gameState}
      userSide="Home"
      isSpectator={false}
      importantEvents={[]}
      onSnapshotUpdate={onSnapshotUpdate}
      onImportantEvent={() => {}}
      onHalfTime={() => {}}
      onFullTime={() => {}}
    />,
  );
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const stepsTaken = () =>
  vi.mocked(invoke).mock.calls.filter(([command]) => command === "step_live_match").length;

describe("MatchLive — the 2D mode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      recordingContext().context as never,
    );
    engineScoringEachMinute();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(invoke).mockReset();
    vi.useRealTimers();
  });

  // Given the radar shown, then a minute fetched from the engine is shown — the
  // score, the feed — only once the radar has played it, and the next minute is
  // asked for only then.
  it("shows a minute only after the radar has played it", async () => {
    const onSnapshotUpdate = vi.fn();
    renderMatch(onSnapshotUpdate);
    await wait(100);
    expect(stepsTaken()).toBe(1);
    await wait(300);
    expect(onSnapshotUpdate).not.toHaveBeenCalled();
    expect(stepsTaken()).toBe(1);

    await wait(15_000);
    expect(onSnapshotUpdate).toHaveBeenCalled();
    expect(onSnapshotUpdate.mock.calls[0][0].current_minute).toBe(11);
    expect(stepsTaken()).toBeGreaterThan(1);
  });

  // Given the 2D mode, then there is no speed to choose — only pause and
  // resume — until the radar is hidden.
  it("offers only pause and resume while the radar is shown", () => {
    renderMatch(() => {});
    expect(screen.queryByRole("button", { name: "match.fast" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "match.pause" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "match.resumeMatch" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "match.radar.hide" }));

    expect(screen.getByRole("button", { name: "match.fast" })).toBeInTheDocument();
  });

  // Given the radar hidden, then the text mode runs on its speed's timer and
  // shows each minute as soon as it comes.
  it("runs on the speed timer once the radar is hidden", async () => {
    const onSnapshotUpdate = vi.fn();
    renderMatch(onSnapshotUpdate);
    fireEvent.click(screen.getByRole("button", { name: "match.radar.hide" }));
    const before = stepsTaken();
    await wait(1000);
    expect(stepsTaken()).toBeGreaterThan(before);
    expect(onSnapshotUpdate).toHaveBeenCalled();
  });

  // Given the 2D mode paused, then no minute is asked for.
  it("asks for nothing while paused", async () => {
    renderMatch(() => {});
    fireEvent.click(screen.getByRole("button", { name: "match.pause" }));
    await wait(5000);
    expect(stepsTaken()).toBe(0);
  });

  // Given the substitutions panel open in the 2D mode, then no further minute
  // is asked for until it is closed.
  it("asks for nothing while the substitutions panel is open", async () => {
    renderMatch(() => {});
    fireEvent.click(screen.getByRole("button", { name: /match\.subs/ }));
    await wait(5000);
    expect(stepsTaken()).toBe(0);
  });
});
