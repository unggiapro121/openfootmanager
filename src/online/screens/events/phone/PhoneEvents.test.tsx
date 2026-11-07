import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventView, EventsView, MissionView } from "../../../api";
import { PHONE_QUERY } from "../../../../hooks/usePhoneLayout";
import { runBackAction } from "../../../../lib/backActions";
import type { OnlineRequest } from "../../../../services/onlineTransport";
import { fakeRealtime } from "../../../../test-utils/onlineMatchKit";
import {
  type Answer,
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
} from "../../../../test-utils/onlineTestKit";

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

const FAR = "2099-01-01T00:00:00Z";
const PAST = "2000-01-01T00:00:00Z";
const DIRECTED_5 = "online.events.mission.leagueMatchesDirected:5";

function mission(overrides: Partial<MissionView> = {}): MissionView {
  return {
    code: "w1",
    kind: "leagueMatchesDirected",
    target: 5,
    progress: 2,
    status: "active",
    rewards: [{ item: "scoutExpedition", quantity: 1 }],
    countsOffline: false,
    ...overrides,
  };
}

function event(overrides: Partial<EventView> = {}): EventView {
  return {
    id: "ev-1",
    theme: "weekly",
    startsAt: PAST,
    endsAt: FAR,
    claimUntil: FAR,
    state: "running",
    missions: [mission()],
    ...overrides,
  };
}

const view = (events: EventView[]): EventsView => ({ enabled: true, events });

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

function serve(more: Record<string, Answer | ((request: OnlineRequest) => Answer)> = {}) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/me": ok({ id: "account-1" }),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/market": ok({ selling: [], holding: [], recent: [] }),
    "GET v1/me/coins": ok({ balance: 0, blocked: false, exchangedToday: 0 }),
    "GET v1/me/items": ok({ lines: [], locked: false }),
    "GET v1/clubs/mine/academy": ok({ enabled: false }),
    "GET v1/me/events": ok(view([event()])),
    ...more,
  });
}

const sent = (method: string, path: string) =>
  server.requests.filter(
    (request) => request.method === method && request.segments.join("/") === path,
  );

/** An event's card, by the event's name. */
const cardOf = (theme: string) =>
  screen.findByRole("region", { name: `online.events.theme.${theme}` });

/** A card's head, the button that folds it. */
const headOf = (card: HTMLElement) =>
  within(card)
    .getAllByRole("button")
    .find((button) => button.hasAttribute("aria-expanded")) as HTMLElement;

/** A mission's row, the button that opens its detail, by the mission's sentence. */
const rowOf = (sentence: string) =>
  screen.findByRole("button", {
    name: new RegExp(`^online\\.events\\.phone\\.rowAria:${sentence}\\|`),
  });

beforeEach(() => {
  resetOnline();
  realtime = fakeRealtime();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === PHONE_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
});
afterEach(() => {
  cleanup();
  server?.restore();
  realtime.restore();
  vi.unstubAllGlobals();
});

