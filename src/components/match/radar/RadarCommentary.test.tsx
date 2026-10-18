import { act, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import i18n, { i18nReady } from "../../../i18n";
import type { RadarCaption } from "./radarCaptions";
import { READ_MS } from "./radarCommentaryFeed";
import { RadarCommentary, type CaptionSink } from "./RadarCommentary";
import { radarEvent, radarSnapshot } from "./radarTestFixtures";

let previousLanguage: string;

beforeAll(async () => {
  await i18nReady;
  previousLanguage = i18n.language;
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage(previousLanguage);
});

function mount(snapshot = radarSnapshot()) {
  const sink = createRef<CaptionSink>() as { current: CaptionSink | null };
  render(<RadarCommentary snapshot={snapshot} sinkRef={sink} />);
  const say = (caption: RadarCaption) => act(() => sink.current?.(caption));
  return { say };
}

const corner: RadarCaption = {
  kind: "line",
  priority: "play",
  keys: ["corner.noTaker"],
  tokens: { side: "Home" },
  seed: "c",
};

describe("RadarCommentary", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Given the radar plays a beat, when its caption is said, then the bar shows the line. */
  it("shows what the radar says", () => {
    const { say } = mount();
    say(corner);
    expect(screen.getByText("Corner to h FC.")).toBeInTheDocument();
  });

  /** Given a goal, then it shows with its headline, and is announced to a screen reader. */
  it("shows and announces a goal", () => {
    const goal = radarEvent("Goal", "Home", "AwayBox", "h_st1");
    const { say } = mount(radarSnapshot({ events: [goal] }));
    say({ kind: "event", priority: "key", event: goal, assist: null });
    const announced = screen.getByRole("status");
    expect(announced.textContent).toMatch(/Player h_st1/);
    expect(screen.getAllByText(/GOO?AL/).length).toBeGreaterThan(0);
  });

  /** Given a goal just shown, when play follows at once, then the goal stays until it has been read. */
  it("keeps a goal up until it has been read", () => {
    const goal = radarEvent("Goal", "Home", "AwayBox", "h_st1");
    const { say } = mount(radarSnapshot({ events: [goal] }));
    say({ kind: "event", priority: "key", event: goal, assist: null });
    say(corner);
    expect(screen.queryByText("Corner to h FC.")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(READ_MS));
    expect(screen.getByText("Corner to h FC.")).toBeInTheDocument();
  });
});
