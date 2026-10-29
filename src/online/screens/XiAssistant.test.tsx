import { act, fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTacticsLineup } from "../../components/tactics/useTacticsLineup";
import type { TacticsBoardSource } from "../../components/tactics/tacticsBoardSource";
import type { MyClubView } from "../api";
import type { ClubSetup } from "../api/rules";
import {
  fail,
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
  squadPlayer,
} from "../../test-utils/onlineTestKit";
import {
  toBoardTeam,
  toPositionRatings,
  toRosterPlayer,
  xiAssistantAfter,
} from "../convert/tactics";
import { useOnlineStore } from "../store/onlineStore";
import { useOnlineTacticsSource } from "./useOnlineTacticsSource";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === "object"
        ? `${key}:${Object.values(options as Record<string, unknown>).join("|")}`
        : key,
    i18n: { language: "en" },
  }),
}));

vi.mock("../../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) => `resolved:${(error as Error).message}`,
}));

let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  resetOnline();
  window.localStorage.clear();
});
afterEach(() => server?.restore());

/** Twelve players: eleven to start, one on the bench. */
const SQUAD = Array.from({ length: 12 }, (_, index) =>
  squadPlayer({ id: `p${index}`, fullName: `Player ${index}`, matchName: `P${index}` }),
);
const ELEVEN = SQUAD.slice(0, 11).map((player) => player.id);

function club(overrides: Partial<MyClubView> = {}): MyClubView {
  const base = myClub({ players: SQUAD });
  return { ...base, setup: { ...base.setup, startingXiIds: ELEVEN }, ...overrides };
}

type Sent = ClubSetup & { xiAssistant?: boolean };

/** The setup route: answers what it was sent, the switch as asked, one version on. */
function setupRoute(start: MyClubView) {
  let version = start.version;
  return (request: { body?: unknown }) => {
    version += 1;
    const { xiAssistant, ...setup } = request.body as Sent;
    return ok({
      ...start,
      version,
      setup,
      xiAssistant: xiAssistant ?? start.xiAssistant,
      xiPick: xiAssistant ? "assistant" : "saved",
    });
  };
}

const sentBodies = () =>
  server.requests
    .filter((request) => request.method === "PUT")
    .map((request) => request.body as Sent);

describe("the switch a save sends", () => {
  // Given the assistant on or off,
  // when a change is saved,
  // then turning it sends what is asked, an eleven the coach chose sends off, anything else
  // sends it as it is.
  it("follows the change", () => {
    expect(xiAssistantAfter(false, { kind: "xiAssistant", on: true })).toBe(true);
    expect(xiAssistantAfter(true, { kind: "startingXi", playerIds: [] })).toBe(false);
    expect(xiAssistantAfter(true, { kind: "formation", formation: "4-3-3" })).toBe(true);
    expect(xiAssistantAfter(false, { kind: "playStyle", playStyle: "Counter" })).toBe(false);
  });

  // Given the assistant on,
  // when the coach changes his shape, then drags a player into his eleven, then hands it back,
  // then the shape keeps it on, the eleven turns it off and raises the hand-back notice, and
  // handing back sends it on and clears the notice.
  it("sends it with every write and notices when the coach's eleven turns it off", async () => {
    const start = club({ xiAssistant: true, xiPick: "assistant" });
    useOnlineStore.getState().setClub(start);
    server = fakeServer({ "PUT v1/clubs/mine/setup": setupRoute(start) });
    const { result } = renderHook(() => useOnlineTacticsSource(start));

    await act(() => result.current.source.setFormation("4-3-3"));
    expect(sentBodies()[0].xiAssistant).toBe(true);
    expect(result.current.assistantDropped).toBe(false);

    const dragged = [...ELEVEN.slice(0, 10), "p11"];
    await act(() => result.current.source.setStartingXi(dragged));
    expect(sentBodies()[1]).toMatchObject({ startingXiIds: dragged, xiAssistant: false });
    expect(result.current.assistantDropped).toBe(true);

    await act(() => result.current.setAssistant(true));
    expect(sentBodies()[2].xiAssistant).toBe(true);
    expect(result.current.assistantDropped).toBe(false);
  });
});

