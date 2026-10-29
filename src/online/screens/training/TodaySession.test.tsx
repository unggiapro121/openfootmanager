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
import type { FixtureView, MyClubView, TrainingDayView, TrainingSessionView } from "../../api";
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

const presses = () =>
  server.requests.filter((r) => r.segments.join("/") === "v1/clubs/mine/training/sessions");
const clubReads = () => server.requests.filter((r) => r.segments.join("/") === "v1/clubs/mine");

function session(overrides: Partial<TrainingSessionView> = {}): TrainingSessionView {
  const line = (id: string, before: number, after: number) => ({
    playerId: id,
    conditionBefore: before,
    conditionAfter: after,
  });
  return {
    day: 3,
    intensity: "High",
    players: [
      line("p1", 90, 82),
      line("p2", 70, 64),
      line("p3", 50, 49),
      line("p4", 30, 34),
      line("p5", 35, 38),
      line("p6", 60, 60),
    ],
    trainingDay: trainingDay({
      today: "manual",
      canTrain: false,
      refusal: "be.error.training.sessionToday",
      sessionsLast7: 3,
    }),
    ...overrides,
  };
}

beforeEach(() => {
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
  // then it says day 4 of 28, 2 of 6 sessions, and a strip of days 1 to 3 with day 2 empty.
  it("shows the day from one, the cap and the strip with an empty day", () => {
    stage(clubWith());
    render(<CardFromStore />);
    expect(screen.getByText("online.training.today.titleDay:4|28")).toBeInTheDocument();
    expect(screen.getByText("online.training.today.sessions:2|6")).toBeInTheDocument();
    const strip = screen.getAllByRole("listitem").filter((item) => item.getAttribute("aria-label"));
    expect(strip.map((cell) => cell.getAttribute("aria-label"))).toEqual([
      "online.training.today.dayCell:1: online.training.today.kind.bot",
      "online.training.today.dayCell:2: online.training.today.kind.none",
      "online.training.today.dayCell:3: online.training.today.kind.manual",
    ]);
    expect(screen.getByRole("status")).toHaveTextContent("online.training.today.statusNone");
    expect(screen.getByText("online.training.today.noExtra:6")).toBeInTheDocument();
  });

  // Given a coach who picks a high intensity and presses,
  // when the server answers after a while,
  // then the press carries the intensity, the button is off while it is sent, and the answer
  // shows "trained today (high)" with 3 down, 2 up, 1 the same; the club is read once.
  it("holds a session at the intensity picked and shows its answer", async () => {
    stage(clubWith(), {
      "POST v1/clubs/mine/training/sessions": ok(session()),
      "GET v1/clubs/mine": ok(clubWith(session().trainingDay)),
    });
    render(<CardFromStore />);
    fireEvent.click(screen.getByRole("button", { name: "training.intensities.High.label" }));
    const press = screen.getByRole("button", { name: "online.training.today.press" });
    fireEvent.click(press);
    // The answer is still on its way: the button is off until it comes.
    expect(press).toBeDisabled();
    await screen.findByText("online.training.today.summary:3|2|1");
    expect(presses()).toHaveLength(1);
    expect(presses()[0]?.body).toEqual({ intensity: "High" });
    expect(presses()[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByRole("status")).toHaveTextContent(
      "online.training.today.statusManualWith:training.intensities.High.label",
    );
    await waitFor(() => expect(clubReads()).toHaveLength(1));
  });

  // Given a session's answer with an injured player,
  // when the coach opens the list of players,
  // then each player shows his condition when pressed and after, and the injured one his badge.
  it("lists each player with before and after, the injured one marked", async () => {
    const injured = squadPlayer({
      id: "p1",
      matchName: "V. An",
      injury: { name: "be.injury.hamstring", daysRemaining: 4 },
    });
    stage(clubWith({}, { players: [injured, squadPlayer({ id: "p2", matchName: "T. Bình" })] }), {
      "POST v1/clubs/mine/training/sessions": ok(session()),
    });
    render(<CardFromStore />);
    fireEvent.click(screen.getByRole("button", { name: "online.training.today.press" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "online.training.today.showPlayers" }),
    );
    const row = screen.getByText("V. An").closest("tr") as HTMLElement;
    expect(within(row).getByText("90")).toBeInTheDocument();
    expect(within(row).getByText("82")).toBeInTheDocument();
    expect(within(row).getByRole("img")).toBeInTheDocument();
    const other = screen.getByText("T. Bình").closest("tr") as HTMLElement;
    expect(within(other).queryByRole("img")).toBeNull();
  });

  // Given a press refused with a 409 (today's session held, the cap, the day job, the lineup lock),
  // when the answer comes,
  // then the card's own sentence shows, its day from one, and the club is read again once.
  it.each([
    ["be.error.training.sessionToday", {}, "be.error.training.sessionToday"],
    ["be.error.training.sessionCap", { nextAllowedDay: 6 }, "be.error.training.sessionCap:7"],
    ["be.error.training.dayPending", {}, "be.error.training.dayPending"],
    [
      "be.error.club.lineupLocked",
      { kickoffAt: FIXTURE.kickoffAt },
      `online.training.today.lineupLocked:${formatKickoffClock(FIXTURE.kickoffAt, Date.now(), "en")}`,
    ],
  ])("shows a 409 %s and reads the club again", async (code, params, text) => {
    stage(clubWith(), {
      "POST v1/clubs/mine/training/sessions": fail(409, code, { details: { params } }),
      "GET v1/clubs/mine": ok(clubWith({ canTrain: false, refusal: code, ...params })),
    });
    render(<CardFromStore />);
    fireEvent.click(screen.getByRole("button", { name: "online.training.today.press" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    await waitFor(() => expect(clubReads()).toHaveLength(1));
  });

  // Given a press that got no answer (status 0),
  // when the coach presses again,
  // then the second press carries the same key, and the server's answer shows.
  it("presses again with the same key after no answer", async () => {
    let calls = 0;
    stage(clubWith(), {
      "POST v1/clubs/mine/training/sessions": () => {
        calls += 1;
        // A request that timed out: no answer, the server may have held it.
        return calls === 1 ? fail(0, "be.error.online.timeout") : ok(session());
      },
    });
    render(<CardFromStore />);
    const press = screen.getByRole("button", { name: "online.training.today.press" });
    fireEvent.click(press);
    await screen.findByRole("alert");
    await waitFor(() => expect(press).toBeEnabled());
    fireEvent.click(press);
    await screen.findByText("online.training.today.summary:3|2|1");
    const [first, second] = presses();
    expect(second?.idempotencyKey).toBe(first?.idempotencyKey);
  });

  // Given the cap reached, the next allowed day 7 by the server,
  // when the card shows,
  // then the button is off and the reason says day 8.
  it("turns the button off at the cap, with the next day from one", () => {
    stage(
      clubWith({ canTrain: false, refusal: "be.error.training.sessionCap", nextAllowedDay: 7 }),
    );
    render(<CardFromStore />);
    expect(screen.getByRole("button", { name: "online.training.today.press" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("be.error.training.sessionCap:8");
  });

  // Given a club that trained before its coach took over,
  // when the card shows,
  // then it says so, in words, not as a code.
  it("says the club trained before its coach took over", () => {
    stage(clubWith({ today: "bot", canTrain: false, refusal: "be.error.training.sessionToday" }));
    render(<CardFromStore />);
    expect(screen.getByRole("status")).toHaveTextContent("online.training.today.statusBot");
  });

  // Given a match today not yet kicked off, and one tomorrow,
  // when the card shows,
  // then the warning about training before the match shows for today's only.
  it("warns of a match today before kick-off", () => {
    const nextDayAt = new Date(Date.now() + 10 * HOUR).toISOString();
    useOnlineStore.setState({ season: { ...SEASON, weekday: 0, nextDayAt } });
    const kickoffAt = new Date(Date.now() + 5 * HOUR).toISOString();
    stage(clubWith({}, { nextFixture: { ...FIXTURE, kickoffAt } }));
    const { unmount } = render(<CardFromStore />);
    expect(screen.getByRole("note")).toHaveTextContent(
      `online.training.today.matchToday:${formatKickoffClock(kickoffAt, Date.now(), "en")}`,
    );
    unmount();
    const tomorrow = new Date(Date.now() + 15 * HOUR).toISOString();
    stage(clubWith({}, { nextFixture: { ...FIXTURE, kickoffAt: tomorrow } }));
    render(<CardFromStore />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  // Given the balanced schedule, on a Wednesday (a rest day of it) and on a Monday,
  // when the card shows,
  // then the rest-day note shows on Wednesday only.
  it("notes a rest day of the schedule", () => {
    useOnlineStore.setState({ season: { ...SEASON, weekday: 2 } });
    stage(clubWith());
    const { unmount } = render(<CardFromStore />);
    expect(screen.getByText("online.training.today.scheduledRest:6")).toBeInTheDocument();
    unmount();
    useOnlineStore.setState({ season: { ...SEASON, weekday: 0 } });
    render(<CardFromStore />);
    expect(screen.queryByText("online.training.today.scheduledRest:6")).toBeNull();
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
});

describe("today's day job not run yet", () => {
  // Given the day job pending, and the server still pending,
  // when time passes,
  // then the club is read every 5 s for 2 minutes, then every 30 s with a reload button for 10
  // more, then no more; the reload reads it once.
  it("reads the club again, slower after two minutes, then only on reload", async () => {
    vi.useFakeTimers();
    const pending = clubWith({ canTrain: false, refusal: "be.error.training.dayPending" });
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
    expect(screen.getByRole("button", { name: "online.training.today.press" })).toBeEnabled();
  });
});
