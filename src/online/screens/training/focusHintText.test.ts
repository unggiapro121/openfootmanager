import { describe, expect, it } from "vitest";

import { LOCALE_FILES, type LocaleTree } from "../../../i18n/i18nTestHelpers";
import { stopReasonKey } from "./extraText";
import { focusHint } from "./focusHintModel";

/**
 * T14 (E5-6-tech-spec.md §6.1, D48): the focus texts of C-13a. The balancing rules stay hidden
 * (no text says a player cannot grow, no ceiling, no number of the ruleset), in every locale.
 */

/** What would give a hidden balancing rule away, by locale: "ceiling" and "cannot grow". */
const GIVEAWAYS: Record<string, RegExp> = {
  en: /ceiling|can ?not grow|no longer grow|can't improve/i,
  vi: /trần|hết khả năng phát triển|không thể lên nữa/i,
  cs: /strop/i,
  de: /obergrenze|decke/i,
  es: /techo/i,
  fr: /plafond/i,
  id: /plafon|batas atas/i,
  it: /tetto|soffitto/i,
  pt: /teto|tecto/i,
  "pt-BR": /teto/i,
  ru: /потол/i,
  tr: /tavan/i,
  "zh-CN": /上限|天花板/,
};

/** The subtrees a player reads training and focus texts in. */
const SCREENS = [
  ["online", "training"],
  ["online", "academy"],
];

function subtree(tree: LocaleTree, path: string[]): unknown {
  return path.reduce<unknown>(
    (node, key) => (node as Record<string, unknown> | undefined)?.[key],
    tree,
  );
}

function leaves(node: unknown, path: string): [string, string][] {
  if (typeof node === "string") return [[path, node]];
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([key, value]) => leaves(value, `${path}.${key}`));
  }
  return [];
}

/** The text of `key` (dotted) in `locale`. */
function text(locale: string, key: string): unknown {
  return subtree(LOCALE_FILES[locale], key.split("."));
}

describe("T14: the focus texts of C-13a", () => {
  // Given a player sitting out because his focus has nothing left that raises his OVR,
  // when the card reads the reason's key,
  // then it is a key of its own with a text in every locale, not "other".
  it("names focusMaxed with a text of its own in every locale", () => {
    const key = stopReasonKey("focusMaxed");
    expect(key).toBe("online.training.extra.reason.focusMaxed");
    for (const locale of Object.keys(LOCALE_FILES)) {
      const value = text(locale, key);
      expect(typeof value, `${locale} ${key}`).toBe("string");
      expect(value, `${locale} ${key}`).not.toBe(
        text(locale, "online.training.extra.reason.other"),
      );
    }
  });

  // Given every locale's training and academy texts,
  // when each is read for a word that would show a hidden balancing rule,
  // then none has one, and the focusMaxed reason carries no number.
  it("keeps the balancing rules hidden in every locale", () => {
    expect(Object.keys(GIVEAWAYS).sort()).toEqual(Object.keys(LOCALE_FILES).sort());
    for (const [locale, pattern] of Object.entries(GIVEAWAYS)) {
      for (const path of SCREENS) {
        for (const [key, value] of leaves(subtree(LOCALE_FILES[locale], path), path.join("."))) {
          expect(value, `${locale} ${key}`).not.toMatch(pattern);
        }
      }
      expect(text(locale, "online.training.extra.reason.focusMaxed")).not.toMatch(/\d/);
    }
  });
});

describe("T14: the hint for each verdict", () => {
  const fit = (verdict: string) => ({ current: "Technical", best: "Tactical", verdict });

  // Given the server's fit of each verdict,
  // when the screens read the hint,
  // then best, fair and poor name the best focus, nothing names both, and a resting player, a
  // fit with no best, an unknown verdict or no fit at all show nothing.
  it("gives each verdict its hint and nothing where it should", () => {
    expect(focusHint(fit("best"))).toEqual({ verdict: "best" });
    expect(focusHint(fit("fair"))).toEqual({ verdict: "fair", best: "Tactical" });
    expect(focusHint(fit("poor"))).toEqual({ verdict: "poor", best: "Tactical" });
    expect(focusHint(fit("nothing"))).toEqual({
      verdict: "nothing",
      current: "Technical",
      best: "Tactical",
    });
    expect(focusHint(fit("resting"))).toBeNull();
    expect(focusHint({ current: "Technical", verdict: "fair" })).toBeNull();
    expect(focusHint(fit("sideways"))).toBeNull();
    expect(focusHint(undefined)).toBeNull();
  });

  // Given a fit read for Technical,
  // when the screen shows the player on Technical, then on Defending,
  // then the hint shows the first time and not the second (the plan changed since).
  it("says nothing for a focus the fit was not read for", () => {
    expect(focusHint(fit("fair"), "Technical")).not.toBeNull();
    expect(focusHint(fit("fair"), "Defending")).toBeNull();
  });

  // Given every locale,
  // when the hint texts are read,
  // then each verdict has a text with only the placeholders it is given, and no number.
  it("has the four hint texts in every locale", () => {
    const placeholders = { best: [], fair: ["best"], poor: ["best"], nothing: ["current", "best"] };
    for (const locale of Object.keys(LOCALE_FILES)) {
      for (const [verdict, names] of Object.entries(placeholders)) {
        const value = text(locale, `online.training.focusHint.${verdict}`);
        expect(typeof value, `${locale} ${verdict}`).toBe("string");
        const found = [...String(value).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
        expect(found, `${locale} ${verdict}`).toEqual([...names].sort());
        expect(String(value).replace(/\{\{\w+\}\}/g, ""), `${locale} ${verdict}`).not.toMatch(/\d/);
      }
    }
  });
});
