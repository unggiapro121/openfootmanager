import { describe, expect, it } from "vitest";
import { LOCALE_FILES, type LocaleTree } from "../../../i18n/i18nTestHelpers";

/** The keys C-13b adds (tech-spec S-31c/C-13b §5.7). */
const AUTO_KEYS = [
  "online.training.focus.auto",
  "online.training.focus.autoDesc",
  "online.training.focus.autoFitness",
  "online.training.focus.autoPick",
  "online.training.plan.summaryAuto",
  "online.training.noPlanAuto",
  "online.academy.players.clubFocusAuto",
];

/**
 * Words that would tell a hidden balance rule (PD-Q5): a player's ceiling, his potential, that he
 * has stopped growing. English and Vietnamese are checked in every locale, as a copied phrase;
 * each locale also by its own words.
 */
const EVERYWHERE = ["ceiling", "potential", "maxed", "trần", "tiềm năng", "hết phát triển"];
const OWN_WORDS: Record<string, string[]> = {
  cs: ["potenciál", "strop"],
  de: ["potenzial", "obergrenze", "decke"],
  en: [],
  es: ["potencial", "techo", "tope"],
  fr: ["potentiel", "plafond"],
  id: ["potensi", "batas atas"],
  it: ["potenziale", "tetto"],
  pt: ["potencial", "teto", "tecto"],
  "pt-BR": ["potencial", "teto"],
  ru: ["потенциал", "потолок"],
  tr: ["potansiyel", "tavan"],
  vi: [],
  "zh-CN": ["潜力", "上限", "封顶"],
};

function valueAt(tree: LocaleTree, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
      tree,
    );
}

// T-C6 (C-13b C13b-7): the wording of "Auto".
describe("the wording of Auto", () => {
  // Given the thirteen locales,
  // when each new key is read,
  // then every locale has it, as text.
  it("is in all thirteen locales", () => {
    expect(Object.keys(LOCALE_FILES).sort()).toEqual(Object.keys(OWN_WORDS).sort());
    for (const [code, tree] of Object.entries(LOCALE_FILES)) {
      for (const key of AUTO_KEYS) {
        expect(typeof valueAt(tree, key), `${code} ${key}`).toBe("string");
      }
    }
  });

  // Given the new keys in every locale,
  // when their text is searched for the words of a hidden rule,
  // then none of them is there.
  it("never speaks of a ceiling or a potential", () => {
    for (const [code, tree] of Object.entries(LOCALE_FILES)) {
      const banned = [...EVERYWHERE, ...(OWN_WORDS[code] ?? [])];
      for (const key of AUTO_KEYS) {
        const text = String(valueAt(tree, key)).toLocaleLowerCase(code);
        for (const word of banned) {
          expect(text.includes(word), `${code} ${key} says "${word}"`).toBe(false);
        }
      }
    }
  });
});
