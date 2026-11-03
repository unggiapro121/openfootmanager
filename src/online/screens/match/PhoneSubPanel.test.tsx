import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_QUERY } from "../../../hooks/usePhoneLayout";
import type { OnlineRequest } from "../../../services/onlineTransport";
import {
  fakeRealtime,
  matchEvent,
  matchFrame,
  matchView,
  mineView,
} from "../../../test-utils/onlineMatchKit";
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
import type { MatchFrame, MineView } from "../../api";

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
    `resolved:${typeof error === "string" ? error : (error as Error).message}`,
}));

// The radar draws on a canvas, which the phone's substitutions screen does not need.
vi.mock("../../../components/match/radar/MatchRadar2D", () => ({
  MatchRadar2D: () => <output aria-label="radar" />,
}));

const MATCH = "match-1";
const KEY = "online.match.phoneSubs";

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

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
  server?.restore();
  realtime.restore();
  vi.unstubAllGlobals();
});

function stage({ mine = mineView(), command }: { mine?: MineView; command?: Answer } = {}) {
  let sent = 0;
  const view = matchView();
  view.state = { ...view.state, minute: 63, phase: "SecondHalf", homeScore: 1, awayScore: 1 };
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    [`GET v1/matches/${MATCH}`]: () => ok(view),
    [`GET v1/matches/${MATCH}/mine`]: () => ok(mine),
    [`GET v1/matches/${MATCH}/frames`]: () => ok({ frames: [] }),
    [`POST v1/matches/${MATCH}/commands`]: () => command ?? ok({ commandId: `cmd-${++sent}` }),
  });
}

const orders = () =>
  server.requests
    .filter(
      (request: OnlineRequest) => request.segments.join("/") === `v1/matches/${MATCH}/commands`,
    )
    .map((request) => (request.body as { command: unknown }).command);

function push(frame: MatchFrame) {
  act(() => realtime.push(MATCH, frame));
}

/** Opens the match on a phone, then its substitutions screen. */
async function openSubs() {
  renderOnline(`/online/match/${MATCH}`);
  await waitFor(() => expect(realtime.watches).toHaveLength(1));
  fireEvent.click(await screen.findByRole("button", { name: /online\.match\.phone\.subs/ }));
  return screen.findByRole("dialog", { name: "match.substitutionsTitle" });
}

const panel = () => screen.getByRole("dialog", { name: "match.substitutionsTitle" });
const pitch = () => within(panel()).getByRole("region", { name: `${KEY}.pitch` });
const bench = () => within(panel()).getByRole("region", { name: `${KEY}.bench:2` });
const token = (id: string) =>
  within(pitch()).getByRole("button", { name: new RegExp(`^${KEY}\\.token\\w*:P\\. ${id}\\|`) });
const sheet = () => screen.getByRole("dialog", { name: /^P\. h\d+$/ });
const benchIn = (place: HTMLElement, id: string) =>
  within(place).getByRole("button", { name: new RegExp(`P\\. ${id}\\b`) });

