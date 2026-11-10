import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_QUERY } from "../../../../hooks/usePhoneLayout";
import type { OnlineRequest } from "../../../../services/onlineTransport";
import {
  fakeRealtime,
  matchEvent,
  matchFrame,
  matchView,
  mineView,
} from "../../../../test-utils/onlineMatchKit";
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
import type { MatchFrame, MineView } from "../../../api";

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

vi.mock("../../../../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) =>
    `resolved:${typeof error === "string" ? error : (error as Error).message}`,
}));

vi.mock("../../../../components/match/radar/MatchRadar2D", () => ({
  MatchRadar2D: () => <output aria-label="radar" />,
}));

const MATCH = "match-1";
const KEY = "online.match.phone";

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

function stage({ mine = mineView(), command }: { mine?: MineView | null; command?: Answer } = {}) {
  let sent = 0;
  const view = matchView();
  view.state = { ...view.state, minute: 20, phase: "FirstHalf", homeScore: 1, awayScore: 1 };
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    [`GET v1/matches/${MATCH}`]: () => ok(view),
    [`GET v1/matches/${MATCH}/mine`]: () =>
      mine === null ? { failure: { status: 404, code: "be.error.notFound" } } : ok(mine),
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

async function open() {
  renderOnline(`/online/match/${MATCH}`);
  await waitFor(() => expect(realtime.watches).toHaveLength(1));
  return screen.findByRole("region", { name: `${KEY}.title` });
}

const dock = () => screen.getByRole("navigation", { name: `${KEY}.dock` });
const sheet = (name: string) => screen.getByRole("dialog", { name });

describe("a live match on a phone", () => {
  // Given the home side's coach on a phone, 20 minutes in at 1–1,
  // when the match opens,
  // then a full screen shows the score and minute, who coaches, the radar, the events, and the
  // dock of the four controls, none of the desktop touchline.
  it("opens a full screen with the score and the controls", async () => {
    stage();
    const page = await open();

    expect(within(page).getByText("1 – 1")).toBeInTheDocument();
    expect(within(page).getByText(`${KEY}.youCoach`)).toBeInTheDocument();
    expect(within(page).getByRole("status", { name: "radar" })).toBeInTheDocument();
    expect(within(dock()).getAllByRole("button")).toHaveLength(4);
    expect(screen.queryByRole("complementary", { name: "online.match.touchline" })).toBeNull();
  });

  // Given a spectator,
  // when the match opens,
  // then there is no dock to give orders.
  it("gives a spectator no controls", async () => {
    stage({ mine: null });
    await open();
    expect(screen.queryByRole("navigation", { name: `${KEY}.dock` })).toBeNull();
  });

  // Given the formation sheet,
  // when the coach picks 4-3-3 and sends it,
  // then the change is sent for their side, the sheet closes and the last order shows it waiting.
  it("sends a new formation from its sheet", async () => {
    stage();
    await open();
    fireEvent.click(
      within(dock()).getByRole("button", { name: /online\.match\.phone\.formation/ }),
    );
    const formations = sheet("match.formation");
    expect(within(formations).getByRole("radio", { name: "4-4-2" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(within(formations).getByRole("radio", { name: "4-3-3" }));
    fireEvent.click(within(formations).getByRole("button", { name: `${KEY}.sendFormation:4-3-3` }));
    await waitFor(() =>
      expect(orders()).toEqual([{ ChangeFormation: { side: "Home", formation: "4-3-3" } }]),
    );
    expect(screen.queryByRole("dialog", { name: "match.formation" })).toBeNull();
    expect(
      screen.getByRole("button", { name: /online\.match\.order\.formation:4-3-3/ }),
    ).toHaveTextContent("online.match.sent.pending");
  });

  // Given the style sheet,
  // when the coach taps counter-attack,
  // then it is sent at once.
  it("sends a play style with one tap", async () => {
    stage();
    await open();
    fireEvent.click(within(dock()).getByRole("button", { name: /online\.match\.phone\.style/ }));
    fireEvent.click(
      within(sheet("match.playStyle")).getByRole("radio", { name: /common\.playStyles\.Counter/ }),
    );
    await waitFor(() =>
      expect(orders()).toEqual([{ ChangePlayStyle: { side: "Home", play_style: "Counter" } }]),
    );
  });

  // Given the roles sheet,
  // when the coach makes h9 captain, then gives him another role,
  // then each is sent as its own order.
  it("sets the captain and a role from the roles sheet", async () => {
    stage();
    await open();
    fireEvent.click(within(dock()).getByRole("button", { name: /online\.match\.phone\.roles/ }));
    const roles = sheet(`${KEY}.rolesTitle`);

    fireEvent.click(within(roles).getByRole("tab", { name: `${KEY}.setPieces` }));
    // The captain's field opens a picker over the roles sheet, never the phone's own list.
    expect(within(roles).queryByRole("combobox")).toBeNull();
    fireEvent.click(within(roles).getByRole("button", { name: /match\.captain/ }));
    fireEvent.click(
      await within(sheet("match.captain")).findByRole("option", { name: /P\. h9\b/ }),
    );
    expect(screen.queryByRole("dialog", { name: "match.captain" })).toBeNull();
    await waitFor(() =>
      expect(orders()).toEqual([{ SetCaptain: { side: "Home", player_id: "h9" } }]),
    );

    fireEvent.click(within(roles).getByRole("tab", { name: "online.match.rolesTitle" }));
    fireEvent.click(within(roles).getByRole("button", { name: /online\.match\.rolePlayer/ }));
    fireEvent.click(
      within(sheet("online.match.rolePlayer")).getByRole("option", { name: /P\. h9\b/ }),
    );
    expect(
      within(roles).getByRole("button", { name: /online\.match\.rolePlayer/ }),
    ).toHaveTextContent("P. h9");
    const choice = within(roles)
      .getAllByRole("radio")
      .find((radio) => radio.getAttribute("aria-checked") === "false");
    fireEvent.click(choice as HTMLElement);
    fireEvent.click(within(roles).getByRole("button", { name: "online.match.changeRole" }));
    await waitFor(() => expect(orders()).toHaveLength(2));
    expect(orders()[1]).toMatchObject({ ChangePlayerRole: { side: "Home", player_id: "h9" } });
  });

  // Given an order sent and then refused by the match,
  // when the coach opens the orders,
  // then the sheet lists it as refused.
  it("lists the orders sent with what became of them", async () => {
    let mine = mineView();
    stage({ mine });
    server.routes[`GET v1/matches/${MATCH}/mine`] = () => ok(mine);
    await open();
    fireEvent.click(within(dock()).getByRole("button", { name: /online\.match\.phone\.style/ }));
    fireEvent.click(
      within(sheet("match.playStyle")).getByRole("radio", { name: /common\.playStyles\.Counter/ }),
    );
    await waitFor(() => expect(orders()).toHaveLength(1));
    mine = mineView({
      commands: [
        {
          commandId: "cmd-1",
          command: { ChangePlayStyle: { side: "Home", play_style: "Counter" } },
          status: "refused",
          sentAt: "2026-10-23T12:00:30Z",
        },
      ],
    });
    push(matchFrame(1, { commands: [{ commandId: "cmd-1", status: "refused" }] }));

    fireEvent.click(await screen.findByRole("button", { name: /online\.match\.sent\.refused/ }));
    const list = sheet(`${KEY}.ordersTitle:1`);
    expect(within(list).getByText(/online\.match\.order\.playStyle/)).toBeInTheDocument();
    expect(within(list).getByText(/online\.match\.sent\.refused/)).toBeInTheDocument();
  });

  // Given the coach holding their side,
  // when they tap the way out,
  // then the game asks first, and staying keeps the match on screen.
  it("asks before the coach leaves the match", async () => {
    stage();
    await open();
    fireEvent.click(screen.getByRole("button", { name: `${KEY}.leave` }));
    const ask = await screen.findByRole("alertdialog", { name: "online.leave.title" });
    fireEvent.click(within(ask).getByRole("button", { name: "online.leave.stay" }));
    expect(screen.getByRole("region", { name: `${KEY}.title` })).toBeInTheDocument();
  });

  // Given the dock,
  // when the coach taps Substitutions,
  // then the phone's own substitutions screen opens.
  it("opens the phone substitutions", async () => {
    stage();
    await open();
    fireEvent.click(within(dock()).getByRole("button", { name: /online\.match\.phone\.subs/ }));
    expect(
      await screen.findByRole("dialog", { name: "match.substitutionsTitle" }),
    ).toBeInTheDocument();
  });

  // Given the coach's h5 hurt,
  // when the match shows it,
  // then the replace call is there, and it opens the substitutions on his sheet.
  it("calls to replace a hurt player", async () => {
    stage();
    await open();
    push(
      matchFrame(1, {
        result: { phase: "FirstHalf", events: [matchEvent("Injury", "Home", "h5")] },
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "online.match.replace" }));
    expect(await screen.findByRole("dialog", { name: "P. h5" })).toBeInTheDocument();
  });

  // Given the three panels,
  // when the coach switches to the line-ups,
  // then both elevens are listed.
  it("shows the line-ups in their tab", async () => {
    stage();
    await open();
    fireEvent.click(screen.getByRole("tab", { name: "match.lineups" }));
    expect(screen.getByRole("list", { name: "Hà Nội FC" })).toHaveTextContent("P. h9");
    expect(screen.getByRole("list", { name: "Hải Phòng" })).toHaveTextContent("P. a9");
  });

  // Given the three panels with the events open and focused,
  // when the left arrow is pressed,
  // then focus wraps to the line-ups, which open (P5-5).
  it("moves between the panels with the arrow keys", async () => {
    stage();
    await open();
    const events = screen.getByRole("tab", { name: "match.events" });
    const lineups = screen.getByRole("tab", { name: "match.lineups" });
    expect(events).toHaveAttribute("tabindex", "0");
    expect(lineups).toHaveAttribute("tabindex", "-1");
    events.focus();
    fireEvent.keyDown(events, { key: "ArrowLeft" });
    expect(lineups).toHaveFocus();
    expect(lineups).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("list", { name: "Hà Nội FC" })).toHaveTextContent("P. h9");
    fireEvent.keyDown(lineups, { key: "Home" });
    expect(events).toHaveFocus();
  });
});
