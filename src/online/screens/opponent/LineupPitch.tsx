import { buildPitchRows, getPitchSlotWidth } from "../../../components/squad/SquadTab.helpers";
import { PitchSurface } from "../../../components/ui";
import type { ProjectedPlayer } from "../../api";
import { PlayerLink } from "./PlayerLink";

const TOKEN_LINK =
  "flex flex-col items-center rounded focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-primary-700";

/** Where each slot of `formation` stands, in percent of the pitch: slot `i` is entry `i`. */
export function slotPlaces(formation: string): { top: string; left: string }[] {
  return buildPitchRows(formation).flatMap((row) => {
    const count = row.positions.length;
    const width = getPitchSlotWidth(count);
    return row.positions.map((_, index) => {
      const left = count > 1 ? 50 - width / 2 + (index * width) / (count - 1) : 50;
      return { top: row.y, left: `${left}%` };
    });
  });
}

/**
 * A side's eleven on an upright pitch, as the phone's tactics board lays a shape out (C-23a §6.3):
 * slot `i` stands where the formation's slot `i` does. Each token opens the player's page; nothing
 * is dragged or picked here.
 */
export function LineupPitch({
  eleven,
  formation,
}: {
  eleven: readonly ProjectedPlayer[];
  formation: string;
}) {
  const places = slotPlaces(formation);
  return (
    <PitchSurface className="aspect-[100/140] w-full">
      <ol>
        {eleven.map((player) => {
          const place = places[player.slot ?? -1];
          if (!place) return null;
          return (
            <li
              key={player.id}
              className="absolute w-16 -translate-x-1/2 -translate-y-1/2 text-center"
              style={place}
            >
              <PlayerLink id={player.id} className={TOKEN_LINK}>
                <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-navy-800 font-heading text-sm font-bold text-white">
                  {player.ovr}
                </span>
                <span className="mt-0.5 max-w-full truncate rounded bg-navy-900/70 px-1 text-[10px] font-semibold text-white">
                  {player.matchName}
                </span>
              </PlayerLink>
            </li>
          );
        })}
      </ol>
    </PitchSurface>
  );
}
