import { describe, expect, it } from "vitest";

/**
 * The core types the server's declarations carry (`api/domain`, `api/rules`, …) are copies at the
 * fork tag the server pins; `bindings/core` is this fork's own. A difference is legitimate (the
 * fork moved on, the server has not pinned it yet), so this test only reports it, as the signal
 * that the server could pin a newer tag (E3-6-tech-spec.md E6-19). A difference that would break
 * something fails `tsc` in the functions that convert online data, not here.
 */
const online = import.meta.glob("./api/{domain,engine,rules}/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const core = import.meta.glob("../bindings/core/{domain,engine,rules}/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("online core types", () => {
  // Given the server's copies of the core types and this fork's,
  // when they are compared,
  // then the ones that differ are listed (never a failure).
  it("reports the core types the server's copy differs on", () => {
    const differing = Object.entries(online)
      .filter(([path]) => !path.endsWith("/index.ts"))
      .map(([path, text]) => ({ name: path.replace("./api/", ""), text }))
      .filter(({ name, text }) => core[`../bindings/core/${name}`] !== text)
      .map(({ name }) => name);
    if (differing.length > 0) {
      console.info(
        `[online] the server's core types differ from this fork's (it could pin a newer tag): ${differing.join(", ")}`,
      );
    }
    expect(Object.keys(online).length).toBeGreaterThan(0);
  });
});
