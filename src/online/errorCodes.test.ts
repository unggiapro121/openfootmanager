import { describe, expect, it } from "vitest";

import en from "../i18n/locales/en.json";
import vi from "../i18n/locales/vi.json";
import { ERROR_CODES, ERROR_PARAMS } from "./api/errorCodes";

/**
 * Codes only the server's admin routes return: the game has no admin screen, so no player reads
 * them (`CLAUDE.md`, rule 2). A new admin-only code is added here on purpose, not by default.
 */
const ADMIN_ONLY_PREFIXES = [
  "be.error.admin.",
  "be.error.contentPack.",
  "be.error.world.",
  "be.error.ruleset.",
  // A SuperAdmin's ledger adjustments and reversals (S-10 §3.9).
  "be.error.ledger.",
  // A SuperAdmin's price lists (S-15 §3.9).
  "be.error.priceList.",
];
const ADMIN_ONLY = [
  "be.error.season.none",
  "be.error.season.alreadyExists",
  // Only the SuperAdmin's unlock of a club's economy answers it (S-10 S10-15).
  "be.error.economy.notLocked",
  // An item given from a source its power class may not come from: a server fault (S-17 W16).
  "be.error.inventory.sourceNotAllowed",
  // Only the SuperAdmin's events answer them: a definition refused, an event cancelled after it
  // started (S-19 §3.4).
  "be.error.events.invalid",
  "be.error.events.started",
];

/** The proxy's own codes (`src-tauri/src/application/online`) and the client's (`client.ts`). */
const ONLINE_CODES = [
  "be.error.online.notSignedIn",
  "be.error.online.unreachable",
  "be.error.online.serverUnexpected",
  "be.error.online.routeNotAllowed",
  "be.error.online.clientOutdated",
  "be.error.online.serverOutdated",
];

const playerCodes = [
  ...ERROR_CODES.filter(
    (code) =>
      !ADMIN_ONLY_PREFIXES.some((prefix) => code.startsWith(prefix)) && !ADMIN_ONLY.includes(code),
  ),
  ...ONLINE_CODES,
];

function lookup(locale: unknown, code: string): string | undefined {
  let node: unknown = locale;
  for (const part of code.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * Parameters the screens drop on purpose: an id a player cannot read (C-7 C7-50). The sentence
 * says the case without it.
 */
const UNSHOWN: Record<string, string[]> = {
  "be.error.academy.tripOpen": ["tripId"],
  // A known lack has its own sentence (`online.items.needs.*`, itemText CASES); the code's own
  // sentence is for one this build does not know, so it never shows the raw value (S-17d).
  "be.error.shop.notUsableNow": ["needs"],
  // Points left have their own sentence (`online.items.dailyLimitPoints`, itemText); the code's
  // own is for a season that caps drinks by count (S-28 S28-8).
  "be.error.inventory.dailyLimitReached": ["pointsLeft"],
  // Sent only when known (the next season's day 0), so the sentence says the case without it.
  "be.error.inventory.dailyGiftClosed": ["nextAt"],
};

const placeholders = (text: string) => [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]);

describe("online error codes", () => {
  // Given every code the server or the proxy can answer a coach with,
  // when the English and Vietnamese locales are read,
  // then each has a translation: a player never sees a raw key. Every other locale is held to
  // English by the locale coverage test.
  it.each(["en", "vi"])("are all translated in %s", (name) => {
    const locale = name === "en" ? en : vi;
    const missing = playerCodes.filter((code) => lookup(locale, code) === undefined);
    expect(missing).toEqual([]);
  });

  // Given the codes translated with parameters,
  // when their English and Vietnamese sentences are read,
  // then every placeholder is a parameter the server declares for that code, and every declared
  // parameter is used but those dropped on purpose, so no sentence waits for a value that never
  // comes.
  it.each(["en", "vi"])("use exactly the parameters the server sends, in %s", (name) => {
    const locale = name === "en" ? en : vi;
    // Admin-only codes have no sentence; their parameters reach no player.
    for (const [code, params] of Object.entries(ERROR_PARAMS).filter(([code]) =>
      playerCodes.includes(code),
    )) {
      const used = placeholders(lookup(locale, code) ?? "").sort();
      const shown = params.filter((param) => !UNSHOWN[code]?.includes(param));
      expect({ code, used }).toEqual({ code, used: [...shown].sort() });
    }
  });

  // Given every other coach code,
  // when its sentences are read,
  // then it takes no placeholder: the server sends none for it.
  it("leave codes without parameters without placeholders", () => {
    const withPlaceholders = playerCodes.filter(
      (code) => !(code in ERROR_PARAMS) && placeholders(lookup(en, code) ?? "").length > 0,
    );
    expect(withPlaceholders).toEqual([]);
  });
});
