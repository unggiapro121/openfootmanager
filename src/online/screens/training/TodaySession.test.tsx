import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OnlineRequest } from "../../../services/onlineTransport";
import {
  type Answer,
  fail,
  fakeServer,
  myClub,
  ok,
  resetOnline,
  SEASON,
  squadPlayer,
} from "../../../test-utils/onlineTestKit";
import type {
  ExtraDayView,
  ExtraSessionView,
  FixtureView,
  MyClubView,
  TrainingDayView,
} from "../../api";
import { formatKickoffClock } from "../../format";
import { useOnlineStore } from "../../store/onlineStore";
import OnlineTraining from "../OnlineTraining";
import TodaySession from "./TodaySession";
import {
  PENDING_FAST_MS,
  PENDING_FAST_READS,
  PENDING_SLOW_MS,
  PENDING_SLOW_READS,
} from "./useDayPendingPoll";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === "object"
        ? `${key}:${Object.values(options as Record<string, unknown>).join("|")}`
        : key,
    i18n: { language: "en" },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));

vi.mock("../../../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) =>
    `resolved:${error instanceof Error ? error.message : String(error)}`,
}));

const HOUR = 60 * 60 * 1000;
const FIXTURE = myClub().nextFixture as FixtureView;

function trainingDay(overrides: Partial<TrainingDayView> = {}): TrainingDayView {
  return {
    day: 3,
    recent: [
      { day: 0, kind: "bot" },
      { day: 2, kind: "manual" },
    ],
    canTrain: true,
    sessionsLast7: 2,
    sessionsCap: 6,
    nextRecoveryAt: new Date(Date.now() + 2 * HOUR).toISOString(),
    recovery: { perDay: 6, hours: 8 },
    autoOff: false,
    extra: extraDay(),
    ...overrides,
  };
}

function extraDay(overrides: Partial<ExtraDayView> = {}): ExtraDayView {
  return {
    canPress: true,
    today: 0,
    floor: 40,
    costs: { Low: 3, Medium: 6, High: 10 },
    sitOut: [],
    ...overrides,
  };
}

function clubWith(day: Partial<TrainingDayView> = {}, overrides: Partial<MyClubView> = {}) {
  return myClub({ trainingDay: trainingDay(day), ...overrides });
}

/** The card as the training page holds it: from the store, so a read of the club shows. */
function CardFromStore() {
  const club = useOnlineStore((state) => state.club);
  if (!club?.trainingDay) return null;
  return <TodaySession club={club} trainingDay={club.trainingDay} />;
}

let server: ReturnType<typeof fakeServer>;

function stage(
  club: MyClubView,
  routes: Record<string, Answer | ((r: OnlineRequest) => Answer)> = {},
) {
  server = fakeServer({ "GET v1/clubs/mine": ok(club), ...routes });
  useOnlineStore.getState().setClub(club);
}

const PRESS_PATH = "v1/clubs/mine/training/extra";
const presses = () => server.requests.filter((r) => r.segments.join("/") === PRESS_PATH);
const clubReads = () => server.requests.filter((r) => r.segments.join("/") === "v1/clubs/mine");
const SQUAD = [
  squadPlayer({ id: "p1", matchName: "V. An", condition: 80 }),
  squadPlayer({ id: "p2", matchName: "T. Bình", condition: 60 }),
];
const pressButton = () => screen.getByRole("button", { name: /online\.training\.extra\.press/ });

function answer(overrides: Partial<ExtraSessionView> = {}): ExtraSessionView {
  return {
    day: 3,
    intensity: "Low",
    held: 3,
    firstN: 1,
    lastN: 3,
    players: [
      { playerId: "p1", conditionBefore: 80, conditionAfter: 71, gains: 4, sessions: 3 },
      {
        playerId: "p2",
        conditionBefore: 60,
        conditionAfter: 57,
        gains: 0,
        sessions: 1,
        stoppedBy: "keepAbove",
      },
    ],
    trainingDay: trainingDay({ extra: extraDay({ today: 3 }) }),
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetOnline();
  useOnlineStore.setState({ season: { ...SEASON, weekday: 0 } });
});
afterEach(() => {
  vi.useRealTimers();
  server?.restore();
});

