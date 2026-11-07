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
    keeperDrill: false,
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
const pressButton = () => screen.getByRole("button", { name: "online.training.extra.pressShort" });
/** Opens the extra training panel from today's card. */
const openExtra = () =>
  fireEvent.click(screen.getByRole("button", { name: "online.training.extra.open" }));
const KICKER = "online.training.today.kicker:4|28 · training.days.mon";
/** The result card the panel folds open after a press. */
const resultCard = () => screen.findByRole("region", { name: "online.training.phone.resultTitle" });

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
    expect(screen.getByText(KICKER)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Technical\.label/ }));
    const saves = () => server.requests.filter((r) => r.method === "PUT");
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0]?.body).toMatchObject({ focus: "Technical", auto: true });
  });
});

describe("today's session", () => {
  // Given day 3 of the season, two sessions in seven days and rows for days 0 and 2,
  // when the card shows,
  // then it says day 4 of 28 and Monday, 2 of 6 sessions, and a strip of days 1 to 3 with day 2
  // empty, then today; the old "train now" button is gone (C12-1).
  it("shows the day from one, the cap and the strip with an empty day", () => {
    stage(clubWith());
    render(<CardFromStore />);
    expect(screen.getByText(KICKER)).toBeInTheDocument();
    expect(screen.getByText("online.training.today.sessions:2|6")).toBeInTheDocument();
    const strip = screen
      .getAllByRole("listitem")
      .filter((item) => item.getAttribute("aria-label")?.includes("dayCell"));
    expect(strip.map((cell) => cell.getAttribute("aria-label"))).toEqual([
      "online.training.today.dayCell:1: online.training.today.kind.bot",
      "online.training.today.dayCell:2: online.training.today.kind.none",
      "online.training.today.dayCell:3: online.training.today.kind.manual",
      "online.training.today.dayCell:4: online.training.today.kind.today",
    ]);
    expect(strip[3]).toHaveAttribute("aria-current", "date");
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
  // when the coach opens the notes,
  // then the day-turn note names that moment on this machine's clock, not a fixed 04:00.
  it("names the day's turn from the season", () => {
    const nextDayAt = "2099-01-01T21:00:00Z";
    useOnlineStore.setState({ season: { ...SEASON, weekday: 0, nextDayAt } });
    stage(clubWith());
    render(<CardFromStore />);
    const toggle = screen.getByRole("button", { name: "online.training.today.notesToggle" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("online.training.today.noteFatigue")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
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

  // Given a balanced plan (Physical, Medium) on a Monday, a training day,
  // when the card shows,
  // then the main session reads the plan's schedule, focus and intensity and says it runs when the
  // day turns; it offers no button to hold it (C12-1).
  it("reads the main session from the plan, with nothing to press", () => {
    stage(clubWith());
    render(<CardFromStore />);
    const main = screen.getByRole("region", { name: "online.training.main.title" });
    expect(within(main).getByText("training.schedules.Balanced.label")).toBeInTheDocument();
    expect(within(main).getByText("training.focuses.Physical.label")).toBeInTheDocument();
    expect(within(main).getByText("training.intensities.Medium.label")).toBeInTheDocument();
    expect(within(main).getByText(/^online\.training\.main\.auto:/)).toBeInTheDocument();
    expect(within(main).queryByRole("button")).toBeNull();
    expect(
      screen.getByText("online.training.today.scheduleDay:training.schedules.Balanced.label"),
    ).toBeInTheDocument();
  });

  // Given a season whose ruleset has the goalkeepers' drill (`keeperDrill` true, E5-6c E56c-14),
  // when the card shows,
  // then the main session says goalkeepers always train their own drill.
  it("says goalkeepers train their own drill when the season has it", () => {
    stage(clubWith({ keeperDrill: true }));
    render(<CardFromStore />);
    const main = screen.getByRole("region", { name: "online.training.main.title" });
    expect(within(main).getByText("online.training.main.keeperDrill")).toBeInTheDocument();
  });

  // Given a season without the goalkeepers' drill (`keeperDrill` false),
  // when the card shows,
  // then nothing is said about goalkeepers, on a training day or a rest day.
  it("says nothing of goalkeepers when the season has no drill for them", () => {
    stage(clubWith({ keeperDrill: false }));
    const { unmount } = render(<CardFromStore />);
    expect(screen.queryByText("online.training.main.keeperDrill")).toBeNull();
    unmount();
    useOnlineStore.setState({ season: { ...SEASON, weekday: 2 } });
    render(<CardFromStore />);
    expect(screen.getByText("online.training.main.rest")).toBeInTheDocument();
    expect(screen.queryByText("online.training.main.keeperDrill")).toBeNull();
  });

  // Given the balanced plan on a Wednesday, a rest day on its schedule,
  // when the card shows,
  // then it says today rests and the main session says there is none.
  it("says when today rests on the schedule", () => {
    useOnlineStore.setState({ season: { ...SEASON, weekday: 2 } });
    stage(clubWith());
    render(<CardFromStore />);
    expect(
      screen.getByText("online.training.today.scheduleRest:training.schedules.Balanced.label"),
    ).toBeInTheDocument();
    expect(screen.getByText("online.training.main.rest")).toBeInTheDocument();
  });

  // Given a match later today, before the day turns,
  // when the card shows,
  // then a note says so with its kick-off; with no match today there is none.
  it("notes today's match", () => {
    const nextDayAt = new Date(Date.now() + 10 * HOUR).toISOString();
    useOnlineStore.setState({ season: { ...SEASON, weekday: 0, nextDayAt } });
    const kickoffAt = new Date(Date.now() + 5 * HOUR).toISOString();
    stage(clubWith({}, { nextFixture: { ...FIXTURE, kickoffAt } }));
    const { unmount } = render(<CardFromStore />);
    expect(screen.getByRole("note")).toHaveTextContent(
      `online.training.today.matchToday:${formatKickoffClock(kickoffAt, Date.now(), "en")}`,
    );
    unmount();
    stage(clubWith());
    render(<CardFromStore />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  // Given three extra sessions held today,
  // when the coach opens the extra panel, then presses Escape,
  // then the card counts the three, the panel opens as a dialog holding the focus, and closes.
  it("opens the extra panel and closes it on Escape", () => {
    stage(clubWith({ extra: extraDay({ today: 3 }) }, { players: SQUAD }));
    render(<CardFromStore />);
    expect(screen.getByText("online.training.extra.entryToday:3")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    openExtra();
    const panel = screen.getByRole("dialog", { name: "online.training.extra.title" });
    expect(panel).toHaveAttribute("aria-modal", "true");
    expect(panel).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
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
    openExtra();
    expect(
      screen.getByRole("radio", {
        name: "online.training.extra.intensityCost:training.intensities.Low.label|3",
      }),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("online.training.phone.footer:2|1")).toBeInTheDocument();
    expect(
      screen.getByText("training.intensities.Low.label · online.training.extra.costPer:3"),
    ).toBeInTheDocument();
    const press = pressButton();
    fireEvent.click(press);
    expect(press).toBeDisabled();
    await resultCard();
    expect(presses()[0]?.body).toEqual({ intensity: "Low", players: ["p1", "p2"], sessions: 1 });
    expect(presses()[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(clubReads()).toHaveLength(1));
  });

  // Given a coach who picks three sessions and keeps 60 or above,
  // when he presses and the answer comes,
  // then sessions and keepAbove go out; the result counts 4 attributes by 1 of 2 players over
  // 3 sessions, the one who rose reads "+4", and the one who did not is listed as not yet.
  it("sends the batch and shows what each player gained", async () => {
    stage(clubWith({}, { players: SQUAD }), { [`POST ${PRESS_PATH}`]: ok(answer()) });
    render(<CardFromStore />);
    openExtra();
    fireEvent.click(screen.getByRole("radio", { name: "3" }));
    fireEvent.click(screen.getByRole("switch", { name: "online.training.extra.keepAboveOn" }));
    for (let step = 0; step < 4; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: "online.training.extra.keepMore" }));
    }
    expect(screen.getByLabelText("online.training.extra.keepAbove")).toHaveTextContent("60");
    fireEvent.click(pressButton());
    const card = await resultCard();
    expect(presses()[0]?.body).toEqual({
      intensity: "Low",
      players: ["p1", "p2"],
      sessions: 3,
      keepAbove: 60,
    });
    expect(within(card).getByRole("status")).toHaveTextContent("+4");
    expect(within(card).getByRole("status")).toHaveTextContent("1/2");
    const risen = within(card).getByRole("list", { name: "online.training.phone.risenList" });
    expect(within(risen).getByText("V. An")).toBeInTheDocument();
    expect(within(risen).getByText("online.training.extra.gainsCount:4")).toBeInTheDocument();
    expect(within(card).getByText("online.training.phone.notYet (1):")).toBeInTheDocument();
    expect(within(card).getByText("T. Bình")).toBeInTheDocument();
  });

  // Given a press that answered,
  // when the coach closes the panel and opens it again,
  // then the card and the panel both say what the last press gave, and the panel's line folds
  // the result open.
  it("keeps the last result while the page stays open", async () => {
    stage(clubWith({}, { players: SQUAD }), { [`POST ${PRESS_PATH}`]: ok(answer()) });
    render(<CardFromStore />);
    openExtra();
    fireEvent.click(pressButton());
    await resultCard();
    fireEvent.click(screen.getByRole("button", { name: "common.close" }));

    expect(screen.getByText(/^online\.training\.phone\.entryLast:4\|/)).toBeInTheDocument();
    openExtra();
    const chip = screen.getByRole("button", { name: /online\.training\.phone\.lastGains:1\|4/ });
    expect(chip).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(chip);
    expect(await resultCard()).toBeInTheDocument();
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
    openExtra();
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
    openExtra();
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
    openExtra();
    expect(pressButton()).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("be.error.training.manualOff");
  });

  // Given a player the server says would sit out (tired),
  // when the coach looks at those who rest this session,
  // then his row says why in full, with his condition and the season's floor.
  it("shows why a player would sit out", () => {
    stage(
      clubWith(
        { extra: extraDay({ sitOut: [{ playerId: "p2", reason: "tired" }] }) },
        { players: SQUAD },
      ),
    );
    render(<CardFromStore />);
    openExtra();
    expect(screen.getByRole("tab", { name: "online.training.phone.listReady:1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("tab", { name: "online.training.phone.listRest:1" }));
    expect(
      screen.getByText(/^online\.training\.phone\.why\.tired:T\. Bình\|60\|40/),
    ).toBeInTheDocument();
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
    openExtra();
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
    openExtra();
    fireEvent.click(pressButton());
    await screen.findByRole("alert");
    await waitFor(() => expect(pressButton()).toBeEnabled());
    fireEvent.click(pressButton());
    await resultCard();
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
    openExtra();
    const panel = screen.getByRole("dialog");
    expect(screen.queryByText(/online\.training\.extra\.xiWarning/)).toBeNull();
    fireEvent.click(
      screen.getByRole("radio", {
        name: "online.training.extra.intensityCost:training.intensities.High.label|10",
      }),
    );
    expect(within(panel).getByRole("note")).toHaveTextContent(
      "online.training.extra.xiWarning:V. An|75",
    );
    expect(pressButton()).toBeEnabled();
  });

  // Given today's gift of drinks waiting (C-12 C12-8),
  // when the extra block shows,
  // then the gift's button is there to claim, as on the inventory page.
  it("offers today's gift in the extra block", () => {
    stage(clubWith({}, { players: SQUAD }));
    useOnlineStore.setState({
      items: {
        lines: [],
        locked: false,
        dailyGift: {
          steps: [
            {
              reward: { kind: "item", item: "energyDrinkSmall", quantity: 1 },
              state: "ready",
            },
          ],
          next: 0,
          available: true,
          gapSeconds: 7_200,
        },
      },
    });
    render(<CardFromStore />);
    expect(screen.getByText(/online\.training\.extra\.entryGiftReady/)).toBeInTheDocument();
    openExtra();
    expect(
      screen.getByRole("button", { name: /^online\.items\.dailyGift\.claimReward:/ }),
    ).toBeInTheDocument();
  });

  // Given a chosen player the server finds on a focus that lifts nothing (E5-4 R12-F, S-31b),
  // when the block shows,
  // then it warns that a session only costs him condition, and names the focus to switch to.
  it("warns when a player's focus lifts nothing", () => {
    stage(
      clubWith(
        {},
        {
          players: [
            squadPlayer({
              id: "p1",
              matchName: "V. An",
              trainingFocus: "Attacking",
              focusFit: { current: "Attacking", best: "Tactical", verdict: "nothing" },
            }),
          ],
        },
      ),
    );
    render(<CardFromStore />);
    openExtra();
    expect(screen.getByRole("note")).toHaveTextContent(
      "online.training.extra.focusFull:V. An → training.focuses.Tactical.label",
    );
  });

  // Given a chosen player whose focus is fair,
  // when the block shows,
  // then it gives no focus warning.
  it("does not warn when a player's focus still lifts him", () => {
    stage(
      clubWith(
        {},
        {
          players: [
            squadPlayer({
              id: "p1",
              matchName: "V. An",
              focusFit: { current: "Technical", best: "Tactical", verdict: "fair" },
            }),
          ],
        },
      ),
    );
    render(<CardFromStore />);
    openExtra();
    expect(screen.queryByRole("note")).toBeNull();
  });
  // Given a season with the keepers' drill and the starting keeper under the floor (E5-6d C),
  // when the coach opens extra training,
  // then a note names the keeper, and the others can still train.
  it("warns when a keeper is too tired for the session and the drill", () => {
    const keeper = squadPlayer({
      id: "gk",
      matchName: "C. Thụ",
      position: "Goalkeeper",
      naturalPosition: "Goalkeeper",
      condition: 35,
    });
    stage(
      clubWith(
        { keeperDrill: true, extra: extraDay({ sitOut: [{ playerId: "gk", reason: "tired" }] }) },
        { players: [...SQUAD, keeper] },
      ),
    );
    render(<CardFromStore />);
    openExtra();
    const panel = screen.getByRole("dialog");
    expect(within(panel).getByRole("note")).toHaveTextContent(
      "online.training.extra.keeperTired:C. Thụ|40",
    );
    expect(pressButton()).toBeEnabled();
  });

  // Given the same tired keeper in a season without the keepers' drill,
  // when the coach opens extra training,
  // then no keeper note: there is no drill to miss.
  it("does not warn of a tired keeper in a season without the drill", () => {
    const keeper = squadPlayer({
      id: "gk",
      matchName: "C. Thụ",
      position: "Goalkeeper",
      naturalPosition: "Goalkeeper",
      condition: 35,
    });
    stage(
      clubWith(
        { keeperDrill: false, extra: extraDay({ sitOut: [{ playerId: "gk", reason: "tired" }] }) },
        { players: [...SQUAD, keeper] },
      ),
    );
    render(<CardFromStore />);
    openExtra();
    expect(screen.queryByText(/online\.training\.extra\.keeperTired/)).toBeNull();
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

describe("energy drinks in the extra panel", () => {
  const DRINK = "online.training.extra.drink";
  const tired = [SQUAD[0], { ...SQUAD[1], condition: 35 }];

  function withDrinks() {
    stage(
      clubWith(
        { extra: extraDay({ sitOut: [{ playerId: "p2", reason: "tired" }] }) },
        {
          players: tired,
        },
      ),
      {
        "GET v1/shop": ok({ priceListVersion: 3, items: [] }),
        "GET v1/me/items/energyDrinkSmall/preview": ok({
          effect: { kind: "condition", players: [{ playerId: "p2", before: 35, after: 50 }] },
          limits: { pointsToday: 0, pointsPerDay: 35 },
        }),
        "POST v1/me/items/energyDrinkSmall/use": ok({
          itemCode: "energyDrinkSmall",
          target: { kind: "player", playerId: "p2" },
          effect: { kind: "condition", players: [{ playerId: "p2", before: 35, after: 50 }] },
          held: [{ quantity: 1 }],
        }),
      },
    );
    useOnlineStore.setState({
      items: {
        lines: [
          { itemCode: "energyDrinkSmall", powerClass: "c", total: 2, stacks: [{ quantity: 2 }] },
        ],
        locked: false,
        limits: {
          teamRecovery: { usedToday: 0, perDay: 1, nextAt: "2099-01-02T00:00:00Z" },
          notes: [],
          xpX2: { remaining: 0, max: 10 },
        },
      },
    });
    render(<CardFromStore />);
    openExtra();
    fireEvent.click(screen.getByRole("tab", { name: /^online\.training\.phone\.listRest/ }));
    fireEvent.click(screen.getByRole("button", { name: `${DRINK}.open:T. Bình` }));
  }

  // Given a tired player in the extra panel and two small drinks,
  // when the coach opens his drinks and presses Escape,
  // then the drinks close and the panel stays open.
  it("closes a player's drinks on Escape and keeps the panel", () => {
    withDrinks();
    expect(screen.getByRole("dialog", { name: `${DRINK}.title` })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: `${DRINK}.title` })).toBeNull();
    expect(screen.getByRole("dialog", { name: "online.training.extra.title" })).toBeInTheDocument();
  });

  // Given a tired player in the extra panel and two small drinks,
  // when the coach opens his drinks and taps the small one,
  // then it is used on him at once and the panel says so.
  it("uses a drink on a player in one tap", async () => {
    withDrinks();
    const small = await screen.findByRole("button", {
      name: /online\.items\.energyDrinkSmall.*online\.items\.quick\.change:35\|50/,
    });
    await waitFor(() => expect(small).toBeEnabled());
    fireEvent.click(small);

    await waitFor(() =>
      expect(
        server.requests.filter((r) => r.segments.join("/") === "v1/me/items/energyDrinkSmall/use"),
      ).toHaveLength(1),
    );
    expect(await screen.findByText(/^online\.items\.used/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: `${DRINK}.title` })).toBeNull();
  });
});

describe("drinks for all the tired players in the extra panel", () => {
  const BATCH = "online.training.extra.batch";

  // Given a tired player in the extra panel, two small drinks and a preview lifting him,
  // when the coach opens the resting list and taps the batch button,
  // then its summary opens over the panel with what he gets, and Escape closes only it.
  it("opens the batch summary over the panel and closes it on Escape", async () => {
    stage(
      clubWith(
        { extra: extraDay({ sitOut: [{ playerId: "p2", reason: "tired" }] }) },
        { players: [SQUAD[0], { ...SQUAD[1], condition: 35 }] },
      ),
      {
        "GET v1/shop": ok({ priceListVersion: 3, items: [] }),
        "POST v1/clubs/mine/training/extra/drinks/preview": ok({
          lines: [{ playerId: "p2", items: ["energyDrinkSmall"], before: 35, after: 50 }],
          skipped: [],
          used: { energyDrinkSmall: 1 },
          held: { energyDrinkSmall: 1, energyDrinkLarge: 0 },
          trainingDay: clubWith({}).trainingDay,
        }),
      },
    );
    useOnlineStore.setState({
      items: {
        lines: [
          { itemCode: "energyDrinkSmall", powerClass: "c", total: 2, stacks: [{ quantity: 2 }] },
        ],
        locked: false,
        limits: {
          teamRecovery: { usedToday: 0, perDay: 1, nextAt: "2099-01-02T00:00:00Z" },
          notes: [],
          xpX2: { remaining: 0, max: 10 },
        },
      },
    });
    render(<CardFromStore />);
    openExtra();
    fireEvent.click(screen.getByRole("tab", { name: /^online\.training\.phone\.listRest/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: `${BATCH}.button:1|${BATCH}.small:1` }),
    );

    const summary = screen.getByRole("dialog", { name: `${BATCH}.title` });
    expect(within(summary).getByText("online.items.quick.change:35|50")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: `${BATCH}.title` })).toBeNull();
    expect(screen.getByRole("dialog", { name: "online.training.extra.title" })).toBeInTheDocument();
  });
});
