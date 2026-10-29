import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventView, EventsView, MissionView } from "../../api";
import type { OnlineRequest } from "../../../services/onlineTransport";
import { fakeRealtime } from "../../../test-utils/onlineMatchKit";
import {
  type Answer,
  fail,
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
} from "../../../test-utils/onlineTestKit";
import { useOnlineStore } from "../../store/onlineStore";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === "object"
        ? `${key}:${Object.values(options as Record<string, unknown>).join("|")}`
        : key,
    i18n: { language: "en" },
  }),
}));

vi.mock("../../../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) =>
    `resolved:${error instanceof Error ? error.message : String(error)}`,
}));

const ACCOUNT = "account-1";
const EVENT = "01a18545-d15e-763c-8b48-934eb05a4757";
const FAR = "2099-01-01T00:00:00Z";
const PAST = "2000-01-01T00:00:00Z";

function mission(overrides: Partial<MissionView> = {}): MissionView {
  return {
    code: "w1",
    kind: "leagueMatchesDirected",
    target: 5,
    progress: 0,
    status: "active",
    rewards: [{ item: "scoutExpedition", quantity: 1 }],
    countsOffline: false,
    ...overrides,
  };
}

function event(overrides: Partial<EventView> = {}): EventView {
  return {
    id: EVENT,
    theme: "weekly",
    startsAt: PAST,
    endsAt: FAR,
    claimUntil: FAR,
    state: "running",
    missions: [mission()],
    ...overrides,
  };
}

const view = (events: EventView[], enabled = true): EventsView => ({ enabled, events });

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

function serve(more: Record<string, Answer | ((request: OnlineRequest) => Answer)> = {}) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/me": ok({ id: ACCOUNT }),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/market": ok({ selling: [], holding: [], recent: [] }),
    "GET v1/me/coins": ok({ balance: 0, blocked: false, exchangedToday: 0 }),
    "GET v1/me/items": ok({ lines: [], locked: false }),
    "GET v1/me/events": ok(view([event()])),
    ...more,
  });
}

const sent = (method: string, path: string) =>
  server.requests.filter(
    (request) => request.method === method && request.segments.join("/") === path,
  );

const claimPath = (code: string) => `v1/me/events/${EVENT}/missions/${code}/claim`;

/** The claim button of a mission, by the mission's sentence. */
const claimButton = (sentence: string) =>
  screen.findByRole("button", { name: `online.events.claimAria:${sentence}` });

const textOf = (element: HTMLElement) => element.textContent;

/** An event panel's name: its heading, which names the article. */
const nameOf = (article: HTMLElement) =>
  document.getElementById(article.getAttribute("aria-labelledby") ?? "")?.textContent;

beforeEach(() => {
  resetOnline();
  realtime = fakeRealtime();
});
afterEach(() => {
  server?.restore();
  realtime.restore();
});

/** The missions section of the only event on the page. */
const missionsOf = () => screen.getByRole("region", { name: "online.events.missions" });

/** The card of a mission, by its sentence. */
const cardOf = (sentence: string) => {
  const card = within(missionsOf()).getByText(sentence).closest("li");
  if (!card) throw new Error(`no card for ${sentence}`);
  return card as HTMLElement;
};

