import type { TFunction } from "i18next";

import { getCommentary, interpolate, stableHash } from "../commentary";
import { getPlayerName } from "../helpers";
import type { MatchSnapshot } from "../types";
import type { RadarCaption } from "./radarCaptions";
import type { Side } from "./radarGeometry";

/** A caption put into words: an optional headline, the line, and whose side it is about. */
export interface CommentaryText {
  headline: string;
  line: string;
  side: Side;
}

const BASE = "match.radar.commentary";

/** The player's name as the radar draws it: his match name, else his name in the snapshot. */
export function radarNameOf(
  snapshot: MatchSnapshot,
  squadById: ReadonlyMap<string, { match_name?: string | null }>,
): (playerId: string | null) => string {
  return (playerId) => {
    if (!playerId) return "";
    return squadById.get(playerId)?.match_name || getPlayerName(snapshot, playerId);
  };
}

/** One of `key`'s lines, the same one for the same `seed`; null when the key has none. */
function pickLine(t: TFunction, key: string, seed: string): string | null {
  const lines = t(`${BASE}.${key}.lines`, { returnObjects: true }) as
    | Record<string, string>
    | string;
  if (!lines || typeof lines !== "object") return null;
  const values = Object.values(lines).filter((value) => typeof value === "string");
  if (values.length === 0) return null;
  return values[stableHash(seed) % values.length];
}

/** A line whose optional part came out empty, tidied: no space before its punctuation. */
function tidy(text: string): string {
  return text
    .replace(/\s+([.,!?…])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * `caption` in words: a key event as the event feed tells it (with the assist
 * after a goal), a line of play from the first of its keys that has lines.
 * Null when there is nothing to say.
 */
export function captionText(
  caption: RadarCaption,
  snapshot: MatchSnapshot,
  t: TFunction,
  nameOf: (playerId: string | null) => string,
): CommentaryText | null {
  if (caption.kind === "event") {
    const told = getCommentary(caption.event, snapshot, t, nameOf);
    if (!told) return null;
    const assist = caption.assist
      ? pickLine(t, "assist", `${caption.event.minute}|assist|${caption.assist}`)
      : null;
    const line = assist
      ? `${told.line} ${interpolate(assist, { player: nameOf(caption.assist) })}`
      : told.line;
    return { headline: told.headline, line, side: caption.event.side };
  }
  const { tokens } = caption;
  const isHome = tokens.side === "Home";
  const values: Record<string, string> = {
    team: isHome ? snapshot.home_team.name : snapshot.away_team.name,
    opponent: isHome ? snapshot.away_team.name : snapshot.home_team.name,
    player: nameOf(tokens.player ?? null),
    receiver: nameOf(tokens.receiver ?? null),
    other: nameOf(tokens.other ?? null),
    flank: tokens.lane ? t(`${BASE}.flank.${tokens.lane}`) : "",
    minute: tokens.minute === undefined ? "" : String(tokens.minute),
    score: tokens.score ?? "",
  };
  for (const key of caption.keys) {
    const template = pickLine(t, key, caption.seed);
    if (template)
      return { headline: "", line: tidy(interpolate(template, values)), side: tokens.side };
  }
  return null;
}
