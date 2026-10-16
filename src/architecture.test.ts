import { describe, expect, it } from "vitest";

/**
 * Frontend boundaries that a reviewer would otherwise have to remember.
 *
 * Read raw through Vite rather than `node:fs`: the repo has no `@types/node`
 * (see `lib/issueTemplates.test.ts`).
 */
const sources = import.meta.glob(["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}", "!./test-utils/**"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const TAURI_API_IMPORT = /from\s+["']@tauri-apps\/api(\/[\w-]+)?["']/;

describe("frontend architecture", () => {
  // Given every production source file,
  // when its imports are read,
  // then only `src/services/` reaches `@tauri-apps/api`: components, pages, hooks,
  // stores and libraries talk to the backend through services, so the transport
  // behind them can change (an online client) without touching any of them.
  it("keeps @tauri-apps/api imports inside src/services", () => {
    const offenders = Object.entries(sources)
      .filter(([path, text]) => !path.startsWith("./services/") && TAURI_API_IMPORT.test(text))
      .map(([path]) => path)
      .sort();

    expect(offenders).toEqual([]);
  });

  // Given the scan above,
  // when it runs,
  // then it really saw the source tree and the services that do import Tauri,
  // so an empty offender list is not an empty glob.
  it("scans the real source tree", () => {
    const paths = Object.keys(sources);

    expect(paths.length).toBeGreaterThan(100);
    expect(paths).toContain("./services/transport.ts");
    expect(TAURI_API_IMPORT.test(sources["./services/transport.ts"] ?? "")).toBe(true);
  });
});