describe("substitutions on a phone", () => {
  // Given the coach of the home side on a phone, 63 minutes in at 1–1,
  // when they open the substitutions,
  // then a full screen shows the minute and the score, the subs used, the pitch with the eleven
  // and the bench, and none of the desktop panel's table rows.
  it("opens a full screen of the pitch and the bench", async () => {
    stage();
    await openSubs();

    expect(within(panel()).getByText("63'")).toBeInTheDocument();
    expect(within(panel()).getByText("match.subsUsed:0|5")).toBeInTheDocument();
    expect(within(pitch()).getAllByRole("button")).toHaveLength(11);
    expect(within(bench()).getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByTestId("sub-panel-off-h9")).toBeNull();
  });

  // Given the substitutions screen,
  // when the coach taps h9 on the pitch, then hs1 in the sheet that opens, then h8 and hs2,
  // and confirms,
  // then both changes wait under "to confirm" until then, and are sent in that order.
  it("queues changes and sends them together", async () => {
    stage();
    await openSubs();

    fireEvent.click(token("h9"));
    fireEvent.click(benchIn(sheet(), "hs1"));
    expect(screen.queryByRole("dialog", { name: "P. h9" })).toBeNull();
    fireEvent.click(token("h8"));
    fireEvent.click(benchIn(sheet(), "hs2"));
    const queued = within(panel()).getByRole("region", { name: `${KEY}.queuedTitle:2` });
    expect(within(queued).getAllByRole("listitem")).toHaveLength(2);
    expect(orders()).toEqual([]);

    fireEvent.click(within(panel()).getByRole("button", { name: `${KEY}.confirm:2` }));
    await waitFor(() => expect(orders()).toHaveLength(2));
    expect(orders()).toEqual([
      { Substitute: { side: "Home", player_off_id: "h9", player_on_id: "hs1" } },
      { Substitute: { side: "Home", player_off_id: "h8", player_on_id: "hs2" } },
    ]);
    expect(await screen.findByText(`${KEY}.sent:2|3`)).toBeInTheDocument();
  });

  // Given the substitutions screen,
  // when the coach taps a bench player first, then the player to take off,
  // then that change waits to be confirmed.
  it("takes the bench player first", async () => {
    stage();
    await openSubs();

    fireEvent.click(benchIn(bench(), "hs1"));
    expect(within(panel()).getByText(`${KEY}.hintPickField:P. hs1`)).toBeInTheDocument();
    fireEvent.click(token("h9"));

    expect(within(panel()).getByRole("button", { name: `${KEY}.queuedRemove:P. h9|P. hs1` }));
    expect(screen.queryByRole("dialog", { name: "P. h9" })).toBeNull();
  });

  // Given a change waiting to be confirmed,
  // when the coach removes it,
  // then nothing waits any more and the button only closes the screen.
  it("takes back a queued change", async () => {
    stage();
    await openSubs();
    fireEvent.click(token("h9"));
    fireEvent.click(benchIn(sheet(), "hs1"));

    fireEvent.click(
      within(panel()).getByRole("button", { name: `${KEY}.queuedRemove:P. h9|P. hs1` }),
    );
    expect(within(panel()).queryByRole("region", { name: /queuedTitle/ })).toBeNull();
    fireEvent.click(within(panel()).getByRole("button", { name: "common.done" }));
    expect(screen.queryByRole("dialog", { name: "match.substitutionsTitle" })).toBeNull();
    expect(orders()).toEqual([]);
  });

  // Given the sheet of h9,
  // when the coach chooses to swap and taps h8,
  // then the swap is sent at once, costing no substitution.
  it("swaps two players' places", async () => {
    stage();
    await openSubs();
    fireEvent.click(token("h9"));
    fireEvent.click(within(sheet()).getByRole("button", { name: `${KEY}.swap` }));
    expect(within(panel()).getByText(`${KEY}.hintSwap:P. h9`)).toBeInTheDocument();

    fireEvent.click(token("h8"));
    await waitFor(() =>
      expect(orders()).toEqual([
        { SwapPositions: { side: "Home", player_a_id: "h9", player_b_id: "h8" } },
      ]),
    );
    expect(await screen.findByText(`${KEY}.swapped:P. h9|P. h8`)).toBeInTheDocument();
  });

  // Given the sheet of h9,
  // when the coach picks him another role,
  // then the role is sent at once.
  it("changes a player's role from his sheet", async () => {
    stage();
    await openSubs();
    fireEvent.click(token("h9"));
    const role = within(sheet()).getByRole("combobox", { name: "tactics.playerRoleLabel" });
    const other = within(role)
      .getAllByRole("option")
      .find((option) => option.getAttribute("value") !== "Standard");
    fireEvent.change(role, { target: { value: other?.getAttribute("value") } });

    await waitFor(() =>
      expect(orders()).toEqual([
        { ChangePlayerRole: { side: "Home", player_id: "h9", role: other?.getAttribute("value") } },
      ]),
    );
  });

  // Given h9 tired at 40 and two bench midfielders,
  // when the coach applies the suggested plan,
  // then its changes wait to be confirmed, h9's first.
  it("adds the suggested plan", async () => {
    stage({ mine: mineView({ roles: [{ playerId: "h9", role: "Standard", condition: 40 }] }) });
    await openSubs();

    fireEvent.click(within(panel()).getByRole("button", { name: /planTitle/ }));
    fireEvent.click(within(panel()).getByRole("button", { name: `${KEY}.planApply:2` }));
    const queued = within(panel()).getByRole("region", { name: `${KEY}.queuedTitle:2` });
    expect(within(queued).getAllByRole("listitem")[0]).toHaveTextContent("P. h9");
    expect(within(panel()).getByRole("button", { name: `${KEY}.planAllAdded` })).toBeDisabled();
  });

  // Given a change already sent and waiting for the match,
  // when the coach looks at the bench,
  // then the player sent on cannot be chosen again.
  it("keeps a player already sent on out of reach", async () => {
    stage();
    await openSubs();
    fireEvent.click(token("h9"));
    fireEvent.click(benchIn(sheet(), "hs1"));
    fireEvent.click(within(panel()).getByRole("button", { name: `${KEY}.confirm:1` }));
    await waitFor(() => expect(orders()).toHaveLength(1));

    await waitFor(() => expect(benchIn(bench(), "hs1")).toBeDisabled());
    expect(within(bench()).getByText(`${KEY}.comesOnFor:P. h9`)).toBeInTheDocument();
  });

  // Given the match refusing orders,
  // when the coach confirms a queued change,
  // then the reason shows and the change stays queued for another try.
  it("keeps a refused change queued", async () => {
    stage({ command: fail(429, "be.error.match.tooManyCommands") });
    await openSubs();
    fireEvent.click(token("h9"));
    fireEvent.click(benchIn(sheet(), "hs1"));
    fireEvent.click(within(panel()).getByRole("button", { name: `${KEY}.confirm:1` }));

    expect(await screen.findByRole("alert")).toHaveTextContent("online.match.orderRefused");
    expect(within(panel()).getByRole("region", { name: `${KEY}.queuedTitle:1` })).toBeVisible();
  });

  // Given the coach's h5 hurt,
  // when they tap Replace on the strip,
  // then the substitutions screen opens on h5's sheet.
  it("opens on a hurt player's sheet", async () => {
    stage();
    renderOnline(`/online/match/${MATCH}`);
    await waitFor(() => expect(realtime.watches).toHaveLength(1));
    push(
      matchFrame(1, {
        result: { phase: "SecondHalf", events: [matchEvent("Injury", "Home", "h5")] },
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "online.match.replace" }));

    expect(await screen.findByRole("dialog", { name: "P. h5" })).toBeInTheDocument();
  });
});
