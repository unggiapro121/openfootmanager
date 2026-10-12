import { describe, expect, it } from "vitest";
import type { PlayerData } from "../../store/gameStore";
import { getKeeperFitBreakdown, getKeeperShotStopping, getKeeperStyleLean } from "./keeperStyleFit";
import { getPlayStyleFit } from "./SquadTab.helpers";

const PLAY_STYLES = ["Balanced", "Attacking", "Defensive", "Possession", "Counter", "HighPress"];

const makePlayer = (
  id: string,
  position: string,
  attributes: Partial<PlayerData["attributes"]> = {},
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
    ...attributes,
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
});

// An elite shot-stopper with poor feet and below-par composure (Carnesecchi, 2025-26).
const eliteShotStopper = makePlayer("elite", "Goalkeeper", {
  handling: 85,
  reflexes: 88,
  positioning: 85,
  aerial: 75,
  decisions: 72,
  composure: 41,
  passing: 29,
  vision: 54,
  pace: 32,
  agility: 34,
  strength: 56,
  dribbling: 19,
});

// Every secondary attribute sits where a keeper with 65 shot-stopping usually has it.
const typicalKeeper = makePlayer("typical", "Goalkeeper", {
  handling: 65,
  reflexes: 65,
  positioning: 65,
  aerial: 61,
  strength: 59,
  decisions: 59,
  composure: 40,
  passing: 25,
  vision: 40,
  pace: 35,
  agility: 39,
});

describe("keeper play-style fit", () => {
  /**
   * Given a keeper with elite handling, reflexes and positioning but poor outfield attributes,
   * when the style fit is scored in his own slot,
   * then every play style rates him a strong fit.
   */
  it("rates an elite shot-stopper a strong fit in every play style", () => {
    for (const style of PLAY_STYLES) {
      expect(getPlayStyleFit(eliteShotStopper, style, "Goalkeeper")).toBe("strong");
    }
  });

  /**
   * Given the same keeper and no deployed position,
   * when the style fit is scored,
   * then his natural position still selects the keeper formula.
   */
  it("uses the keeper formula from the natural position when no slot is given", () => {
    expect(getPlayStyleFit(eliteShotStopper, "Counter")).toBe("strong");
  });

  /**
   * Given a keeper whose secondary attributes match his shot-stopping level,
   * when the style fit is scored,
   * then he is a good fit, and a keeper with 50 shot-stopping is a risky one.
   */
  it("grades average and weak keepers as good and risky", () => {
    expect(getPlayStyleFit(typicalKeeper, "Balanced", "Goalkeeper")).toBe("good");

    const weakKeeper = makePlayer("weak", "Goalkeeper", {
      handling: 50,
      reflexes: 50,
      positioning: 50,
      composure: 30,
      passing: 18,
      vision: 28,
    });
    expect(getPlayStyleFit(weakKeeper, "Balanced", "Goalkeeper")).toBe("risky");
  });

  /**
   * Given a centre-back with outfield-level handling and reflexes,
   * when he is scored in the goalkeeper slot,
   * then the keeper formula and the out-of-position penalty make him a risky fit.
   */
  it("rates an outfield player in goal as risky", () => {
    const centreBack = makePlayer("cb", "CenterBack", {
      handling: 10,
      reflexes: 10,
      positioning: 80,
    });
    expect(getPlayStyleFit(centreBack, "Defensive", "Goalkeeper")).toBe("risky");
  });

  /**
   * Given a keeper deployed in an outfield slot,
   * when the style fit is scored,
   * then the outfield formula applies, as it did before the keeper formula existed.
   */
  it("keeps the outfield formula for a keeper deployed outfield", () => {
    expect(getPlayStyleFit(eliteShotStopper, "Counter", "Striker")).toBe("risky");
  });
});

