import { describe, expect, it } from "vitest";

import { SUPPORTED_LANGUAGES, type SupportedLanguageCode } from "../i18n";
import { formatDateTime, getLocale } from "./dateFormatting";

describe("getLocale", () => {
  // Every code in SUPPORTED_LANGUAGES, with its expected tag written out. The
  // type on LANG_LOCALE catches a *missing* language; only this catches a wrong
  // tag, which is the failure that actually reached users — the map was keyed on
  // `zh` where the registry says `zh-CN`, and the raw-code fallback hid it.
  const EXPECTED_TAGS: Record<SupportedLanguageCode, string> = {
    en: "en-US",
    es: "es-ES",
    pt: "pt-BR",
    "pt-BR": "pt-BR",
    fr: "fr-FR",
    de: "de-DE",
    it: "it-IT",
    ru: "ru-RU",
    "zh-CN": "zh-CN",
    cs: "cs-CZ",
    tr: "tr-TR",
    id: "id-ID",
    vi: "vi-VN",
  };

  it("maps every language the game ships", () => {
    for (const { code } of SUPPORTED_LANGUAGES) {
      expect(getLocale(code), `${code} resolves to the wrong tag`).toBe(EXPECTED_TAGS[code]);
    }
  });

  it("covers the registry exactly, so a new language cannot slip past this test", () => {
    expect(Object.keys(EXPECTED_TAGS).sort()).toEqual(
      SUPPORTED_LANGUAGES.map((language) => language.code).sort(),
    );
  });

  it("returns input for unknown codes", () => {
    expect(getLocale("ja")).toBe("ja");
  });

  it("returns 'en-US' for undefined", () => {
    expect(getLocale(undefined)).toBe("en-US");
  });
});

describe("formatDateTime", () => {
  // Given a moment the server sends in UTC (an account's day of deletion, M3c1),
  // when it is shown,
  // then it reads on this machine's clock, with its year, day and minutes, in the player's language.
  it("shows a UTC moment on this machine's clock", () => {
    const iso = "2026-11-19T10:05:00Z";
    const local = new Date(iso);
    const shown = formatDateTime(iso, "en");

    expect(shown).toContain("2026");
    expect(shown).toContain(String(local.getDate()));
    expect(shown).toContain(String(local.getMinutes()).padStart(2, "0"));
    expect(formatDateTime(iso, "vi")).not.toBe(shown);
  });

  // Given something that is not a moment, when it is shown, then it passes through untouched.
  it("leaves what it cannot read as it is", () => {
    expect(formatDateTime("soon", "en")).toBe("soon");
  });
});
