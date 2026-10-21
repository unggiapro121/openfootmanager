import type { CaptionPriority } from "./radarCaptions";

/**
 * What the commentary bar shows, and what waits for it. Play follows the radar
 * at once; a key moment (a goal, a card) stays until it has been read, the
 * play behind it waiting its turn; a filler line for a quiet spell shows only
 * on a bar that has been read, and only the newest is kept.
 */

/** How long a line stays before anything but play may replace it, in milliseconds. */
export const READ_MS = 2200;

export interface ShownLine<T> {
  line: T;
  priority: CaptionPriority;
  shownAt: number;
}

export interface CommentaryFeed<T> {
  current: ShownLine<T> | null;
  /** Key moments waiting for the one on show to be read, oldest first. */
  keys: T[];
  /** The newest play that arrived while a key moment was being read. */
  play: T | null;
  /** The newest filler waiting for a quiet bar. */
  filler: T | null;
}

export const EMPTY_FEED: CommentaryFeed<never> = {
  current: null,
  keys: [],
  play: null,
  filler: null,
};

function isRead<T>(feed: CommentaryFeed<T>, now: number): boolean {
  return !feed.current || now - feed.current.shownAt >= READ_MS;
}

function show<T>(
  feed: CommentaryFeed<T>,
  line: T,
  priority: CaptionPriority,
  now: number,
): CommentaryFeed<T> {
  // Anything shown ends the quiet spell a waiting filler was about.
  return { ...feed, current: { line, priority, shownAt: now }, filler: null };
}

/** `line` arrives at `now`. */
export function receiveLine<T>(
  feed: CommentaryFeed<T>,
  line: T,
  priority: CaptionPriority,
  now: number,
): CommentaryFeed<T> {
  const holdingKey = feed.current?.priority === "key" && !isRead(feed, now);
  switch (priority) {
    case "play":
      if (holdingKey || feed.keys.length > 0) return { ...feed, play: line, filler: null };
      return show(feed, line, priority, now);
    case "key":
      // Play still waiting has been overtaken by this moment: it is never
      // told after it.
      if (holdingKey) return { ...feed, keys: [...feed.keys, line], play: null };
      return { ...show(feed, line, priority, now), play: null };
    case "filler":
      if (!isRead(feed, now) || feed.keys.length > 0 || feed.play !== null) {
        return { ...feed, filler: line };
      }
      return show(feed, line, priority, now);
  }
}

/** Puts on what has waited long enough by `now`: key moments first, then play, then a filler. */
export function settleFeed<T>(feed: CommentaryFeed<T>, now: number): CommentaryFeed<T> {
  if (!isRead(feed, now)) return feed;
  const [key, ...keys] = feed.keys;
  if (key !== undefined) return { ...show(feed, key, "key", now), keys, filler: feed.filler };
  if (feed.play !== null) return { ...show(feed, feed.play, "play", now), play: null };
  if (feed.filler !== null) return show(feed, feed.filler, "filler", now);
  return feed;
}

/** When `settleFeed` next has something to put on, or null when nothing waits. */
export function nextChangeAt<T>(feed: CommentaryFeed<T>): number | null {
  const waiting = feed.keys.length > 0 || feed.play !== null || feed.filler !== null;
  if (!waiting || !feed.current) return null;
  return feed.current.shownAt + READ_MS;
}