describe("keeper shot-stopping and style lean", () => {
  /**
   * Given handling 85, reflexes 88 and positioning 85,
   * when shot-stopping is computed,
   * then it is their plain average — the keeper rating the match engine uses.
   */
  it("averages handling, reflexes and positioning for shot-stopping", () => {
    expect(getKeeperShotStopping(eliteShotStopper)).toBeCloseTo(86, 5);
  });

  /**
   * Given the elite shot-stopper and the Counter weights,
   * when the style lean is computed,
   * then it matches the worked example in goalkeeper-formulas.md §7.2.
   */
  it("matches the documented Counter lean for the elite shot-stopper", () => {
    expect(getKeeperStyleLean(eliteShotStopper, "Counter")).toBeCloseTo(-2.95, 1);
  });

  /**
   * Given a keeper whose secondary attributes sit on the expectation line,
   * when the style lean is computed for any style,
   * then it is close to zero.
   */
  it("gives a near-zero lean to a keeper with an average profile", () => {
    for (const style of PLAY_STYLES) {
      expect(Math.abs(getKeeperStyleLean(typicalKeeper, style))).toBeLessThan(0.5);
    }
  });

  /**
   * Given two keepers with 80 shot-stopping, one good with the ball and one not,
   * when their Possession lean is computed,
   * then the ball-playing keeper leans higher.
   */
  it("leans a ball-playing keeper above a pure shot-stopper for Possession", () => {
    const shotStopping = { handling: 80, reflexes: 80, positioning: 80 };
    const ballPlayer = makePlayer("bp", "Goalkeeper", {
      ...shotStopping,
      passing: 55,
      composure: 70,
      vision: 70,
    });
    const pureStopper = makePlayer("ps", "Goalkeeper", {
      ...shotStopping,
      passing: 25,
      composure: 45,
      vision: 45,
    });
    expect(getKeeperStyleLean(ballPlayer, "Possession")).toBeGreaterThan(0);
    expect(getKeeperStyleLean(pureStopper, "Possession")).toBeLessThan(0);
  });

  /**
   * Given extreme secondary attributes in both directions,
   * when the lean is computed,
   * then it is capped at plus or minus 8 so it never outweighs shot-stopping.
   */
  it("caps the lean at plus or minus eight", () => {
    const extremeHigh = makePlayer("hi", "Goalkeeper", {
      handling: 70,
      reflexes: 70,
      positioning: 70,
      passing: 99,
      composure: 99,
      vision: 99,
      decisions: 99,
    });
    const extremeLow = makePlayer("lo", "Goalkeeper", {
      handling: 90,
      reflexes: 90,
      positioning: 90,
      passing: 1,
      composure: 1,
      vision: 1,
      decisions: 1,
    });
    expect(getKeeperStyleLean(extremeHigh, "Possession")).toBe(8);
    expect(getKeeperStyleLean(extremeLow, "Possession")).toBe(-8);
  });

  /**
   * Given an unknown play style name,
   * when the lean is computed,
   * then the Balanced weights apply.
   */
  it("falls back to the Balanced weights for an unknown style", () => {
    expect(getKeeperStyleLean(eliteShotStopper, "Unknown")).toBe(
      getKeeperStyleLean(eliteShotStopper, "Balanced"),
    );
  });
});

describe("keeper fit breakdown for the style-fit tooltip", () => {
  /**
   * Given the elite shot-stopper in goal under Counter,
   * when the tooltip breakdown is built,
   * then shot-stopping is a whole number and the lean is signed to one decimal.
   */
  it("formats shot-stopping and a signed lean for a keeper in goal", () => {
    expect(getKeeperFitBreakdown(eliteShotStopper, "Counter", "Goalkeeper")).toEqual({
      save: "86",
      lean: "-2.9",
    });
    expect(getKeeperFitBreakdown(eliteShotStopper, "Possession", "Goalkeeper")?.lean).toMatch(
      /^[+-]\d+\.\d$/,
    );
  });

  /**
   * Given a keeper with a positive lean,
   * when the tooltip breakdown is built,
   * then the lean carries an explicit plus sign.
   */
  it("prefixes a positive lean with a plus sign", () => {
    const ballPlayer = makePlayer("bp", "Goalkeeper", {
      handling: 80,
      reflexes: 80,
      positioning: 80,
      passing: 55,
      composure: 70,
      vision: 70,
    });
    expect(getKeeperFitBreakdown(ballPlayer, "Possession", "Goalkeeper")?.lean).toMatch(/^\+/);
  });

  /**
   * Given an outfield player in an outfield slot, or a keeper deployed outfield,
   * when the tooltip breakdown is built,
   * then there is none, because the keeper formula does not apply.
   */
  it("returns no breakdown outside the goalkeeper slot", () => {
    expect(getKeeperFitBreakdown(makePlayer("st", "Striker"), "Counter", "Striker")).toBeNull();
    expect(getKeeperFitBreakdown(eliteShotStopper, "Counter", "Striker")).toBeNull();
  });
});
