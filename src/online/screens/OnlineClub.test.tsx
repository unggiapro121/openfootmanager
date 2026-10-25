import { act, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => resetOnline());
afterEach(() => server?.restore());

const SQUAD = [
  squadPlayer({
    id: "gk",
    fullName: "Thủ Môn",
    matchName: "Thủ Môn",
    position: "Goalkeeper",
    naturalPosition: "Goalkeeper",
    ovr: 60,
  }),
  squadPlayer({
    id: "st",
    fullName: "Tiền Đạo",
    matchName: "Tiền Đạo",
    position: "Forward",
    naturalPosition: "LeftWinger",
    ovr: 70,
  }),
  squadPlayer({
    id: "cb",
    fullName: "Trung Vệ",
    matchName: "Trung Vệ",
    position: "Defender",
    naturalPosition: "CenterBack",
    ovr: 65,
  }),
];

/** The server's setup route: answers the setup it was sent, one version on. */
function setupRoute(club: MyClubView) {
  let version = club.version;
  return (request: { body?: unknown; ifMatch?: string }) => {
    if (request.ifMatch !== String(version)) return fail(409, "be.error.club.versionStale");
    version += 1;
    return ok({ ...club, version, setup: request.body as ClubSetup });
  };
}

describe("the online tactics source", () => {
  // Given two changes made one right after the other,
  // when the board writes them,
  // then the second waits for the first and is built on it, each with the version it follows.
  it("writes changes one after another on the confirmed club", async () => {
    const club = myClub({ players: SQUAD });
    useOnlineStore.getState().setClub(club);
    server = fakeServer({ "PUT v1/clubs/mine/setup": setupRoute(club) });
    const { result } = renderHook(() => useOnlineTacticsSource(club));

    await act(async () => {
      await Promise.all([
        result.current.source.setFormation("4-3-3"),
        result.current.source.setPlayStyle("Counter"),
      ]);
    });

    const writes = server.requests.filter((request) => request.method === "PUT");
    expect(writes.map((request) => request.ifMatch)).toEqual(["7", "8"]);
    expect(useOnlineStore.getState().club?.setup).toMatchObject({
      formation: "4-3-3",
      playStyle: "Counter",
    });
  });

  // Given a club changed elsewhere since it was read,
  // when a change is written with the old version,
  // then the club is read again and the board says so, and the change is not sent again.
  it("reloads the club when it was changed elsewhere", async () => {
    const club = myClub({ players: SQUAD });
    useOnlineStore.getState().setClub(club);
    const theirs = myClub({ players: SQUAD, version: 9 });
    server = fakeServer({
      "PUT v1/clubs/mine/setup": fail(409, "be.error.club.versionStale"),
      "GET v1/clubs/mine": ok(theirs),
    });
    const { result } = renderHook(() => useOnlineTacticsSource(club));

    await act(async () => {
      await expect(result.current.source.setFormation("4-3-3")).rejects.toBeTruthy();
    });

    expect(result.current.outcome).toEqual({ kind: "stale" });
    expect(useOnlineStore.getState().club?.version).toBe(9);
    expect(server.requests.filter((request) => request.method === "PUT")).toHaveLength(1);
  });

  // Given a line-up the server refuses with its reasons,
  // when it is written,
  // then each reason is kept for the screen to show.
  it("keeps the server's reasons for a refused line-up", async () => {
    const club = myClub({ players: SQUAD });
    useOnlineStore.getState().setClub(club);
    server = fakeServer({
      "PUT v1/clubs/mine/setup": fail(422, "be.error.club.setupInvalid", {
        details: { issues: [{ issue: "notInSquad", playerId: "stranger" }] },
      }),
    });
    const { result } = renderHook(() => useOnlineTacticsSource(club));

    await act(async () => {
      await expect(result.current.source.setStartingXi(["stranger"])).rejects.toBeTruthy();
    });

    expect(result.current.outcome).toEqual({
      kind: "invalid",
      problems: [{ issue: "notInSquad", playerId: "stranger" }],
    });
  });
});