describe("the events on a phone", () => {
  // Given two running events, the one ending later with a reward waiting,
  // when the page opens on a phone,
  // then that event's card is open and the other folded, and the app bar says one reward waits
  // in place of the season's day (D-EV1, Q-EV1).
  it("opens the event with a reward waiting and folds the others", async () => {
    serve({
      "GET v1/me/events": ok(
        view([
          event({ id: "soon", theme: "weekly", endsAt: "2098-01-01T00:00:00Z" }),
          event({
            id: "late",
            theme: "seasonOpener",
            missions: [mission({ status: "completed", progress: 5 })],
          }),
        ]),
      ),
    });
    renderOnline("/online/events");

    const waiting = await cardOf("seasonOpener");
    expect(headOf(waiting).getAttribute("aria-expanded")).toBe("true");
    expect(headOf(await cardOf("weekly")).getAttribute("aria-expanded")).toBe("false");
    expect(within(waiting).getByText("online.events.phone.readyCount:1")).toBeTruthy();
    const bar = screen.getByRole("banner");
    const line = within(bar).getByText("online.events.phone.claimsWaiting:1").closest("p");
    // The season's day stays in the line, hidden by CSS while the page's own line fills it.
    expect(line?.lastElementChild?.className).toContain("peer-[:not(:empty)]:hidden");
  });

  // Given a running event folded on arrival beside an open one,
  // when the coach taps its head,
  // then it opens too, the first stays open, and its countdown now counts the seconds (Q-EV2, Q-EV4).
  it("opens several cards at once, counting seconds once open", async () => {
    serve({
      "GET v1/me/events": ok(
        view([
          event({ id: "soon", theme: "weekly", endsAt: "2098-01-01T00:00:00Z" }),
          event({ id: "late", theme: "seasonOpener" }),
        ]),
      ),
    });
    renderOnline("/online/events");
    const later = await cardOf("seasonOpener");
    const folded = within(later).getByRole("timer").textContent ?? "";
    expect(folded).toMatch(/^online\.events\.phone\.leftRunning:online\.events\.phone\.short:/);

    fireEvent.click(headOf(later));

    expect(headOf(later).getAttribute("aria-expanded")).toBe("true");
    expect(headOf(await cardOf("weekly")).getAttribute("aria-expanded")).toBe("true");
    expect(within(later).getByRole("timer").textContent).toMatch(/online\.events\.phone\.long:/);
  });

  // Given an open event with a mission under way and one claimed,
  // when its card shows,
  // then the claimed one waits folded under "Done (1)" and opens on a tap (D-EV5).
  it("folds the missions done at the card's foot", async () => {
    serve({
      "GET v1/me/events": ok(
        view([
          event({
            missions: [
              mission({ code: "a", status: "claimed", progress: 5 }),
              mission({ code: "b", kind: "leagueWinsDirected", target: 3 }),
            ],
          }),
        ]),
      ),
    });
    renderOnline("/online/events");
    await rowOf("online.events.mission.leagueWinsDirected:3");
    expect(screen.queryByRole("button", { name: new RegExp(DIRECTED_5) })).toBeNull();

    const fold = screen.getByRole("button", { name: /online\.events\.phone\.done:1/ });
    fireEvent.click(fold);

    expect(fold.getAttribute("aria-expanded")).toBe("true");
    const row = await rowOf(DIRECTED_5);
    expect(row.getAttribute("aria-label")).toContain("|online.events.claimed|");
  });

  // Given a mission waiting for its claim,
  // when the coach presses "Claim" on its row,
  // then the claim is sent with a key and the reward dialog shows what was given.
  it("claims from the row and shows the reward", async () => {
    serve({
      "GET v1/me/events": ok(
        view([event({ missions: [mission({ status: "completed", progress: 5 })] })]),
      ),
      "POST v1/me/events/ev-1/missions/w1/claim": ok({
        rewards: [{ item: "scoutExpedition", quantity: 1 }],
      }),
    });
    renderOnline("/online/events");

    const claim = await screen.findByRole("button", {
      name: `online.events.claimAria:${DIRECTED_5}`,
    });
    expect(claim.textContent).toBe("online.events.phone.claim");
    fireEvent.click(claim);

    expect(
      await screen.findByRole("dialog", {
        name: "online.items.scoutExpedition.name:scoutExpedition",
      }),
    ).toBeTruthy();
    expect(sent("POST", "v1/me/events/ev-1/missions/w1/claim")[0].idempotencyKey).toBeTruthy();
  });

  // Given a directed mission under way, its reward an energy drink that expires,
  // when the coach taps its row,
  // then a sheet shows its progress with what is left, the reward with what it does and its
  // expiry, what counts, and the way to the fixtures; Back closes it (D-EV4, G-16).
  it("opens a mission's detail in a sheet that Back closes", async () => {
    serve({
      "GET v1/me/events": ok(
        view([
          event({
            missions: [
              mission({
                kind: "leagueWinsDirected",
                target: 3,
                progress: 1,
                rewards: [{ item: "energyDrinkSmall", quantity: 2, expiresInDays: 30 }],
              }),
            ],
          }),
        ]),
      ),
    });
    renderOnline("/online/events");
    fireEvent.click(await rowOf("online.events.mission.leagueWinsDirected:3"));

    const sheet = await screen.findByRole("dialog", {
      name: "online.events.mission.leagueWinsDirected:3",
    });
    expect(within(sheet).getByText("online.events.status.active")).toBeTruthy();
    expect(within(sheet).getByText("online.events.left.leagueWinsDirected:2")).toBeTruthy();
    expect(within(sheet).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1");
    expect(sheet.textContent).toContain("online.events.reward.expires:30");
    expect(within(sheet).getByText("online.events.hint.directed")).toBeTruthy();
    expect(within(sheet).getByRole("link", { name: "online.events.goSchedule" })).toBeTruthy();

    expect(runBackAction()).toBe(true);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  // Given a mission waiting, its detail open,
  // when the coach claims it from the sheet,
  // then the sheet closes and the reward dialog shows.
  it("claims from the sheet, which gives way to the reward", async () => {
    serve({
      "GET v1/me/events": ok(
        view([event({ missions: [mission({ status: "completed", progress: 5 })] })]),
      ),
      "POST v1/me/events/ev-1/missions/w1/claim": ok({ rewards: [{ coin: 20, quantity: 1 }] }),
    });
    renderOnline("/online/events");
    fireEvent.click(await rowOf(DIRECTED_5));
    const sheet = await screen.findByRole("dialog", { name: DIRECTED_5 });
    expect(within(sheet).getByText("online.events.phone.readyNow")).toBeTruthy();

    fireEvent.click(within(sheet).getByRole("button", { name: "online.events.claim" }));

    expect(await screen.findByRole("dialog", { name: "online.shop.coinsAmount:20" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: DIRECTED_5 })).toBeNull();
  });

  // Given a closed event whose mission ended at 2 of 5,
  // when the coach opens the closed group, the card and the mission,
  // then the card says it ended, and the sheet says why it was missed, with no progress bar.
  it("says why a mission of a closed event was missed", async () => {
    serve({
      "GET v1/me/events": ok(view([event({ state: "closed", endsAt: PAST, claimUntil: PAST })])),
    });
    renderOnline("/online/events");
    const group = await screen.findByRole("button", { name: /online\.events\.group\.closed/ });
    expect(group.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(group);
    const card = await cardOf("weekly");
    fireEvent.click(headOf(card));
    expect(within(card).getByText("online.events.phone.over")).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: /online\.events\.phone\.done:1/ }));

    fireEvent.click(await rowOf(DIRECTED_5));

    const sheet = await screen.findByRole("dialog", { name: DIRECTED_5 });
    expect(within(sheet).getByText("online.events.phone.missedCounted:2|5")).toBeTruthy();
    expect(within(sheet).queryByRole("progressbar")).toBeNull();
    expect(within(sheet).queryByRole("link")).toBeNull();
  });

  // Given an event that starts later,
  // when the page opens,
  // then it waits in the folded "coming" group, which says when the nearest starts.
  it("folds the events to come, saying when the nearest starts", async () => {
    serve({
      "GET v1/me/events": ok(view([event({ state: "scheduled", startsAt: FAR })])),
    });
    renderOnline("/online/events");

    const group = await screen.findByRole("button", { name: /online\.events\.group\.scheduled/ });
    expect(group.textContent).toContain("online.events.phone.nearest:");
    expect(screen.queryByRole("region", { name: "online.events.theme.weekly" })).toBeNull();
  });
});
