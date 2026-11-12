import { useTranslation } from "react-i18next";
import { PitchSurface, pitchRoleMarkers } from "../../../../components/ui";
import type { OpponentReportContent, OpponentReportLive, ReportPlayer } from "../../../api";
import { slotPlaces } from "../LineupPitch";
import { BAND_DOT, dutiesOf, liveMarks, tokenName, tokenOvr } from "./reportParts";

const TOKEN =
  "flex w-16 flex-col items-center rounded focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-primary-700";

/**
 * The side a report shows, read-only (C-24 C24-2): its eleven on an upright pitch where each slot
 * stands on the tactics board, and its bench beside or below. Each man shows his shirt number,
 * his OVR in his slot, his band's dot and his duties; picking him opens his attributes. Nothing
 * is dragged here, and no figure of condition, morale or role is drawn, as the report has none.
 */
export default function OpponentReportBoard({
  content,
  live,
  onPick,
}: {
  content: OpponentReportContent;
  live: OpponentReportLive | undefined;
  onPick: (player: ReportPlayer) => void;
}) {
  const { t } = useTranslation();
  const places = slotPlaces(content.formation);
  const duties = dutiesOf(content);
  return (
    // The block is narrow beside the profile's other cards on a wide window: the bench goes
    // beside the pitch only where the block itself has room for both, as on the report's page.
    <div className="@container">
      <div className="grid gap-4 @2xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <PitchSurface className="aspect-[100/140] w-full">
          <ol aria-label={t("online.opponentReport.eleven")}>
            {content.eleven.map((player) => {
              const place = places[player.slot ?? -1];
              if (!place) return null;
              const changed = liveMarks(t, live, player.id).length > 0;
              return (
                <li
                  key={player.id}
                  className="absolute -translate-x-1/2 -translate-y-1/2 text-center"
                  style={place}
                >
                  <button
                    type="button"
                    aria-label={tokenName(t, player, live)}
                    onClick={() => onPick(player)}
                    className={TOKEN}
                  >
                    <span className="relative flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-navy-800 font-heading text-sm font-bold text-white dark:bg-navy-900">
                      {tokenOvr(player)}
                      {player.shirtNumber !== undefined && (
                        <span className="absolute -left-2 -top-1.5 rounded bg-white px-1 text-[9px] font-bold leading-tight text-navy-900 dark:bg-gray-100">
                          {player.shirtNumber}
                        </span>
                      )}
                      <span
                        aria-hidden="true"
                        className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-white ${BAND_DOT[player.conditionBand]}`}
                      />
                      {changed && (
                        <span
                          aria-hidden="true"
                          className="absolute -bottom-1 -right-1.5 rounded-full bg-red-600 px-1 text-[9px] font-bold leading-tight text-white"
                        >
                          !
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 max-w-full truncate rounded bg-navy-900/70 px-1 text-[10px] font-semibold text-white">
                      {player.fullName}
                    </span>
                    <Duties playerId={player.id} duties={duties} />
                  </button>
                </li>
              );
            })}
          </ol>
        </PitchSurface>
        <div>
          <h4 className="mb-2 font-heading text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t("online.opponentReport.bench")}
          </h4>
          <ul aria-label={t("online.opponentReport.bench")} className="space-y-1">
            {content.bench.map((player) => (
              <li key={player.id}>
                <button
                  type="button"
                  aria-label={tokenName(t, player, live)}
                  onClick={() => onPick(player)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-gray-800 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-gray-100 dark:hover:bg-navy-700 dark:focus:ring-offset-navy-800"
                >
                  <span className="w-6 shrink-0 text-right text-xs tabular-nums text-gray-500 dark:text-gray-400">
                    {player.shirtNumber ?? ""}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${BAND_DOT[player.conditionBand]}`}
                  />
                  <span className="min-w-0 flex-1 truncate">{player.fullName}</span>
                  <span className="font-heading font-bold tabular-nums">{tokenOvr(player)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** A man's duties as the tactics board marks them: C, PK, FK, CK. */
function Duties({ playerId, duties }: { playerId: string; duties: ReturnType<typeof dutiesOf> }) {
  const markers = pitchRoleMarkers(duties, playerId).slice(0, 3);
  if (markers.length === 0) return null;
  return (
    <span aria-hidden="true" className="mt-0.5 flex gap-0.5">
      {markers.map((marker) => (
        <span
          key={marker.key}
          className={`rounded px-1 text-[9px] font-bold leading-tight ${marker.fillClassName}`}
        >
          {marker.shortLabel}
        </span>
      ))}
    </span>
  );
}