describe("the training page without recovery blocks", () => {
  // Given a season that does not rest clubs by blocks (no trainingDay),
  // when the training page opens,
  // then it is as it was: no card for today's session, the plan's panels only.
  it("shows no card for today's session", () => {
    stage(myClub());
    render(<OnlineTraining />);
    expect(screen.queryByText(/online\.training\.today\./)).toBeNull();
  });

  // Given a coach with recovery blocks this season who changes his plan's focus,
  // when the plan is saved,
  // then it is sent with auto on, as the server gave it, never off.
  it("saves the plan with auto on", async () => {
    stage(clubWith(), { "PUT v1/clubs/mine/training": ok(myClub().trainingPlan) });
    render(<OnlineTraining />);
    expect(screen.getByText("online.training.today.titleDay:4|28")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Technical\.label/ }));
    const saves = () => server.requests.filter((r) => r.method === "PUT");
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0]?.body).toMatchObject({ focus: "Technical", auto: true });
  });
});

describe("today's session", () => {
  // Given day 3 of the season, two sessions in seven days and rows for days 0 and 2,
  // when the card shows,
  // then it says day 4 of 28, 2 of 6 sessions, and a strip of days 1 to 3 with day 2 empty; the
  // old "train now" button is gone (C12-1).
  it("shows the day from one, the cap and the strip with an empty day", () => {
    stage(clubWith());
    render(<CardFromStore />);
    expect(screen.getByText("online.training.today.titleDay:4|28")).toBeInTheDocument();
    expect(screen.getByText("online.training.today.sessions:2|6")).toBeInTheDocument();
    const strip = screen
      .getAllByRole("listitem")
      .filter((item) => item.getAttribute("aria-label")?.includes("dayCell"));
    expect(strip.map((cell) => cell.getAttribute("aria-label"))).toEqual([
      "online.training.today.dayCell:1: online.training.today.kind.bot",
      "online.training.today.dayCell:2: online.training.today.kind.none",
      "online.training.today.dayCell:3: online.training.today.kind.manual",
    ]);
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("online.training.today.statusNone");
    expect(screen.queryByText(/online\.training\.today\.press/)).toBeNull();
  });

  // Given a club that trained before its coach took over,
  // when the card shows,
  // then it says so, in words, not as a code.
  it("says the club trained before its coach took over", () => {
    stage(clubWith({ today: "bot", canTrain: false, refusal: "be.error.training.sessionToday" }));
    render(<CardFromStore />);
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("online.training.today.statusBot");
  });

  // Given the region's day turning at a moment of the season,
  // when the notes show,
  // then the day-turn note names that moment on this machine's clock, not a fixed 04:00.
  it("names the day's turn from the season", () => {
    const nextDayAt = "2099-01-01T21:00:00Z";
    useOnlineStore.setState({ season: { ...SEASON, weekday: 0, nextDayAt } });
    stage(clubWith());
    render(<CardFromStore />);
    expect(
      screen.getByText(
        `online.training.today.noteDayTurn:${formatKickoffClock(nextDayAt, Date.now(), "en")}`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("online.training.today.noteFatigue")).toBeInTheDocument();
    expect(screen.getByText("online.training.today.noteStamina")).toBeInTheDocument();
  });

  // Given the next recovery mark ahead, then passed with no new read,
  // when the card shows,
  // then it counts down to it, then says condition is being updated.
  it("counts down to the next recovery, then says it is updating", () => {
    stage(clubWith({ nextRecoveryAt: new Date(Date.now() + HOUR).toISOString() }));
    const { unmount } = render(<CardFromStore />);
    expect(
      screen.getByText(/online\.training\.today\.nextRecovery:.*\|0[01]:\d\d:\d\d/),
    ).toBeInTheDocument();
    unmount();
    stage(clubWith({ nextRecoveryAt: new Date(Date.now() - 1000).toISOString() }));
    render(<CardFromStore />);
    expect(screen.getByText("online.training.today.updating")).toBeInTheDocument();
  });

  // Given a day view without the extra block (a server before S-28a),
  // when the card shows,
  // then it has no extra block.
  it("shows no extra block without the server's extra view", () => {
    stage(clubWith({ extra: undefined }));
    render(<CardFromStore />);
    expect(screen.queryByText("online.training.extra.title")).toBeNull();
  });
});

describe("extra training", () => {
  // Given a coach who has never pressed (C-12 §10.4),
  // when the block shows and he presses,
  // then the whole squad, Low and one session go out with a key; the button is off while it is
  // sent; the club is read once after.
  it("presses the whole squad at Low, one session, by default", async () => {
    stage(clubWith({}, { players: SQUAD }), {
      [`POST ${PRESS_PATH}`]: ok(answer({ held: 1, lastN: 1 })),
    });
    render(<CardFromStore />);
    expect(
      screen.getByRole("button", {
        name: "online.training.extra.intensityCost:training.intensities.Low.label|3",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    const press = pressButton();
    expect(press).toHaveTextContent("online.training.extra.press:2|1");
    fireEvent.click(press);
    expect(press).toBeDisabled();
    await screen.findByText("online.training.extra.held:1|1|1");
    expect(presses()[0]?.body).toEqual({ intensity: "Low", players: ["p1", "p2"], sessions: 1 });
    expect(presses()[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(clubReads()).toHaveLength(1));
  });

  // Given a coach who picks three sessions and keeps 60 or above,
  // when he presses and the answer comes,
  // then sessions and keepAbove go out, the batch line says 3 held (1–3 today), a player stopped
  // to keep his condition says so, and gains read "+4" or "no gain".
  it("sends the batch and shows each player's line", async () => {
    stage(clubWith({}, { players: SQUAD }), { [`POST ${PRESS_PATH}`]: ok(answer()) });
    render(<CardFromStore />);
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "online.training.extra.keepAboveOn" }));
    fireEvent.change(screen.getByLabelText("online.training.extra.keepAbove"), {
      target: { value: "60" },
    });
    fireEvent.click(pressButton());
    await screen.findByText("online.training.extra.held:3|1|3");
    expect(presses()[0]?.body).toEqual({
      intensity: "Low",
      players: ["p1", "p2"],
      sessions: 3,
      keepAbove: 60,
    });
    const row = screen.getByText("T. Bình", { selector: "td" }).closest("tr") as HTMLElement;
    expect(within(row).getByText("online.training.extra.reason.keepAbove")).toBeInTheDocument();
    expect(within(row).getByText("online.training.extra.noGain")).toBeInTheDocument();
    const first = screen.getByText("V. An", { selector: "td" }).closest("tr") as HTMLElement;
    expect(within(first).getByText("online.training.extra.gainsCount:4")).toBeInTheDocument();
  });

  // Given a saved choice naming a player who has since been sold,
  // when the coach presses,
  // then only the players still in the squad go out.
  it("never sends a player who left the squad", async () => {
    window.localStorage.setItem(
      "ofm.online.extraTraining.club-1",
      JSON.stringify({ players: ["p2", "sold"], sessions: 1, keepAbove: null }),
    );
    stage(clubWith({}, { players: SQUAD }), { [`POST ${PRESS_PATH}`]: ok(answer()) });
    render(<CardFromStore />);
    fireEvent.click(pressButton());
    await waitFor(() => expect(presses()).toHaveLength(1));
    expect(presses()[0]?.body).toMatchObject({ players: ["p2"] });
  });

  // Given no player chosen, then a view that says no press now,
  // when the block shows,
  // then the button is off each time, and the view's reason is shown.
  it("turns the button off with no one chosen and when the server says no", () => {
    stage(clubWith({}, { players: SQUAD }));
    const { unmount } = render(<CardFromStore />);
    fireEvent.click(screen.getByRole("button", { name: "online.training.extra.selectNone" }));
    expect(pressButton()).toBeDisabled();
    unmount();
    window.localStorage.clear();
    stage(
      clubWith(
        { extra: extraDay({ canPress: false, refusal: "be.error.training.manualOff" }) },
        { players: SQUAD },
      ),
    );
    render(<CardFromStore />);
    expect(pressButton()).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("be.error.training.manualOff");
  });

  // Given a player the server says would sit out (tired),
  // when the block shows,
  // then his line says why, with the season's floor.
  it("shows why a player would sit out", () => {
    stage(
      clubWith(
        { extra: extraDay({ sitOut: [{ playerId: "p2", reason: "tired" }] }) },
        { players: SQUAD },
      ),
    );
    render(<CardFromStore />);
    expect(screen.getByText("online.training.extra.reason.tired:40")).toBeInTheDocument();
  });

  // Given a press refused because every player chosen sits out, and one refused by the lock,
  // when the answer comes,
  // then the card's own sentence shows and the club is read again.
  it.each([
    ["be.error.training.noFitPlayers", {}, "be.error.training.noFitPlayers"],
    [
      "be.error.club.lineupLocked",
      { kickoffAt: FIXTURE.kickoffAt },
      `online.training.today.lineupLocked:${formatKickoffClock(FIXTURE.kickoffAt, Date.now(), "en")}`,
    ],
  ])("shows a 409 %s and reads the club again", async (code, params, text) => {
    stage(clubWith({}, { players: SQUAD }), {
      [`POST ${PRESS_PATH}`]: fail(409, code, { details: { params } }),
    });
    render(<CardFromStore />);
    fireEvent.click(pressButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    await waitFor(() => expect(clubReads()).toHaveLength(1));
  });

  // Given a press that got no answer (status 0),
  // when the coach presses again,
  // then the second press carries the same key, and the server's answer shows.
  it("presses again with the same key after no answer", async () => {
    let calls = 0;
    stage(clubWith({}, { players: SQUAD }), {
      [`POST ${PRESS_PATH}`]: () => {
        calls += 1;
        return calls === 1 ? fail(0, "be.error.online.timeout") : ok(answer());
      },
    });
    render(<CardFromStore />);
    fireEvent.click(pressButton());
    await screen.findByRole("alert");
    await waitFor(() => expect(pressButton()).toBeEnabled());
    fireEvent.click(pressButton());
    await screen.findByText("online.training.extra.held:3|1|3");
    const [first, second] = presses();
    expect(second?.idempotencyKey).toBe(first?.idempotencyKey);
  });

  // Given a match today and a starter at 80 (C12-6),
  // when the coach picks High, then Low,
  // then a warning names him at High (70) and not at Low (77); it never blocks the press.
  it("warns of a starter left under 75 on a match day", () => {
    const nextDayAt = new Date(Date.now() + 10 * HOUR).toISOString();
    useOnlineStore.setState({ season: { ...SEASON, weekday: 0, nextDayAt } });
    const kickoffAt = new Date(Date.now() + 5 * HOUR).toISOString();
    stage(
      clubWith(
        {},
        {
          players: SQUAD,
          nextFixture: { ...FIXTURE, kickoffAt },
          setup: { ...myClub().setup, startingXiIds: ["p1"] },
        },
      ),
    );
    render(<CardFromStore />);
    expect(screen.queryByText(/online\.training\.extra\.xiWarning/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "online.training.extra.intensityCost:training.intensities.High.label|10",
      }),
    );
    expect(screen.getByRole("note")).toHaveTextContent("online.training.extra.xiWarning:V. An|75");
    expect(pressButton()).toBeEnabled();
  });

  // Given a chosen player whose whole Physical focus is at 99 (E5-4 R12-F),
  // when the block shows,
  // then it warns that a session only costs him condition.
  it("warns when a player's focus is full", () => {
    const attributes = {
      ...squadPlayer().attributes,
      pace: 99,
      stamina: 99,
      strength: 99,
      agility: 99,
    };
    stage(
      clubWith(
        {},
        {
          players: [
            squadPlayer({ id: "p1", matchName: "V. An", trainingFocus: "Physical", attributes }),
          ],
        },
      ),
    );
    render(<CardFromStore />);
    expect(screen.getByRole("note")).toHaveTextContent("online.training.extra.focusFull:V. An");
  });
});

describe("today's day job not run yet", () => {
  // Given the day job pending, and the server still pending,
  // when time passes,
  // then the club is read every 5 s for 2 minutes, then every 30 s with a reload button for 10
  // more, then no more; the reload reads it once.
  it("reads the club again, slower after two minutes, then only on reload", async () => {
    vi.useFakeTimers();
    const pending = clubWith({
      canTrain: false,
      refusal: "be.error.training.dayPending",
      extra: extraDay({ canPress: false, refusal: "be.error.training.dayPending" }),
    });
    stage(pending);
    render(<CardFromStore />);
    for (let read = 0; read < PENDING_FAST_READS; read += 1) {
      await act(async () => {
        vi.advanceTimersByTime(PENDING_FAST_MS);
      });
    }
    expect(clubReads()).toHaveLength(PENDING_FAST_READS);
    expect(
      screen.getByRole("button", { name: "online.training.today.reload" }),
    ).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(PENDING_FAST_MS);
    });
    expect(clubReads()).toHaveLength(PENDING_FAST_READS);
    for (let read = 0; read < PENDING_SLOW_READS + 3; read += 1) {
      await act(async () => {
        vi.advanceTimersByTime(PENDING_SLOW_MS);
      });
    }
    expect(clubReads()).toHaveLength(PENDING_FAST_READS + PENDING_SLOW_READS);
    fireEvent.click(screen.getByRole("button", { name: "online.training.today.reload" }));
    await act(async () => {});
    expect(clubReads()).toHaveLength(PENDING_FAST_READS + PENDING_SLOW_READS + 1);
  });

  // Given the day job pending, and the server done after the second read,
  // when time passes,
  // then the reads stop and the button comes on.
  it("stops once the day job has run", async () => {
    vi.useFakeTimers();
    let reads = 0;
    stage(clubWith({ canTrain: false, refusal: "be.error.training.dayPending" }), {
      "GET v1/clubs/mine": () => {
        reads += 1;
        return ok(
          reads < 2
            ? clubWith({ canTrain: false, refusal: "be.error.training.dayPending" })
            : clubWith(),
        );
      },
    });
    render(<CardFromStore />);
    for (let step = 0; step < 6; step += 1) {
      await act(async () => {
        vi.advanceTimersByTime(PENDING_FAST_MS);
      });
    }
    expect(clubReads()).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "online.training.today.reload" })).toBeNull();
  });
});
