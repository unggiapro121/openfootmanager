import type { RecentProject } from "./WorldEditorHome";

/** How many projects the editor home remembers. */
const MAX_RECENT = 8;

/**
 * The recent projects with `opened` at the top: listed once, newest first, and
 * the oldest dropped past the limit. A project opened from a `.ofm` picked on
 * disk keeps that file as its source, so two projects of the same package —
 * the author's ongoing one and a newer build opened from disk — can be told apart.
 */
export function rememberRecentProject(
  recent: RecentProject[],
  opened: { path: string; name: string; source?: string },
  openedAt: string,
): RecentProject[] {
  const entry: RecentProject = { path: opened.path, name: opened.name, openedAt };
  if (opened.source) entry.source = opened.source;
  return [entry, ...recent.filter((project) => project.path !== opened.path)].slice(0, MAX_RECENT);
}
