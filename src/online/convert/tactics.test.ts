import { describe, expect, it } from "vitest";
import { myClub, squadPlayer } from "../../test-utils/onlineTestKit";
import { applySetupChange, toBoardTeam, toPositionRatings, toRosterPlayer } from "./tactics";

describe("toBoardTeam", () => {
  // Given the club's setup as the server sent it,
  // when the tactics board reads it,
  // then every part of the setup lands in the board's field of the same meaning.
  it("carries the whole setup", () => {
    const club = myClub();
    const team = toBoardTeam(club);
    expect(team).toEqual({
      id: "club-1",
      formation: club.setup.formation,
      play_style: club.setup.playStyle,
      starting_xi_ids: club.setup.startingXiIds,
      match_roles: club.setup.matchRoles,
      tactics_phase: club.setup.tacticsPhase,
      player_roles: club.setup.playerRoles,
    });
  });
});

describe("toRosterPlayer", () => {
  // Given an injured player of the coach's squad,
  // when he is converted for the board,
  // then he keeps his age (no made-up date of birth), his injury in the board's shape, and has
  // no other positions, traits or photo.
  it("keeps what the server sent and makes nothing up", () => {
    const player = squadPlayer({ injury: { name: "injuries.hamstring", daysRemaining: 2 } });
    const roster = toRosterPlayer(player, "club-1");
    expect(roster).toMatchObject({
      id: player.id,
      full_name: player.fullName,
      natural_position: player.position,
      alternate_positions: [],
      age: player.age,
      team_id: "club-1",
      injury: { name: "injuries.hamstring", days_remaining: 2 },
    });
    expect(roster).not.toHaveProperty("date_of_birth");
    expect(roster).not.toHaveProperty("traits");
  });
});

describe("toPositionRatings", () => {
  // Given a squad, each player with his ratings by pitch position as the server sends them,
  // when the board's ratings are built,
  // then each player keeps his own, position, rating and fit, keyed by his id.
  it("keeps each player's ratings by his id", () => {
    const rated = squadPlayer({
      id: "p1",
      positionRatings: [{ position: "Striker", ovr: 70, fit: "Natural" }],
    });
    expect(toPositionRatings([rated, squadPlayer({ id: "p2" })])).toEqual({
      p1: [{ position: "Striker", ovr: 70, fit: "Natural" }],
      p2: [],
    });
  });
});

describe("applySetupChange", () => {
  const setup = myClub().setup;

  // Given the confirmed setup,
  // when one part of it is changed,
  // then that part changes and the rest stays as confirmed.
  it("changes one part and keeps the rest", () => {
    expect(applySetupChange(setup, { kind: "formation", formation: "4-3-3" })).toEqual({
      ...setup,
      formation: "4-3-3",
    });
    expect(
      applySetupChange(setup, { kind: "playerRole", playerId: "p1", role: "Poacher" }).playerRoles,
    ).toEqual({ ...setup.playerRoles, p1: "Poacher" });
    expect(
      applySetupChange(setup, { kind: "tacticsPhase", patch: { tempo: "Direct" } }).tacticsPhase,
    ).toEqual({ ...setup.tacticsPhase, tempo: "Direct" });
  });

  // Given a play style the server does not know,
  // when it is asked for,
  // then it is refused here instead of sent.
  it("refuses an unknown play style", () => {
    expect(() => applySetupChange(setup, { kind: "playStyle", playStyle: "Chaos" })).toThrow();
    expect(applySetupChange(setup, { kind: "playStyle", playStyle: "Counter" }).playStyle).toBe(
      "Counter",
    );
  });
});
