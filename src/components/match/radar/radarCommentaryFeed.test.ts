import { describe, expect, it } from "vitest";

import {
  type CommentaryFeed,
  EMPTY_FEED,
  READ_MS,
  nextChangeAt,
  receiveLine,
  settleFeed,
} from "./radarCommentaryFeed";

const START: CommentaryFeed<string> = EMPTY_FEED;
const shown = (feed: CommentaryFeed<string>) => feed.current?.line ?? null;

describe("radarCommentaryFeed", () => {
  /** Given an empty bar, when a line of play arrives, then it shows at once. */
  it("shows the first line at once", () => {
    const feed = receiveLine(START, "pass", "play", 0);
    expect(shown(feed)).toBe("pass");
  });

  /** Given a line of play on show, when the next one arrives, then it replaces it at once: the bar follows the radar. */
  it("lets play follow play at once", () => {
    let feed: CommentaryFeed<string> = receiveLine(START, "pass", "play", 0);
    feed = receiveLine(feed, "dribble", "play", 300);
    expect(shown(feed)).toBe("dribble");
  });

  /** Given a goal just shown, when play arrives before it could be read, then the goal stays and the play waits. */
  it("holds a key moment until it has been read", () => {
    let feed: CommentaryFeed<string> = receiveLine(START, "goal", "key", 0);
    feed = receiveLine(feed, "kick-off pass", "play", 500);
    expect(shown(feed)).toBe("goal");
    feed = settleFeed(feed, READ_MS);
    expect(shown(feed)).toBe("kick-off pass");
  });

  /**
   * Given a penalty awarded on show and the taker's run-up waiting behind it,
   * when the goal arrives, then the run-up is dropped: play that a later key
   * moment has overtaken is never shown after it (after GĐ5).
   */
  it("drops waiting play that a later key moment overtakes", () => {
    let feed: CommentaryFeed<string> = receiveLine(START, "penalty given", "key", 0);
    feed = receiveLine(feed, "steps up", "play", 900);
    feed = receiveLine(feed, "goal", "key", 1500);
    feed = settleFeed(feed, READ_MS);
    expect(shown(feed)).toBe("goal");
    feed = settleFeed(feed, 2 * READ_MS);
    expect(shown(feed)).toBe("goal");
    expect(nextChangeAt(feed)).toBeNull();
  });

  /** Given a key moment on show, when another arrives, then it queues behind it and neither is lost. */
  it("queues key moments in order", () => {
    let feed: CommentaryFeed<string> = receiveLine(START, "booking", "key", 0);
    feed = receiveLine(feed, "injury", "key", 100);
    feed = receiveLine(feed, "pass", "play", 200);
    expect(shown(feed)).toBe("booking");
    feed = settleFeed(feed, READ_MS);
    expect(shown(feed)).toBe("injury");
    feed = settleFeed(feed, 2 * READ_MS);
    expect(shown(feed)).toBe("pass");
  });

  /** Given a line just shown, when a filler arrives, then it waits; a newer filler takes its place. */
  it("lets a filler wait for a quiet bar, keeping only the newest", () => {
    let feed: CommentaryFeed<string> = receiveLine(START, "cross", "play", 0);
    feed = receiveLine(feed, "quiet minute 1", "filler", 400);
    feed = receiveLine(feed, "quiet minute 2", "filler", 800);
    expect(shown(feed)).toBe("cross");
    feed = settleFeed(feed, READ_MS);
    expect(shown(feed)).toBe("quiet minute 2");
  });

  /** Given a filler waiting, when play arrives, then the filler is dropped: it described a spell that is over. */
  it("drops a waiting filler once play resumes", () => {
    let feed: CommentaryFeed<string> = receiveLine(START, "cross", "play", 0);
    feed = receiveLine(feed, "quiet minute", "filler", 400);
    feed = receiveLine(feed, "pass", "play", 600);
    feed = settleFeed(feed, 5 * READ_MS);
    expect(shown(feed)).toBe("pass");
  });

  /** Given a line read long enough, when a filler arrives, then it shows at once. */
  it("shows a filler at once on a bar that has been read", () => {
    let feed: CommentaryFeed<string> = receiveLine(START, "cross", "play", 0);
    feed = receiveLine(feed, "quiet minute", "filler", READ_MS + 1);
    expect(shown(feed)).toBe("quiet minute");
  });

  /** Given something waiting, then the next change is due when the line on show has been read; nothing waiting, none is due. */
  it("says when the next change is due", () => {
    let feed: CommentaryFeed<string> = receiveLine(START, "goal", "key", 1000);
    expect(nextChangeAt(feed)).toBeNull();
    feed = receiveLine(feed, "pass", "play", 1200);
    expect(nextChangeAt(feed)).toBe(1000 + READ_MS);
  });
});