describe("the online club pages", () => {
  function stage(club: MyClubView, season: typeof SEASON = SEASON) {
    server = fakeServer({
      "GET v1/season": ok(season),
      "GET v1/clubs/mine": ok(club),
      "GET v1/leagues/mine": ok(LEAGUE),
      "PUT v1/clubs/mine/training": (request) => ok(request.body),
    });
  }

  // Given a fixture already being prepared,
  // when the tactics page opens,
  // then it says the line-up is locked and the board cannot be used.
  it("locks the tactics board once the match is prepared", async () => {
    const base = myClub({ players: SQUAD });
    stage({ ...base, nextFixture: { ...base.nextFixture!, status: "prepared" } });
    renderOnline("/online/tactics");

    const banner = await screen.findByText(/^online\.tactics\.locked:/);
    expect(banner).toBeInTheDocument();
    expect(document.querySelector("[inert]")).not.toBeNull();
  });

  // Given an open line-up,
  // when the tactics page opens,
  // then the board is in reach.
  it("leaves the board open before the lock", async () => {
    stage(myClub({ players: SQUAD }));
    renderOnline("/online/tactics");

    await screen.findByRole("navigation", { name: "online.nav.label" });
    await waitFor(() => expect(screen.queryByText(/^online\.tactics\.locked/)).toBeNull());
    expect(document.querySelector("[inert]")).toBeNull();
  });

  // Given a squad,
  // when the squad page opens,
  // then the squad is listed by line, strongest first, each by the position he plays, with the
  // first eleven marked, and a player opens his own page.
  it("lists the squad by line and opens a player's page", async () => {
    stage(myClub({ players: SQUAD }));
    renderOnline("/online/squad");

    const table = await screen.findByRole("table");
    const names = within(table)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(names).toEqual(["Thủ Môn", "Trung Vệ", "Tiền Đạo"]);

    // Each by the position he plays, not only his line.
    const winger = within(table).getByRole("link", { name: "Tiền Đạo" }).closest("tr");
    expect(winger).toHaveTextContent(":LW");
    expect(winger).not.toHaveTextContent(":FWD");

    fireEvent.click(within(table).getByRole("link", { name: "Tiền Đạo" }));
    expect(await screen.findByRole("heading", { name: "Tiền Đạo" })).toBeInTheDocument();
    expect(screen.getByText("playerProfile.attributes")).toBeInTheDocument();
    expect(screen.getByText("playerProfile.seasonStats")).toBeInTheDocument();
  });

  // Given a player with his feet, build and traits told,
  // when his page opens,
  // then the hero shows his foot, height, weight and traits as the offline profile does.
  it("shows a player's foot, build and traits on his page", async () => {
    const [keeper, ...others] = SQUAD;
    const tall = {
      ...keeper,
      heightCm: 191,
      weightKg: 84,
      footedness: "Left",
      traits: ["Playmaker"],
    };
    stage(myClub({ players: [tall, ...others] }));
    renderOnline("/online/squad/gk");

    expect(await screen.findByText("common.footedness.Left")).toBeInTheDocument();
    expect(screen.getByText(/191/)).toBeInTheDocument();
    expect(screen.getByText(/84/)).toBeInTheDocument();
    expect(screen.getByText("common.footednessLabel")).toBeInTheDocument();
  });

  // Given the squad list,
  // when the coach presses a player's shirt number,
  // then the number picker opens over the list, and the player's page does not.
  it("opens the shirt number picker from the list without leaving it", async () => {
    stage(myClub({ players: SQUAD }));
    renderOnline("/online/squad");

    const table = await screen.findByRole("table");
    fireEvent.click(within(table).getAllByRole("button", { name: /squad.jerseyPickerAction/ })[0]);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "location" }).textContent).toBe("/online/squad");
  });

  // Given a squad where one player is banned for a match by a red card,
  // when the squad page and his own page open,
  // then both say he is suspended, and the others' rows do not.
  it("marks a player banned by a red card", async () => {
    const [keeper, ...others] = SQUAD;
    stage(myClub({ players: [{ ...keeper, suspendedMatches: 1 }, ...others] }));
    renderOnline("/online/squad");

    const table = await screen.findByRole("table");
    const row = within(table).getByRole("link", { name: "Thủ Môn" }).closest("tr");
    expect(row).toHaveTextContent("online.squad.suspended:1");
    expect(table).not.toHaveTextContent("online.squad.suspended:undefined");
    expect(within(table).getAllByText(/online\.squad\.suspended/)).toHaveLength(1);

    fireEvent.click(within(table).getByRole("link", { name: "Thủ Môn" }));
    expect(await screen.findByText("online.squad.suspended:1")).toBeInTheDocument();
  });

  // Given a squad of three,
  // when the coach filters by a line, by the first eleven and by a name, then clears the filter,
  // then each shows the players it lets through, says when none, and clearing brings all back.
  it("filters the squad and clears the filter", async () => {
    const club = myClub({ players: SQUAD });
    stage({ ...club, setup: { ...club.setup, startingXiIds: ["gk"] } });
    renderOnline("/online/squad");
    const rows = async () => (await screen.findAllByRole("row")).length - 1;

    expect(await rows()).toBe(3);
    fireEvent.click(screen.getByRole("combobox", { name: "squad.pos" }));
    fireEvent.click(screen.getByRole("option", { name: "online.market.group.Defender" }));
    expect(await rows()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "common.clear" }));
    fireEvent.click(screen.getByRole("combobox", { name: "common.status" }));
    fireEvent.click(screen.getByRole("option", { name: "preMatch.startingXI" }));
    expect(await rows()).toBe(1);
    expect(screen.getByRole("link", { name: "Thủ Môn" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("common.search"), { target: { value: "zzz" } });
    expect(await screen.findByText("online.squad.noMatch")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common.clear" }));
    expect(await rows()).toBe(3);
  });

  // Given a squad,
  // when the coach sorts by overall, twice,
  // then the strongest comes first, then the weakest.
  it("sorts the squad by a column", async () => {
    stage(myClub({ players: SQUAD }));
    renderOnline("/online/squad");
    const order = () =>
      screen
        .getAllByRole("link")
        .map((link) => link.textContent)
        .filter((text) => ["Thủ Môn", "Trung Vệ", "Tiền Đạo"].includes(text ?? ""));

    fireEvent.click(await screen.findByRole("button", { name: "common.ovr" }));
    expect(order()).toEqual(["Tiền Đạo", "Trung Vệ", "Thủ Môn"]);
    fireEvent.click(screen.getByRole("button", { name: "common.ovr" }));
    expect(order()).toEqual(["Thủ Môn", "Trung Vệ", "Tiền Đạo"]);
  });

  // Given a coach with no training plan yet,
  // when they pick a focus,
  // then the whole plan is sent, the rest from the game's defaults, and the note goes away.
  it("saves a first training plan from one choice", async () => {
    const aiPlan = {
      focus: "Physical" as const,
      intensity: "High" as const,
      schedule: "Light" as const,
      groups: [{ id: "g", name: "Keepers", focus: "Defending" as const, player_ids: ["gk"] }],
    };
    stage(myClub({ players: SQUAD, trainingPlan: aiPlan, trainingPlanIsOwn: false }));
    renderOnline("/online/training");

    expect(await screen.findByText("online.training.noPlan")).toBeInTheDocument();
    fireEvent.click(screen.getByText("training.focuses.Tactical.label").closest("button")!);

    await waitFor(() => expect(screen.queryByText("online.training.noPlan")).toBeNull());
    const [write] = server.requests.filter((request) => request.method === "PUT");
    expect(write.body).toEqual({ ...aiPlan, focus: "Tactical" });
  });

  // Given a season that says today's weekday, and one that does not,
  // when the training page opens,
  // then the "today is" line shows only when the weekday is known.
  it("says what today is only when the season tells the weekday", async () => {
    stage(myClub({ players: SQUAD }));
    const { unmount } = renderOnline("/online/training");
    await screen.findByText("online.training.noPlan");
    expect(screen.queryByText("training.todayIs")).toBeNull();
    unmount();
    server.restore();
    resetOnline();

    stage(myClub({ players: SQUAD }), { ...SEASON, weekday: 0 });
    renderOnline("/online/training");
    expect(await screen.findByText("training.todayIs")).toBeInTheDocument();
  });

  // Given a scheduled fixture whose line-up lock time has passed,
  // when the tactics page opens,
  // then the board is locked even before the fixture is prepared.
  it("locks the board from the lock time the server gives", async () => {
    const base = myClub({ players: SQUAD });
    stage({
      ...base,
      nextFixture: { ...base.nextFixture!, lineupLocksAt: "2000-01-01T00:00:00Z" },
    });
    renderOnline("/online/tactics");

    expect(await screen.findByText(/^online\.tactics\.locked:/)).toBeInTheDocument();
    expect(document.querySelector("[inert]")).not.toBeNull();
  });
});
