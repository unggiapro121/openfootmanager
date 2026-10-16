import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";

import {
  autoPickMatchLineup,
  changeMatchFormation,
  changeMatchPlayerRole,
  changeMatchPlayStyle,
  finishLiveMatch,
  getMatchSnapshot,
  giveTeamTalk,
  startLiveMatch,
  stepLiveMatch,
  substituteMatchPlayer,
  swapMatchPositions,
} from "./liveMatchService";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("swapMatchPositions", () => {
  // Given two players of the user's side, then the backend is asked to trade
  // their slots with the in-match command.
  it("sends the in-match slot trade", async () => {
    vi.mocked(invoke).mockResolvedValue({ phase: "SecondHalf" });

    const snapshot = await swapMatchPositions("Away", "a", "b");

    expect(invoke).toHaveBeenCalledWith("apply_match_command", {
      command: { SwapPositions: { side: "Away", player_a_id: "a", player_b_id: "b" } },
    });
    expect(snapshot).toEqual({ phase: "SecondHalf" });
  });
});

describe("changeMatchPlayerRole", () => {
  // Given a player of the user's side, then the backend is asked to change his
  // role for this match.
  it("sends the in-match role change", async () => {
    vi.mocked(invoke).mockResolvedValue({ phase: "FirstHalf" });

    await changeMatchPlayerRole("Home", "p9", "Poacher");

    expect(invoke).toHaveBeenCalledWith("apply_match_command", {
      command: { ChangePlayerRole: { side: "Home", player_id: "p9", role: "Poacher" } },
    });
  });
});

describe("autoPickMatchLineup", () => {
  // Given the user's side, then the backend is asked to pick its strongest XI.
  it("asks for the strongest XI", async () => {
    vi.mocked(invoke).mockResolvedValue({ phase: "PreKickOff" });

    await autoPickMatchLineup("Away");

    expect(invoke).toHaveBeenCalledWith("auto_pick_match_lineup", { side: "Away" });
  });
});

describe("startLiveMatch", () => {
  // Given a fixture named by its competition and id, when the live match is
  // started, then the backend gets exactly the kick-off arguments.
  it("opens the live match session for the fixture", async () => {
    vi.mocked(invoke).mockResolvedValue({ phase: "PreKickOff" });

    const snapshot = await startLiveMatch({
      allowsExtraTime: true,
      fixtureIndex: 3,
      competitionId: "fa-cup",
      fixtureId: "fx-7",
      mode: "live",
    });

    expect(invoke).toHaveBeenCalledWith("start_live_match", {
      allowsExtraTime: true,
      fixtureIndex: 3,
      competitionId: "fa-cup",
      fixtureId: "fx-7",
      mode: "live",
    });
    expect(snapshot).toEqual({ phase: "PreKickOff" });
  });
});

describe("stepLiveMatch", () => {
  // Given a running match, when five minutes are played, then the backend is
  // asked for five minutes and its per-minute results come back.
  it("plays the requested number of minutes", async () => {
    vi.mocked(invoke).mockResolvedValue([{ minute: 1 }]);

    const results = await stepLiveMatch(5);

    expect(invoke).toHaveBeenCalledWith("step_live_match", { minutes: 5 });
    expect(results).toEqual([{ minute: 1 }]);
  });
});

describe("getMatchSnapshot", () => {
  // Given a live match session, when the screen asks how it stands, then the
  // snapshot command is sent with no arguments at all.
  it("fetches the snapshot without arguments", async () => {
    vi.mocked(invoke).mockResolvedValue({ phase: "FirstHalf" });

    const snapshot = await getMatchSnapshot();

    expect(invoke).toHaveBeenCalledWith("get_match_snapshot");
    expect(vi.mocked(invoke).mock.lastCall).toHaveLength(1);
    expect(snapshot).toEqual({ phase: "FirstHalf" });
  });
});

describe("finishLiveMatch", () => {
  // Given a finished match, when it is closed, then the backend records it and
  // the updated game and ratings come back.
  it("closes the match and returns the recorded result", async () => {
    const response = { game: { id: "g" }, round_summary: null, player_ratings: { p1: 7.1 } };
    vi.mocked(invoke).mockResolvedValue(response);

    await expect(finishLiveMatch()).resolves.toBe(response);
    expect(invoke).toHaveBeenCalledWith("finish_live_match");
  });
});

describe("changeMatchFormation", () => {
  // Given the user's side, when he picks a new shape, then the in-match
  // formation command is sent.
  it("sends the formation change", async () => {
    vi.mocked(invoke).mockResolvedValue({ phase: "HalfTime" });

    await changeMatchFormation("Home", "4-3-3");

    expect(invoke).toHaveBeenCalledWith("apply_match_command", {
      command: { ChangeFormation: { side: "Home", formation: "4-3-3" } },
    });
  });
});

describe("changeMatchPlayStyle", () => {
  // Given the user's side, when he picks a new play style, then the in-match
  // play-style command is sent with the backend's field name.
  it("sends the play style change", async () => {
    vi.mocked(invoke).mockResolvedValue({ phase: "SecondHalf" });

    await changeMatchPlayStyle("Away", "Counter");

    expect(invoke).toHaveBeenCalledWith("apply_match_command", {
      command: { ChangePlayStyle: { side: "Away", play_style: "Counter" } },
    });
  });
});

describe("substituteMatchPlayer", () => {
  // Given a starter and a substitute of the user's side, when the change is
  // made, then the in-match substitution command is sent.
  it("sends the substitution", async () => {
    vi.mocked(invoke).mockResolvedValue({ phase: "SecondHalf" });

    await substituteMatchPlayer("Home", "off", "on");

    expect(invoke).toHaveBeenCalledWith("apply_match_command", {
      command: { Substitute: { side: "Home", player_off_id: "off", player_on_id: "on" } },
    });
  });
});

describe("giveTeamTalk", () => {
  // Given a tone and the score context, when the talk is given, then the
  // backend gets both and each player's morale swing comes back.
  it("delivers the talk and returns the morale swings", async () => {
    const swings = [
      { player_id: "p1", player_name: "A", old_morale: 60, new_morale: 65, delta: 5 },
    ];
    vi.mocked(invoke).mockResolvedValue(swings);

    const result = await giveTeamTalk("calm", "losing");

    expect(invoke).toHaveBeenCalledWith("apply_team_talk", { tone: "calm", context: "losing" });
    expect(result).toBe(swings);
  });
});
