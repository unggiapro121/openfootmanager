import { useEffect, useState } from "react";
import type { PlayerLine } from "../api";
import { online } from "../client";

/** The best-rated player of a settled fixture, the man of the match; none before the ratings. */
export function manOfTheMatch(lines: PlayerLine[]): PlayerLine | undefined {
  return lines
    .filter((line) => line.rating > 0)
    .sort((left, right) => right.rating - left.rating)[0];
}

/** How long to wait before asking again for the lines of a fixture not settled yet. */
const RETRY_MS = 5000;
/** How many times to ask: the server settles a fixture a moment after its last frame. */
const TRIES = 6;

/**
 * The players' lines of `fixtureId` (D-FT3, analysis-mobile-fulltime): asked when a match ends,
 * then again a few times while the server has not settled it, without ever holding up the screen
 * that shows them. None for a match with no fixture (a friendly), or when the lines never come.
 */
export function useFixtureLines(fixtureId: string | undefined): PlayerLine[] {
  const [lines, setLines] = useState<PlayerLine[]>([]);
  useEffect(() => {
    if (!fixtureId) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = (tries: number) => {
      online.fixtures
        .byId(fixtureId)
        .then((detail) => detail.players)
        // A failed read is a fixture not readable yet: the result shows without its ratings.
        .catch((): PlayerLine[] => [])
        .then((players) => {
          if (!current) return;
          if (players.length > 0) setLines(players);
          else if (tries > 1) timer = setTimeout(() => ask(tries - 1), RETRY_MS);
        });
    };
    ask(TRIES);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [fixtureId]);
  return lines;
}
