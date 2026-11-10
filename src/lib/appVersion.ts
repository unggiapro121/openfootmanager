/**
 * Build-time version identity.
 *
 * The base semver comes from `src-tauri/tauri.conf.json` and only moves when a
 * release stream branches: odd minor versions (0.3.x) are the unstable stream
 * published as nightlies, even minors (0.4.x) are stable releases. The channel
 * and commit are baked in by `vite.config.ts` at build time, so no
 * per-build edits to Cargo.toml / tauri.conf.json / package.json are needed.
 */

export const APP_VERSION = __APP_VERSION__;
export const APP_CHANNEL = __APP_CHANNEL__;
export const APP_COMMIT = __APP_COMMIT__;
/** The store build number of a phone build (phase 5 M2b-7); empty for every other build. */
export const APP_BUILD = __APP_BUILD__;
export const IS_STABLE_BUILD = APP_CHANNEL === "stable";

/**
 * Version string shown in the UI and the window title.
 *
 * - stable  → `v0.4.0`
 * - nightly → `v0.3.0-nightly · f164fcd`
 * - dev     → `v0.3.0-dev · f164fcd`
 *
 * The channel token is deliberately untranslated: it is part of a semver
 * identifier, not prose.
 */
export function formatAppVersion(): string {
  if (IS_STABLE_BUILD) {
    return `v${APP_VERSION}`;
  }

  const base = `v${APP_VERSION}-${APP_CHANNEL}`;

  return APP_COMMIT === "unknown" ? base : `${base} · ${APP_COMMIT}`;
}

/** `version (build)` for About (phase 5 m2-tech-spec N1); the version alone without a build. */
export function withBuild(version: string, build: string): string {
  return build === "" ? version : `${version} (${build})`;
}
