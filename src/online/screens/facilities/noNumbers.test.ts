import { describe, expect, it } from "vitest";

/**
 * The facilities screens' code, tests left out: every capacity, price, build time, upkeep,
 * crowd or demand figure comes from the server (c-27 §11, T13), so none of it is a table here.
 */
const sources = import.meta.glob(["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The tables the client may hold: art and layout, never the game's figures (c-27 §12). */
const ALLOWED = new Set(["STADIUM_STYLE_FROM", "LAYOUT", "RING"]);

const NUMBER = String.raw`-?\d[\d_]*(?:\.\d+)?`;
/** An array literal of four numbers or more, across lines or not. */
const NUMBER_ARRAY = new RegExp(String.raw`\[\s*${NUMBER}(?:\s*,\s*${NUMBER}){3,}\s*,?\s*\]`, "g");

/** The constant a position in `source` belongs to: the last one declared before it. */
function declaredAt(source: string, index: number): string | undefined {
  const before = source.slice(0, index);
  const names = [...before.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)/g)];
  return names[names.length - 1]?.[1];
}

/** Every table of four numbers or more outside the allowed ones, as `file: name`. */
function numberTables(files: Record<string, string>): string[] {
  return Object.entries(files).flatMap(([file, source]) =>
    [...source.matchAll(NUMBER_ARRAY)].flatMap((match) => {
      const name = declaredAt(source, match.index ?? 0);
      return name && ALLOWED.has(name) ? [] : [`${file}: ${name ?? "?"}`];
    }),
  );
}

describe("no game figures in the facilities client (c-27 §11, §12)", () => {
  // Given the facilities screens' code,
  // when it is searched for tables of four numbers or more,
  // then only the stadium styles' first levels, the map's layout and its ring are found.
  it("keeps no table of figures but the art's", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(10);
    expect(numberTables(sources)).toEqual([]);
  });

  // Given a capacity table slipped into a file, inline or over several lines,
  // when it is searched,
  // then it is found under its name, and an allowed table or a short one is not.
  it("finds a table of figures, whatever its layout", () => {
    const capacities = "const CAPACITY = [10_000, 12000,\n  14000, 16500];";
    const prices = "export const PRICES = [\n  0.85,\n  1,\n  1.2,\n  1.4,\n];";
    const art = "export const STADIUM_STYLE_FROM = [1, 2, 4, 6] as const;";
    const short = "const PAIR = [1, 2, 3];";
    expect(numberTables({ a: capacities, b: prices, c: art, d: short })).toEqual([
      "a: CAPACITY",
      "b: PRICES",
    ]);
  });
});
