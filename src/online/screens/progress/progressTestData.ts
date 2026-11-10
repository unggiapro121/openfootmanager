import type { FixtureProgressView, PlayerProgressLine } from "../../api";

/** A player's line that played 90 minutes and changed nothing, with `extra` over it. */
export function progressLine(
  playerId: string,
  name: string,
  extra: Partial<PlayerProgressLine> = {},
): PlayerProgressLine {
  return {
    playerId,
    name,
    minutes: 90,
    rating: 6.5,
    ovrBefore: 60,
    ovrAfter: 60,
    trainedSince: [],
    formBefore: 60,
    formAfter: 60,
    moraleBefore: 70,
    moraleAfter: 70,
    ...extra,
  };
}

/** A settled league match of club-1 with `players`. */
export function progressView(players: PlayerProgressLine[], settled = true): FixtureProgressView {
  return { fixtureId: "fixture-1", clubId: "club-1", settled, players };
}
