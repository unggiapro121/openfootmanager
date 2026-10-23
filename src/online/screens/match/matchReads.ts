import type { MatchFrame, MineView } from "../../api";
import { online } from "../../client";
import { OnlineApiError } from "../../errors";

/** Frames read per page of a match's history (the server's ceiling). */
const FRAME_PAGE = 120;

/** The frames of a match after `afterSeq`, page by page, up to step `upTo` or its last. */
export async function readFrames(matchId: string, afterSeq: number, upTo?: number) {
  const frames: MatchFrame[] = [];
  let after = afterSeq;
  for (;;) {
    const page = await online.matches.frames(matchId, after, FRAME_PAGE);
    frames.push(...page.frames);
    const next = page.nextAfterSeq;
    if (next === undefined || page.frames.length === 0) return frames;
    if (upTo !== undefined && next >= upTo) return frames;
    after = next;
  }
}

export async function readMine(matchId: string): Promise<MineView | null> {
  try {
    return await online.matches.mine(matchId);
  } catch (error) {
    // Not a side's coach: a spectator, with no side of their own to see (Qs8-6).
    if (error instanceof OnlineApiError && error.status === 404) return null;
    throw error;
  }
}
