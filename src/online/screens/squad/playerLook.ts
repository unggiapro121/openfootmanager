import type { SquadPlayerView } from "../../api";

/** The pictures coaches sent for their players, by player id: data URLs the game shows as faces. */
export type PlayerPictures = Readonly<Record<string, string>>;

/**
 * What a player's portrait is drawn from, the same wherever he shows: his id and names and
 * nationality, the face his coach picked from the pool (a seed), and the picture of his own the
 * coach sent, which comes before any face.
 */
export function avatarOf(
  player: Pick<SquadPlayerView, "id" | "fullName" | "matchName" | "nationality" | "avatarSeed">,
  pictures: PlayerPictures = {},
) {
  const picture = pictures[player.id];
  return {
    id: player.id,
    full_name: player.fullName,
    match_name: player.matchName,
    nationality: player.nationality,
    portrait_seed: player.avatarSeed ?? null,
    ...(picture ? { media: { face: picture } } : {}),
  };
}