describe("the board under the assistant", () => {
  /** The board's source for `view`, its eleven naming an injured player. */
  function source(view: MyClubView, lineupByAssistant: boolean) {
    const setStartingXi = vi.fn(() => Promise.resolve());
    const board: TacticsBoardSource = {
      team: toBoardTeam(view),
      roster: view.players.map((player) => toRosterPlayer(player, view.club.id)),
      positionRatings: toPositionRatings(view.players),
      setStartingXi,
      setFormation: vi.fn(() => Promise.resolve()),
      setPlayStyle: vi.fn(() => Promise.resolve()),
      setMatchRoles: vi.fn(() => Promise.resolve()),
      setTacticsPhase: vi.fn(() => Promise.resolve()),
      setPlayerRole: vi.fn(() => Promise.resolve()),
      lineupByAssistant,
    };
    return { board, setStartingXi };
  }

  // Given an eleven that names an injured player,
  // when the board shows it without the assistant, then with it,
  // then the board saves what it shows on its own without it, and never with it (C10-3).
  it("never saves the eleven on its own while the assistant picks", async () => {
    const hurt = SQUAD.map((player) =>
      player.id === "p4" ? { ...player, injury: { name: "Knee", daysRemaining: 5 } } : player,
    );
    const view = club({ players: hurt });

    const own = source(view, false);
    renderHook(() => useTacticsLineup({ source: own.board }));
    await waitFor(() => expect(own.setStartingXi).toHaveBeenCalled());

    const assisted = source(view, true);
    renderHook(() => useTacticsLineup({ source: assisted.board }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(assisted.setStartingXi).not.toHaveBeenCalled();
  });
});

describe("the assistant on the club pages", () => {
  function stage(view: MyClubView) {
    server = fakeServer({
      "GET v1/season": ok(SEASON),
      "GET v1/clubs/mine": ok(view),
      "GET v1/leagues/mine": ok(LEAGUE),
      "PUT v1/clubs/mine/setup": setupRoute(view),
    });
  }

  // Given the assistant on for a coach who never saw it,
  // when the tactics page opens, and opens again later,
  // then the switch is on, the eleven is marked expected, the notice that it is on shows the first
  // time only.
  it("tells a coach once that it is on", async () => {
    stage(club({ xiAssistant: true, xiPick: "assistant" }));
    const first = renderOnline("/online/tactics");

    const toggle = await screen.findByRole("switch", { name: "online.tactics.xiAssistant.title" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("online.tactics.xiAssistant.expected")).toBeInTheDocument();
    expect(screen.getByText("online.tactics.xiAssistant.onHint")).toBeInTheDocument();
    expect(screen.getByText("online.tactics.xiAssistant.firstNotice")).toBeInTheDocument();
    first.unmount();

    renderOnline("/online/tactics");
    await screen.findByRole("switch", { name: "online.tactics.xiAssistant.title" });
    expect(screen.queryByText("online.tactics.xiAssistant.firstNotice")).toBeNull();
  });

  // Given the assistant on,
  // when the coach turns the switch,
  // then the save sends it off and the page says his saved eleven plays.
  it("turns it off from the switch", async () => {
    stage(club({ xiAssistant: true, xiPick: "assistant" }));
    renderOnline("/online/tactics");

    fireEvent.click(
      await screen.findByRole("switch", { name: "online.tactics.xiAssistant.title" }),
    );

    await waitFor(() => expect(sentBodies()[0]?.xiAssistant).toBe(false));
    expect(await screen.findByText("online.tactics.xiAssistant.offHint")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText("online.tactics.xiAssistant.expected")).toBeNull();
  });

  // Given the assistant off and a saved eleven too short to play,
  // when the tactics page opens,
  // then it says the assistant picks for now, and the eleven is marked expected.
  it("says when a broken saved eleven is picked for the coach", async () => {
    stage(club({ xiAssistant: false, xiPick: "savedBroken" }));
    renderOnline("/online/tactics");

    expect(await screen.findByText("online.tactics.xiAssistant.savedBroken")).toBeInTheDocument();
    expect(screen.getByText("online.tactics.xiAssistant.expected")).toBeInTheDocument();
  });

  // Given the next match being prepared,
  // when the tactics page opens,
  // then the switch cannot be turned and says why.
  it("locks the switch with the lineup", async () => {
    const base = club({ xiAssistant: true, xiPick: "assistant" });
    const fixture = base.nextFixture;
    if (!fixture) throw new Error("a next fixture");
    stage({ ...base, nextFixture: { ...fixture, status: "prepared" } });
    renderOnline("/online/tactics");

    expect(
      await screen.findByRole("switch", { name: "online.tactics.xiAssistant.title" }),
    ).toBeDisabled();
    expect(screen.getByText("online.tactics.xiAssistant.locked")).toBeInTheDocument();
  });

  // Given the assistant on, then off,
  // when the squad page opens,
  // then only with it on does a line say it picks the eleven, linking to the tactics page.
  it("says on the squad page that the assistant picks", async () => {
    stage(club({ xiAssistant: true, xiPick: "assistant" }));
    const on = renderOnline("/online/squad");
    const link = await screen.findByRole("link", { name: "online.tactics.xiAssistant.squadLink" });
    expect(link).toHaveAttribute("href", "/online/tactics");
    on.unmount();
    server.restore();
    resetOnline();

    stage(club());
    renderOnline("/online/squad");
    await screen.findByRole("table");
    expect(screen.queryByText("online.tactics.xiAssistant.squadLine")).toBeNull();
  });

  // Given a server that refuses the save,
  // when the coach turns the switch,
  // then the switch can be turned again.
  it("lets the switch be tried again after a refusal", async () => {
    server = fakeServer({
      "GET v1/season": ok(SEASON),
      "GET v1/clubs/mine": ok(club({ xiAssistant: true, xiPick: "assistant" })),
      "GET v1/leagues/mine": ok(LEAGUE),
      "PUT v1/clubs/mine/setup": fail(500, "be.error.internal"),
    });
    renderOnline("/online/tactics");
    const toggle = await screen.findByRole("switch", { name: "online.tactics.xiAssistant.title" });

    fireEvent.click(toggle);

    await waitFor(() => expect(sentBodies()).toHaveLength(1));
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});
