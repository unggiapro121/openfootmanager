import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MatchRadar2D } from "./MatchRadar2D";
import { radarEvent, radarSnapshot } from "./radarTestFixtures";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const kits = { home: "#c8102e", away: "#1d4ed8" };

describe("MatchRadar2D", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

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
    expect(screen.queryByText("Player h_gk")).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Player h_gk")).toBeInTheDocument();
    expect(screen.getAllByText(/^Player /)).toHaveLength(22);
  });

  // Given a player sent off, then he is not on the radar.
  it("leaves a sent-off player off the pitch", () => {
    render(
      <MatchRadar2D snapshot={radarSnapshot({ sent_off: ["h_cb2"] })} speed="normal" kits={kits} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "match.radar.allNames" }));
    expect(screen.queryByText("Player h_cb2")).not.toBeInTheDocument();
    expect(screen.getAllByText(/^Player /)).toHaveLength(21);
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
    act(() => vi.advanceTimersByTime(2500));
    expect(screen.getByText("match.eventTypes.Goal")).toBeInTheDocument();
    expect(screen.getByText("Player h_st1")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByText("match.eventTypes.Goal")).not.toBeInTheDocument();
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
    for (let elapsed = 0; elapsed < 3000; elapsed += 50) {
      if (screen.queryByText("match.eventTypes.Goal")) break;
      act(() => vi.advanceTimersByTime(50));
    }
    expect(screen.getByText("match.eventTypes.Goal")).toBeInTheDocument();

    rerender(<MatchRadar2D snapshot={goal} speed="instant" kits={kits} />);
    act(() => vi.advanceTimersByTime(4000));

    expect(screen.queryByText("match.eventTypes.Goal")).not.toBeInTheDocument();
  });
});
