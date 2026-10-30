import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { targetQuery } from "../../client";
import { OnlineApiError } from "../../errors";
import {
  capsText,
  effectText,
  groupOf,
  itemCodeText,
  itemsErrorText,
  pointsLost,
  targetKindOf,
} from "./itemText";

/** A `t` that shows the key and its parameters, as the screens' tests do. */
const t = ((key: string, options?: Record<string, unknown>) =>
  options && Object.keys(options).length > 0
    ? `${key}:${Object.entries(options)
        .map(([name, value]) => `${name}=${String(value)}`)
        .join("|")}`
    : key) as unknown as TFunction;

describe("an item's target as the preview's query names it", () => {
  // Given each kind of target,
  // when it is written for the query,
  // then a player and a style carry their value after one `:`, the club and the account are bare.
  it("writes player:<id>, style:<style>, club and account", () => {
    expect(targetQuery({ kind: "player", playerId: "p-1" })).toBe("player:p-1");
    expect(targetQuery({ kind: "style", style: "HighPress" })).toBe("style:HighPress");
    expect(targetQuery({ kind: "club" })).toBe("club");
    expect(targetQuery({ kind: "account" })).toBe("account");
  });
});

describe("what each item is used on", () => {
  // Given the codes of the catalogue and one this build does not know,
  // when their group and target are asked,
  // then the use-route items name their target, the others none, and the unknown code is `other`.
  it("groups the catalogue and leaves an unknown code in other", () => {
    expect(groupOf("energyDrinkSmall")).toBe("condition");
    expect(targetKindOf("teamRecoveryPack")).toBe("club");
    expect(targetKindOf("tacticalNoteMaster")).toBe("style");
    expect(targetKindOf("xpBoosterX2")).toBe("account");
    expect(targetKindOf("playerRename")).toBeUndefined();
    expect(groupOf("scoutExpeditionElite")).toBe("academy");
    expect(groupOf("changeNationality")).toBe("other");
    expect(targetKindOf("changeNationality")).toBeUndefined();
  });
});

describe("an item code with its parameters", () => {
  // Given the four reasons of wrongTarget and a reason this build does not know,
  // when the code is spelled,
  // then each known reason has its own sentence and the unknown one falls back to the code's.
  it("says each reason of wrongTarget by its own sentence", () => {
    for (const reason of ["conditionFull", "notInjured", "atCap", "wrongTier"]) {
      expect(itemCodeText(t, "en", "be.error.inventory.wrongTarget", { reason })).toBe(
        `online.items.reason.${reason}`,
      );
    }
    expect(itemCodeText(t, "en", "be.error.inventory.wrongTarget", { reason: "tooTired" })).toBe(
      "be.error.inventory.wrongTarget:reason=tooTired",
    );
  });

  // Given notUsableHere for a rename, for the academy, and for a use this build does not know,
  // when it is spelled,
  // then the rename and the academy have their sentences and the rest falls back.
  it("says where an item is used instead", () => {
    expect(itemCodeText(t, "en", "be.error.inventory.notUsableHere", { use: "rename" })).toBe(
      "online.items.use.rename",
    );
    expect(itemCodeText(t, "en", "be.error.inventory.notUsableHere", { use: "academy" })).toBe(
      "online.items.use.academy",
    );
    expect(itemCodeText(t, "en", "be.error.inventory.notUsableHere", { use: "market" })).toBe(
      "be.error.inventory.notUsableHere:use=market",
    );
  });

  // Given a match lock and a day's cap with their moments,
  // when they are spelled,
  // then the moments are dates in the player's language, not ISO strings.
  it("spells the kick-off and the next day as dates", () => {
    const locked = itemCodeText(t, "en", "be.error.inventory.targetMatchLocked", {
      kickoffAt: "2099-01-02T15:30:00Z",
    });
    expect(locked).toMatch(/^be\.error\.inventory\.targetMatchLocked:kickoffAt=/);
    expect(locked).not.toContain("2099-01-02T15:30:00Z");
    const daily = itemsErrorText(
      t,
      "en",
      new OnlineApiError({
        status: 409,
        code: "be.error.inventory.dailyLimitReached",
        details: { params: { nextAt: "2099-01-03T00:00:00Z" } },
      }),
    );
    expect(daily).toMatch(/^be\.error\.inventory\.dailyLimitReached:nextAt=/);
    expect(daily).not.toContain("2099-01-03T00:00:00Z");
  });
});

describe("what the shop says an item does", () => {
  // Given the numbers of a large drink, an advanced medkit, a master note and the booster,
  // when they are written,
  // then each says its own effect, a note its mastery range up to one below its upper bound.
  it("writes each effect from the ruleset's numbers", () => {
    expect(effectText(t, { condition: 35 })).toEqual(["online.shop.effect.condition:n=35"]);
    expect(effectText(t, { reduceDays: 3, cureAtMost: 3 })).toEqual([
      "online.shop.effect.cure:days=3|cure=3",
    ]);
    expect(effectText(t, { reduceDays: 1 })).toEqual(["online.shop.effect.days:days=1"]);
    expect(effectText(t, { xp: 500, masteryFrom: 85, masteryUntil: 99 })).toEqual([
      "online.shop.effect.note:xp=500|from=85|to=98",
    ]);
    expect(effectText(t, { matches: 5 })).toEqual(["online.shop.effect.matches:n=5"]);
    expect(capsText(t, { perPlayerDay: 2, maxMatches: 10 })).toEqual([
      "online.shop.caps.perPlayerDay:n=2",
      "online.shop.caps.maxMatches:n=10",
    ]);
  });
});

describe("condition caps in points (C-12b)", () => {
  // Given a season capping drinks in points, a refusal with 5 points left, and a large drink
  // (35) previewed on players at 90 and at 50,
  // when the caps, the refusal and the loss to 100 are written,
  // then the cap reads in points, the refusal names the 5 points, and only the player at 90
  // loses 25 points.
  it("reads the cap, the points left and what 100 cuts", () => {
    expect(capsText(t, { pointsPerPlayerDay: 50 })).toEqual([
      "online.shop.caps.pointsPerPlayerDay:n=50",
    ]);
    const refused = itemsErrorText(
      t,
      "en",
      new OnlineApiError({
        status: 409,
        code: "be.error.inventory.dailyLimitReached",
        details: { params: { nextAt: "2099-01-03T00:00:00Z", pointsLeft: 5 } },
      }),
    );
    expect(refused).toMatch(/^online\.items\.dailyLimitPoints:pointsLeft=5\|nextAt=/);
    expect(refused).not.toContain("2099-01-03T00:00:00Z");
    const effect = {
      kind: "condition" as const,
      players: [
        { playerId: "full", before: 90, after: 100 },
        { playerId: "tired", before: 50, after: 85 },
      ],
    };
    expect(pointsLost(effect, 35)).toEqual([{ playerId: "full", lost: 25 }]);
    expect(pointsLost(effect, undefined)).toEqual([]);
  });
});
