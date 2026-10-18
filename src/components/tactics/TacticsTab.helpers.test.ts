import { describe, expect, it } from "vitest";
import type { PlayerData } from "../../store/gameStore";
import { resolveStartingXiIds } from "./TacticsTab.helpers";

const makePlayer = (
  id: string,
  position: string,
  overrides: Partial<PlayerData> = {},
): PlayerData => ({
  id,
  match_name: id,
  full_name: `Player ${id}`,
  date_of_birth: "1998-01-01",
  nationality: "GB",
  position,
  natural_position: position,
  alternate_positions: [],
  training_focus: null,
  attributes: {
    pace: 60,
    stamina: 60,
    strength: 60,
    agility: 60,
    passing: 60,
    shooting: 60,
    tackling: 60,
    dribbling: 60,
    defending: 60,
    positioning: 60,
    vision: 60,
    decisions: 60,
    composure: 60,
    aggression: 60,
    teamwork: 60,
    leadership: 60,
    handling: 60,
    reflexes: 60,
    aerial: 60,
    long_passing: 60,
    crossing: 60,
    curve: 60,
    free_kick: 60,
    long_shots: 60,
    heading: 60,
    first_touch: 60,
  },
  condition: 100,
  morale: 80,
  injury: null,
  team_id: "team1",
  retired: false,
  contract_end: "2027-06-30",
  wage: 1000,
  market_value: 100000,
  stats: {
    appearances: 0,
    goals: 0,
    assists: 0,
    clean_sheets: 0,
    yellow_cards: 0,
    red_cards: 0,
    avg_rating: 0,
    minutes_played: 0,
  },
  career: [],
  transfer_listed: false,
  loan_listed: false,
  transfer_offers: [],
  traits: [],
  ...overrides,
});

describe("resolveStartingXiIds", () => {
  it("prefers exact slot matches when filling pending tactics slots", () => {
    const availablePlayers = [
      makePlayer("gk", "Goalkeeper"),
      makePlayer("lb", "Left Back", {
        natural_position: "Left Back",
        attributes: {
          pace: 55,
          stamina: 55,
          strength: 55,
          agility: 55,
          passing: 55,
          shooting: 40,
          tackling: 68,
          dribbling: 50,
          defending: 68,
          positioning: 62,
          vision: 52,
          decisions: 58,
          composure: 56,
          aggression: 58,
          teamwork: 60,
          leadership: 50,
          handling: 10,
          reflexes: 10,
          aerial: 10,
          long_passing: 55,
          crossing: 55,
          curve: 55,
          free_kick: 55,
          long_shots: 40,
          heading: 10,
          first_touch: 50,
        },
      }),
      makePlayer("cb1", "Center Back", {
        natural_position: "Center Back",
        attributes: {
          pace: 70,
          stamina: 70,
          strength: 74,
          agility: 62,
          passing: 62,
          shooting: 42,
          tackling: 78,
          dribbling: 52,
          defending: 80,
          positioning: 74,
          vision: 58,
          decisions: 70,
          composure: 68,
          aggression: 71,
          teamwork: 68,
          leadership: 60,
          handling: 10,
          reflexes: 10,
          aerial: 10,
          long_passing: 62,
          crossing: 62,
          curve: 62,
          free_kick: 62,
          long_shots: 42,
          heading: 10,
          first_touch: 52,
        },
      }),
      makePlayer("cb2", "Center Back"),
      makePlayer("rb", "Right Back", { natural_position: "Right Back" }),
      makePlayer("m1", "Midfielder"),
      makePlayer("m2", "Midfielder"),
      makePlayer("m3", "Midfielder"),
      makePlayer("m4", "Midfielder"),
      makePlayer("f1", "Forward"),
      makePlayer("f2", "Forward"),
    ];
    const playersById = new Map(availablePlayers.map((player) => [player.id, player]));

    const ids = resolveStartingXiIds({
      availablePlayers,
      formation: "4-4-2",
      pendingStartingXiIds: ["gk"],
      playersById,
      savedStartingXiIds: [],
    });

    expect(ids[1]).toBe("lb");
  });

  // Given a pending side naming a player who has left the squad, when it is
  // resolved, then his slot is filled for its position and the players after
  // him stay in their own slots.
  it("fills a vanished pending starter's slot in place", () => {
    const availablePlayers = [
      makePlayer("gk", "Goalkeeper"),
      makePlayer("cb", "CenterBack"),
      makePlayer("st", "Striker"),
      makePlayer("lb", "LeftBack"),
    ];
    const playersById = new Map(availablePlayers.map((player) => [player.id, player]));

    const ids = resolveStartingXiIds({
      availablePlayers,
      formation: "4-4-2",
      pendingStartingXiIds: ["gk", "sold-lb", "cb"],
      playersById,
      savedStartingXiIds: [],
    });

    expect(ids.slice(0, 3)).toEqual(["gk", "lb", "cb"]);
  });
});
