/**
 * Whether a player of `position` trains the keepers' own drill in a season where it is
 * `keeperDrill` (C-16, from E5-6c's `TrainingDayView.keeperDrill`). The engine gives the drill to
 * players whose primary position is a keeper's, so a keeper is the one who trains it; the server
 * never says how much.
 */
export function trainsKeeperDrill(position: string, keeperDrill: boolean | undefined): boolean {
  return keeperDrill === true && position === "Goalkeeper";
}
