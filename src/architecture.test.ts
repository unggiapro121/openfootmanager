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
const ONLINE_API_IMPORT = /from\s+["'][^"']*online\/api(\/[^"']*)?["']/;
const CORE_BINDINGS_IMPORT = /from\s+["'][^"']*bindings\/core(\/[^"']*)?["']/;
const RAW_HTML_IGNORE = /biome-ignore[^\n]*noDangerouslySetInnerHtml/;

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

  // Given every production source file,
  // when its imports are read,
  // then only the online client (`src/online/`) reads the server's declarations: a screen gets
  // online data through it, never by typing the wire format itself (E3-6 E6-19).
  it("keeps the online API's declarations inside src/online", () => {
    const offenders = Object.entries(sources)
      .filter(([path, text]) => !path.startsWith("./online/") && ONLINE_API_IMPORT.test(text))
      .map(([path]) => path)
      .sort();

    expect(offenders).toEqual([]);
  });

  // Given the online client's files,
  // when their imports are read,
  // then the fork's own core types are reached only from `src/online/convert/`: online data
  // becomes a core type through a typed conversion, where a difference fails `tsc`, and is never
  // passed through as is (E6-19).
  it("converts online data to core types only in src/online/convert", () => {
    const offenders = Object.entries(sources)
      .filter(
        ([path, text]) =>
          path.startsWith("./online/") &&
          !path.startsWith("./online/convert/") &&
          !path.startsWith("./online/api/") &&
          CORE_BINDINGS_IMPORT.test(text),
      )
      .map(([path]) => path)
      .sort();

    expect(offenders).toEqual([]);
  });

  // Given the online mode's files,
  // when their imports are read,
  // then none reaches an offline service or the offline game store: an online screen never
  // writes a save, and reads only what the server sent (C-2 C2-15).
  it("keeps the online mode off the offline services and game store", () => {
    const offline = /from\s+["'][^"']*(services\/(?!online)\w+Service|store\/gameStore)["']/;
    const offenders = Object.entries(sources)
      .filter(([path, text]) => path.startsWith("./online/") && offline.test(text))
      .map(([path]) => path)
      .sort();

    expect(offenders).toEqual([]);
  });

  // Given every file outside the online mode,
  // when its imports are read,
  // then only the app's router reaches into `src/online/`: a component both modes share takes
  // view-model props and never knows the online client (C-2 C2-15).
  it("keeps shared components unaware of the online mode", () => {
    const online = /from\s+["'][^"']*\/online\/[^"']*["']/;
    const offenders = Object.entries(sources)
      .filter(
        ([path, text]) =>
          !path.startsWith("./online/") && path !== "./App.tsx" && online.test(text),
      )
      .map(([path]) => path)
      .sort();

    expect(offenders).toEqual([]);
  });

  // Given the online client's files,
  // when they are searched,
  // then none silences Biome's rule against raw HTML: online text comes from other players
  // (club names) and must never be rendered as markup (E6-17).
  it("never lets raw HTML through in src/online", () => {
    const offenders = Object.entries(sources)
      .filter(([path, text]) => path.startsWith("./online/") && RAW_HTML_IGNORE.test(text))
      .map(([path]) => path);

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