describe("the events page", () => {
  // Given a server older than the events (it answers 404),
  // when the page opens,
  // then it says events are not open there, with no error.
  it("says events are not open on an older server", async () => {
    serve({ "GET v1/me/events": fail(404, "be.error.notFound") });
    renderOnline("/online/events");

    expect(await screen.findByText("online.events.notOnServer")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // Given a season without events, then one with events but none to show,
  // when the page opens,
  // then each says so in its own words.
  it("tells a season without events from one with none yet", async () => {
    serve({ "GET v1/me/events": ok(view([], false)) });
    renderOnline("/online/events");
    expect(await screen.findByText("online.events.disabled")).toBeTruthy();
    cleanup();
    server.restore();
    resetOnline();

    serve({ "GET v1/me/events": ok(view([])) });
    renderOnline("/online/events");
    expect(await screen.findByText("online.events.empty")).toBeTruthy();
  });

  // Given events in every state, one in a state this build does not know,
  // when the page opens,
  // then the running and the ended events show in full, in that order, and the coming-up and
  // closed ones (the unknown one closed) are folded in their groups until opened.
  it("opens what runs and takes claims, and folds the rest", async () => {
    serve({
      "GET v1/me/events": ok(
        view([
          event({ id: "c", theme: "seasonFinale", state: "closed" }),
          event({ id: "s", theme: "weekend", state: "scheduled", startsAt: FAR }),
          event({ id: "x", theme: "welcome", state: "paused" }),
          event({ id: "e", theme: "seasonOpener", state: "ended" }),
          event({ id: "r", theme: "weekly", state: "running" }),
        ]),
      ),
    });
    renderOnline("/online/events");

    await screen.findByRole("article", { name: "online.events.theme.weekly" });
    expect(screen.getAllByRole("article").map(nameOf)).toEqual([
      "online.events.theme.weekly",
      "online.events.theme.seasonOpener",
    ]);
    expect(screen.getByText("online.events.state.running")).toBeTruthy();
    expect(screen.getByText("online.events.state.ended")).toBeTruthy();
    const groups = screen
      .getAllByRole("button", { name: /^online\.events\.group\./ })
      .map((button) => button.textContent);
    expect(groups).toEqual(["online.events.group.scheduled(1)", "online.events.group.closed(2)"]);
    expect(screen.queryByRole("article", { name: "online.events.theme.weekend" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^online\.events\.group\.closed/ }));
    expect(screen.getByRole("article", { name: "online.events.theme.welcome" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "online.events.theme.seasonFinale" })).toBeTruthy();
  });

  // Given only running events, the later-ending one first, one with a theme this build does
  // not know,
  // when the page opens,
  // then no group shows, the sooner-ending event is first, and the unknown theme reads "Event"
  // with the plain line under it.
  it("orders running events by their end and names an unknown theme", async () => {
    serve({
      "GET v1/me/events": ok(
        view([
          event({ id: "late", theme: "weekly", endsAt: "2099-02-01T00:00:00Z" }),
          event({ id: "soon", theme: "carnival", endsAt: "2099-01-01T00:00:00Z" }),
        ]),
      ),
    });
    renderOnline("/online/events");

    await screen.findByRole("article", { name: "online.events.theme.weekly" });
    expect(screen.queryByRole("button", { name: /^online\.events\.group\./ })).toBeNull();
    expect(screen.getAllByRole("article").map(nameOf)).toEqual([
      "online.events.theme.other",
      "online.events.theme.weekly",
    ]);
    expect(screen.getByText("online.events.tagline.other")).toBeTruthy();
  });

  // Given a running event that ends in 2 days, 3 hours, 4 minutes and 5 seconds,
  // when the page shows it,
  // then the timer says the time left as a sentence and in boxes of days, hours, minutes and
  // seconds.
  it("counts down to the end in boxes", async () => {
    const endsAt = new Date(Date.now() + ((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000).toISOString();
    serve({ "GET v1/me/events": ok(view([event({ endsAt })])) });
    renderOnline("/online/events");

    const timer = await screen.findByRole("timer");
    expect(timer.getAttribute("aria-label")).toMatch(
      /^online\.events\.time\.running:online\.countdown\.withDays:2\|03:04:0[45]$/,
    );
    expect(within(timer).getByText("online.events.timer.running")).toBeTruthy();
    expect(within(timer).getByText("2")).toBeTruthy();
    expect(within(timer).getByText("03")).toBeTruthy();
    expect(within(timer).getByText("04")).toBeTruthy();
    expect(within(timer).getByText("online.events.unit.seconds")).toBeTruthy();
  });

  // Given an event whose countdown has run out on this machine, and one whose has not,
  // when the page has been open past a tick of the clock,
  // then the run-out one read the events again once, the other not at all.
  it("reads the events again once when a countdown runs out", async () => {
    serve();
    renderOnline("/online/events");
    await screen.findByRole("article");
    await act(() => new Promise((resolve) => setTimeout(resolve, 1200)));
    const steady = sent("GET", "v1/me/events").length;
    cleanup();
    server.restore();
    resetOnline();

    serve({ "GET v1/me/events": ok(view([event({ endsAt: PAST })])) });
    renderOnline("/online/events");
    await screen.findByRole("article");
    await act(() => new Promise((resolve) => setTimeout(resolve, 1200)));
    expect(sent("GET", "v1/me/events").length).toBe(steady + 1);
  });
});

describe("the journey", () => {
  // Given a running event with a mission claimed, one waiting and one under way at 2 of 5,
  // when the page shows it,
  // then the journey counts 2 of 3 met, 1 claimed and 1 waiting, and each node says where its
  // mission stands under its first reward, in the server's order.
  it("counts the missions and says where each stands", async () => {
    serve({
      "GET v1/me/events": ok(
        view([
          event({
            missions: [
              mission({ code: "a", status: "claimed", progress: 5 }),
              mission({ code: "b", status: "completed", progress: 5 }),
              mission({ code: "c", progress: 2, rewards: [{ coin: 20, quantity: 1 }] }),
            ],
          }),
        ]),
      ),
    });
    renderOnline("/online/events");

    const journey = await screen.findByRole("list", { name: "online.events.journey.title" });
    expect(screen.getByText("· online.events.journey.met:2|3")).toBeTruthy();
    expect(screen.getByText("online.events.journey.counts:1|1")).toBeTruthy();
    const nodes = within(journey).getAllByRole("listitem");
    expect(nodes.map((node) => node.textContent)).toEqual([
      "online.items.scoutExpedition.name:scoutExpeditiononline.events.claimed",
      "online.items.scoutExpedition.name:scoutExpeditiononline.events.journey.ready",
      "online.shop.coinsAmount:202/5",
    ]);
  });

  // Given an event coming up,
  // when its group is opened,
  // then it has no journey.
  it("shows no journey before the event starts", async () => {
    serve({ "GET v1/me/events": ok(view([event({ state: "scheduled", startsAt: FAR })])) });
    renderOnline("/online/events");
    fireEvent.click(
      await screen.findByRole("button", { name: /^online\.events\.group\.scheduled/ }),
    );

    expect(screen.getByRole("article", { name: "online.events.theme.weekly" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "online.events.journey.title" })).toBeNull();
  });
});

describe("a mission", () => {
  // Given counted missions, season-end ones and one of a kind this build does not know,
  // when the page shows them,
  // then counted ones show progress over target, the directed line is said once above the
  // cards, the offline one's line is behind "see conditions", the season-end top-4 at rank
  // progress 1 is "not met" (never 1/4), its levels are said, and the unknown one is a special
  // mission.
  it("shows each kind's progress and lines", async () => {
    serve({
      "GET v1/me/events": ok(
        view([
          event({
            missions: [
              mission({ code: "w2", kind: "leagueWinsDirected", target: 3, progress: 2 }),
              mission({ code: "o1", kind: "offlineMatches", target: 150, countsOffline: true }),
              mission({
                code: "t4",
                kind: "seasonFinishTop",
                target: 4,
                progress: 1,
                levels: { from: 4, to: 1000 },
              }),
              mission({
                code: "p1",
                kind: "seasonPromoted",
                target: 1,
                status: "completed",
                levels: { from: 2, to: 2 },
              }),
              mission({ code: "z", kind: "dance", target: 1 }),
            ],
          }),
        ]),
      ),
    });
    renderOnline("/online/events");
    await screen.findByRole("region", { name: "online.events.missions" });
    const missions = missionsOf();

    const wins = within(cardOf("online.events.mission.leagueWinsDirected:3")).getByRole(
      "progressbar",
    );
    expect(wins.getAttribute("aria-valuenow")).toBe("2");
    expect(wins.getAttribute("aria-valuemax")).toBe("3");
    expect(within(missions).getByText("online.events.hint.directed")).toBeTruthy();

    const offline = cardOf("online.events.mission.offlineMatches:150");
    expect(within(offline).queryByText("online.events.hint.offline")).toBeNull();
    fireEvent.click(within(offline).getByRole("button", { name: "online.events.detail.show" }));
    expect(within(offline).getByText("online.events.hint.offline")).toBeTruthy();
    expect(within(offline).getByRole("button", { name: "online.events.detail.hide" })).toBeTruthy();

    const top = cardOf("online.events.mission.seasonFinishTop:4");
    expect(within(top).getByText("online.events.notMet")).toBeTruthy();
    expect(within(top).queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText("1/4")).toBeNull();
    expect(within(top).getByText("· online.events.levels.from:4")).toBeTruthy();
    const promoted = cardOf("online.events.mission.seasonPromoted:1");
    expect(within(promoted).getByText("online.events.met")).toBeTruthy();
    expect(within(promoted).getByText("· online.events.levels.one:2")).toBeTruthy();
    expect(within(missions).getByText("online.events.mission.other")).toBeTruthy();
  });

  // Given a claimed mission, one under way and one waiting, in that order, in a running event,
  // when the page shows them,
  // then the waiting claim comes first, then the one under way, then the claimed one.
  it("puts the claims waiting first", async () => {
    serve({
      "GET v1/me/events": ok(
        view([
          event({
            missions: [
              mission({ code: "a", kind: "leagueWinsDirected", target: 3, status: "claimed" }),
              mission({ code: "b", kind: "offlineMatches", target: 150 }),
              mission({ code: "c", target: 5, progress: 5, status: "completed" }),
            ],
          }),
        ]),
      ),
    });
    renderOnline("/online/events");
    await screen.findByRole("region", { name: "online.events.missions" });

    expect(within(missionsOf()).getAllByRole("heading", { level: 4 }).map(textOf)).toEqual([
      "online.events.mission.leagueMatchesDirected:5",
      "online.events.mission.offlineMatches:150",
      "online.events.mission.leagueWinsDirected:3",
    ]);
  });

  // Given a coach with a club and a directed and an offline mission under way,
  // when the page shows them,
  // then the directed one links to the fixtures and each says what is left, by its kind.
  it("shows the way to progress and what is left", async () => {
    serve({
      "GET v1/me/events": ok(
        view([
          event({
            missions: [
              mission({ code: "a", progress: 1 }),
              mission({ code: "b", kind: "offlineMatches", target: 150, progress: 10 }),
            ],
          }),
        ]),
      ),
    });
    renderOnline("/online/events");
    await screen.findByRole("region", { name: "online.events.missions" });

    const directed = cardOf("online.events.mission.leagueMatchesDirected:5");
    expect(
      within(directed).getByRole("link", { name: "online.events.goSchedule" }).getAttribute("href"),
    ).toBe("/online/schedule");
    expect(within(directed).getByText("online.events.left.leagueMatchesDirected:4")).toBeTruthy();
    const offline = cardOf("online.events.mission.offlineMatches:150");
    expect(within(offline).queryByRole("link")).toBeNull();
    expect(within(offline).getByText("online.events.left.offlineMatches:140")).toBeTruthy();
  });

  // Given a coach without a club and a directed mission under way,
  // when the page shows it,
  // then it has no link to fixtures the coach could not open.
  it("does not link to fixtures without a club", async () => {
    serve({ "GET v1/clubs/mine": fail(404, "be.error.notFound") });
    renderOnline("/online/events");
    await screen.findByRole("region", { name: "online.events.missions" });

    expect(screen.queryByRole("link", { name: "online.events.goSchedule" })).toBeNull();
    expect(screen.getByText("online.events.left.leagueMatchesDirected:5")).toBeTruthy();
  });

  // Given lapsed missions with and without a reason, one finished after the event closed, a
  // claimed one and one not finished,
  // when the page shows them,
  // then each reads its own status, and none has a claim button.
  it("reads each status", async () => {
    serve({
      "GET v1/me/events": ok(
        view([
          event({
            state: "closed",
            missions: [
              mission({ code: "a", status: "lapsed", lapsedReason: "stackFull" }),
              mission({ code: "b", status: "lapsed" }),
              mission({ code: "c", status: "completed" }),
              mission({ code: "d", status: "claimed" }),
              mission({ code: "e" }),
            ],
          }),
        ]),
      ),
    });
    renderOnline("/online/events");
    fireEvent.click(await screen.findByRole("button", { name: /^online\.events\.group\.closed/ }));
    const missions = missionsOf();

    expect(
      within(missions).getByText("online.events.lapsed:online.events.reason.stackFull"),
    ).toBeTruthy();
    expect(within(missions).getByText("online.events.lapsedUnknown")).toBeTruthy();
    expect(within(missions).getByText("online.events.autoClaiming")).toBeTruthy();
    // The claimed card's badge and its mark.
    expect(within(missions).getAllByText("online.events.claimed")).toHaveLength(2);
    expect(within(missions).getByText("online.events.status.missed")).toBeTruthy();
    expect(within(missions).getAllByText("online.events.status.lapsed")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /^online\.events\.claimAria/ })).toBeNull();
  });

  // Given an event coming up,
  // when its group is opened,
  // then its missions show their rewards but no progress and no claim.
  it("shows a coming event's missions without progress", async () => {
    serve({
      "GET v1/me/events": ok(view([event({ state: "scheduled", startsAt: FAR })])),
    });
    renderOnline("/online/events");
    fireEvent.click(
      await screen.findByRole("button", { name: /^online\.events\.group\.scheduled/ }),
    );
    const card = cardOf("online.events.mission.leagueMatchesDirected:5");

    expect(within(card).getByText("online.events.status.upcoming")).toBeTruthy();
    expect(
      within(card).getAllByText("online.items.scoutExpedition.name:scoutExpedition").length,
    ).toBeGreaterThan(0);
    expect(within(card).queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("button", { name: /^online\.events\.claimAria/ })).toBeNull();
  });
});

describe("a claim", () => {
  const finished = mission({
    status: "completed",
    progress: 5,
    rewards: [
      { item: "scoutExpedition", quantity: 2, expiresInDays: 60 },
      { coin: 20, quantity: 1 },
    ],
  });

  // Given a finished mission giving an item and coins,
  // when the coach claims it,
  // then it is claimed with a key, the items, coins and events are read again, a dialog says
  // what was given and where it went, its button closes it, and no notice is pushed.
  it("gives the rewards and reads them again", async () => {
    let claimed = false;
    serve({
      "GET v1/me/events": () =>
        ok(
          view([event({ missions: [{ ...finished, status: claimed ? "claimed" : "completed" }] })]),
        ),
      [`POST ${claimPath("w1")}`]: () => {
        claimed = true;
        return ok({ rewards: finished.rewards });
      },
    });
    renderOnline("/online/events");
    const button = await claimButton("online.events.mission.leagueMatchesDirected:5");
    await waitFor(() => expect(sent("GET", "v1/me/items").length).toBeGreaterThan(0));
    const items = sent("GET", "v1/me/items").length;
    const coins = sent("GET", "v1/me/coins").length;

    fireEvent.click(button);

    const dialog = await screen.findByRole("dialog", {
      name: "online.items.scoutExpedition.name:scoutExpedition ×2, online.shop.coinsAmount:20",
    });
    expect(within(dialog).getByText("online.events.reward.heading")).toBeTruthy();
    expect(dialog.textContent).toContain(
      "online.events.reward.toBoth online.events.reward.expires:60",
    );
    expect(sent("POST", claimPath("w1"))[0].idempotencyKey).toBeTruthy();
    await waitFor(() => expect(sent("GET", "v1/me/items").length).toBe(items + 1));
    expect(sent("GET", "v1/me/coins").length).toBe(coins + 1);
    expect(await within(missionsOf()).findAllByText("online.events.claimed")).toHaveLength(2);
    expect(useOnlineStore.getState().notices).toEqual([]);

    const close = within(dialog).getByRole("button", { name: "online.events.reward.close" });
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Given a claim of coins only, its dialog open,
  // when the coach presses Escape,
  // then the dialog said the coins went to the wallet, and it closes.
  it("closes the reward dialog on Escape", async () => {
    const coinsOnly = { ...finished, rewards: [{ coin: 20, quantity: 1 }] };
    serve({
      "GET v1/me/events": ok(view([event({ missions: [coinsOnly] })])),
      [`POST ${claimPath("w1")}`]: ok({ rewards: coinsOnly.rewards }),
    });
    renderOnline("/online/events");
    fireEvent.click(await claimButton("online.events.mission.leagueMatchesDirected:5"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("online.events.reward.toWallet")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Given a claim that got no answer,
  // when the coach presses again,
  // then the second claim carries the same key.
  it("keeps the key over a claim with no answer", async () => {
    let calls = 0;
    serve({
      "GET v1/me/events": ok(view([event({ missions: [finished] })])),
      [`POST ${claimPath("w1")}`]: () => {
        calls += 1;
        return calls === 1
          ? fail(0, "be.error.online.unreachable")
          : ok({ rewards: finished.rewards });
      },
    });
    renderOnline("/online/events");
    const button = await claimButton("online.events.mission.leagueMatchesDirected:5");

    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toBeTruthy();
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    await screen.findByRole("dialog");
    expect(screen.queryByRole("alert")).toBeNull();
    const [first, second] = sent("POST", claimPath("w1"));
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  // Given a mission another device claimed,
  // when the coach claims it here,
  // then the events are read again and no error or dialog is shown.
  it("catches up quietly when the reward was claimed elsewhere", async () => {
    serve({
      "GET v1/me/events": ok(view([event({ missions: [finished] })])),
      [`POST ${claimPath("w1")}`]: fail(409, "be.error.events.alreadyClaimed"),
    });
    renderOnline("/online/events");
    const button = await claimButton("online.events.mission.leagueMatchesDirected:5");
    await waitFor(() => expect(sent("GET", "v1/me/events").length).toBeGreaterThan(0));
    const reads = sent("GET", "v1/me/events").length;

    fireEvent.click(button);

    await waitFor(() => expect(sent("GET", "v1/me/events").length).toBe(reads + 1));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Given a season whose 30 event coins are all given,
  // when the coach claims, then claims again,
  // then the limit is said under the mission, the button stays, and the second claim is a new key.
  it("says the coin limit and lets the coach try again", async () => {
    serve({
      "GET v1/me/events": ok(view([event({ missions: [finished] })])),
      [`POST ${claimPath("w1")}`]: fail(409, "be.error.events.coinLimitReached", {
        details: { params: { limit: 30 } },
      }),
    });
    renderOnline("/online/events");
    const button = await claimButton("online.events.mission.leagueMatchesDirected:5");

    fireEvent.click(button);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "be.error.events.coinLimitReached:30",
    );
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    await waitFor(() => expect(sent("POST", claimPath("w1"))).toHaveLength(2));
    const [first, second] = sent("POST", claimPath("w1"));
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  // Given a claim made after the claims closed,
  // when the coach claims,
  // then the closed sentence is said and the events are read again.
  it("says a closed claim will be made for the coach", async () => {
    serve({
      "GET v1/me/events": ok(view([event({ state: "ended", missions: [finished] })])),
      [`POST ${claimPath("w1")}`]: fail(409, "be.error.events.closed"),
    });
    renderOnline("/online/events");
    const button = await claimButton("online.events.mission.leagueMatchesDirected:5");
    await waitFor(() => expect(sent("GET", "v1/me/events").length).toBeGreaterThan(0));
    const reads = sent("GET", "v1/me/events").length;

    fireEvent.click(button);

    expect((await screen.findByRole("alert")).textContent).toContain("be.error.events.closed");
    await waitFor(() => expect(sent("GET", "v1/me/events").length).toBe(reads + 1));
  });
});

describe("the events entry and rings", () => {
  // Given two missions waiting in a running event, one in an ended one and one in a closed one,
  // and a coach without a club,
  // when the online mode opens,
  // then the events entry shows (with no club) with a dot of 3, and its page opens.
  it("counts the claims waiting on the entry, with or without a club", async () => {
    const done = (code: string) => mission({ code, status: "completed" });
    serve({
      "GET v1/clubs/mine": fail(404, "be.error.notFound"),
      "GET v1/me/events": ok(
        view([
          event({ id: "r", missions: [done("a"), done("b"), mission({ code: "c" })] }),
          event({ id: "e", theme: "weekend", state: "ended", missions: [done("a")] }),
          event({ id: "c", theme: "seasonFinale", state: "closed", missions: [done("a")] }),
        ]),
      ),
    });
    renderOnline("/online/events");

    const entry = await screen.findByRole("button", { name: /online\.nav\.events/ });
    await waitFor(() => expect(entry.textContent).toContain("3"));
    expect(screen.getByRole("article", { name: "online.events.theme.weekly" })).toBeTruthy();
    expect(screen.getByLabelText("location").textContent).toBe("/online/events");
  });

  // Given a coach in the online mode with the events read,
  // when a progress ring comes, then a completed ring with a mission now finished, then an
  // event ring this build does not know,
  // then each reads the events again, and only the completed one pushes a notice naming the
  // mission and linking to the events page.
  it("reads the events again on a ring and tells of a mission finished", async () => {
    let done = false;
    serve({
      "GET v1/me/events": () =>
        ok(view([event({ missions: [mission({ status: done ? "completed" : "active" })] })])),
    });
    renderOnline("/online/events");
    await waitFor(() =>
      expect(realtime.watches.some((watch) => watch.channel === `account:${ACCOUNT}`)).toBe(true),
    );
    await screen.findByRole("article");
    const watch = realtime.watches.find((one) => one.channel === `account:${ACCOUNT}`);
    const ring = (data: object) =>
      act(() => watch?.speak({ kind: "notice", channel: `account:${ACCOUNT}`, data }));
    const reads = sent("GET", "v1/me/events").length;

    ring({ kind: "event", event: "progress", eventId: EVENT });
    await waitFor(() => expect(sent("GET", "v1/me/events").length).toBe(reads + 1));
    expect(useOnlineStore.getState().notices).toEqual([]);

    done = true;
    ring({ kind: "event", event: "completed", eventId: EVENT });
    await waitFor(() => expect(sent("GET", "v1/me/events").length).toBe(reads + 2));
    const region = screen.getByRole("region", { name: "online.market.notice.region" });
    const notice = await within(region).findByRole("link");
    expect(notice.textContent).toBe(
      "online.events.notice.completed:online.events.mission.leagueMatchesDirected:5",
    );
    expect(notice.getAttribute("href")).toBe("/online/events");

    ring({ kind: "event", event: "fireworks", eventId: EVENT });
    await waitFor(() => expect(sent("GET", "v1/me/events").length).toBe(reads + 3));
    expect(useOnlineStore.getState().notices).toHaveLength(1);
  });

  // Given a coach whose events were never read (the server could not answer them),
  // when a completed ring comes and the events can be read,
  // then one notice says a mission finished, without its name.
  it("tells of a mission finished without a name when nothing was read before", async () => {
    let reachable = false;
    serve({
      "GET v1/me/events": () =>
        reachable
          ? ok(view([event({ missions: [mission({ status: "completed" })] })]))
          : fail(500, "be.error.internal"),
    });
    renderOnline("/online/coins");
    await waitFor(() =>
      expect(realtime.watches.some((watch) => watch.channel === `account:${ACCOUNT}`)).toBe(true),
    );
    const watch = realtime.watches.find((one) => one.channel === `account:${ACCOUNT}`);
    expect(useOnlineStore.getState().events).toBeUndefined();

    reachable = true;
    act(() =>
      watch?.speak({
        kind: "notice",
        channel: `account:${ACCOUNT}`,
        data: { kind: "event", event: "completed", eventId: EVENT },
      }),
    );

    const region = screen.getByRole("region", { name: "online.market.notice.region" });
    expect((await within(region).findByRole("link")).textContent).toBe(
      "online.events.notice.completedUnnamed",
    );
  });
});
