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
];
const ADMIN_ONLY = [
  "be.error.season.none",
  "be.error.season.alreadyExists",
  // Only the SuperAdmin's unlock of a club's economy answers it (S-10 S10-15).
  "be.error.economy.notLocked",
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
  // parameter is used, so no sentence waits for a value that never comes.
  it.each(["en", "vi"])("use exactly the parameters the server sends, in %s", (name) => {
    const locale = name === "en" ? en : vi;
    for (const [code, params] of Object.entries(ERROR_PARAMS)) {
      const used = placeholders(lookup(locale, code) ?? "").sort();
      expect({ code, used }).toEqual({ code, used: [...params].sort() });
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
