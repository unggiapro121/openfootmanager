import { describe, expect, it } from "vitest";
import { matchEvent, matchView, mineView } from "../../test-utils/onlineMatchKit";
import { squadPlayer } from "../../test-utils/onlineTestKit";
import { initialMatchState } from "./matchState";
import { toSubPanelSnapshot } from "./subPanel";

const state = () => initialMatchState(matchView());

describe("toSubPanelSnapshot", () => {
  // Given the home coach, whose squad knows h9 as tired with his attributes and ratings,
  // when the match is made the game's substitution panel's snapshot,
  // then the coach's own players carry what the squad knows (condition, attributes, position
  // ratings) and his roles, the other side's players carry names and overalls only, and both sides
  // keep their eleven in slot order with their bench.
  it("gives the coach's own players what only the coach's squad knows", () => {
    const squad = [
      squadPlayer({
        id: "h9",
        condition: 41,
        attributes: { ...squadPlayer().attributes, pace: 77 },
        positionRatings: [{ position: "Striker", ovr: 66, fit: "Natural" }],
      }),
    ];
    const mine = mineView({ roles: [{ playerId: "h9", role: "Poacher" }] });

    const snapshot = toSubPanelSnapshot(state(), mine, squad);

    const own = snapshot.home_team.players.find((player) => player.id === "h9");
    expect(own).toMatchObject({
      condition: 41,
      pace: 77,
      role: "Poacher",
      position_ratings: [{ position: "Striker", ovr: 66, fit: "Natural" }],
    });
    const unknown = snapshot.home_team.players.find((player) => player.id === "h3");
    expect(unknown).toMatchObject({ condition: 100, pace: 0, role: "" });
    expect(unknown?.position_ratings).toBeUndefined();
    expect(snapshot.away_team.players.every((player) => player.pace === 0)).toBe(true);
    expect(snapshot.home_team.players.map((player) => player.id)).toEqual(
      Array.from({ length: 11 }, (_, slot) => `h${slot}`),
    );
    expect(snapshot.home_bench.map((player) => player.id)).toEqual(["hs1", "hs2"]);
    expect(snapshot.away_bench.map((player) => player.id)).toEqual(["as1", "as2"]);
  });

  // Given the away side's coach,
  // when the snapshot is made,
  // then the coach's knowledge lands on the away side, and the set pieces are the coach's.
  it("puts the coach's knowledge on the side they coach", () => {
    const mine = mineView({
      side: "Away",
      setPieces: { free_kick_taker: "a3", corner_taker: null, penalty_taker: null, captain: "a1" },
    });

    const snapshot = toSubPanelSnapshot(state(), mine, [squadPlayer({ id: "a2", condition: 12 })]);

    expect(snapshot.away_team.players.find((player) => player.id === "a2")?.condition).toBe(12);
    expect(snapshot.home_team.players.find((player) => player.id === "h2")?.condition).toBe(100);
    expect(snapshot.away_set_pieces).toMatchObject({ free_kick_taker: "a3", captain: "a1" });
    expect(snapshot.home_set_pieces.captain).toBeNull();
  });

  // Given a match with a substitution, a player hurt and one sent off,
  // when the snapshot is made,
  // then the change is listed (who came on, who went off), the hurt one is waiting, and the sent-off
  // one is out.
  it("carries the changes made, the hurt and the sent off", () => {
    const base = state();
    const changed = {
      ...base,
      events: [
        { ...matchEvent("Substitution", "Home", "hs1"), secondary_player_id: "h9", minute: 30 },
      ],
      home: { ...base.home, subsMade: 1 },
      injuredSince: { h5: 12 },
      sentOff: ["a4"],
    };

    const snapshot = toSubPanelSnapshot(changed, mineView(), []);

    expect(snapshot.substitutions).toEqual([
      { minute: 30, side: "Home", player_on_id: "hs1", player_off_id: "h9", came_on_as: null },
    ]);
    expect(snapshot.home_subs_made).toBe(1);
    expect(snapshot.max_subs).toBe(5);
    expect(snapshot.injured).toEqual(["h5"]);
    expect(snapshot.sent_off).toEqual(["a4"]);
  });
});
