import { useTranslation } from "react-i18next";
import { Star } from "lucide-react";

import type { FixtureDetailData } from "../../services/matchDetailService";
import { translatePositionAbbreviation } from "../squad/SquadTab.helpers";
import { getEventDisplay } from "./helpers";
import { QuickStat } from "./PostMatchHelpers";
import type { MatchEvent } from "./types";
import {
  eventLabel,
  lineupFor,
  manOfTheMatchId,
  playerLinesForSide,
  playerNameOf,
  type Side,
  teamStatsFor,
} from "./MatchDetail.helpers";

const SECTION_TITLE =
  "mb-3 text-xs font-heading font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400";
const PANEL =
  "rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-navy-700 dark:bg-navy-800";
const NAME_BUTTON =
  "rounded text-left hover:text-primary-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:text-primary-400";

interface SectionProps {
  detail: FixtureDetailData;
  onSelectPlayer?: (playerId: string) => void;
}

function PlayerName({
  playerId,
  name,
  onSelectPlayer,
}: {
  playerId: string;
  name: string;
  onSelectPlayer?: (playerId: string) => void;
}) {
  if (!onSelectPlayer) return <span>{name}</span>;
  return (
    <button type="button" className={NAME_BUTTON} onClick={() => onSelectPlayer(playerId)}>
      {name}
    </button>
  );
}

/** Scorers, the key events and, for an unplayed or stat-less fixture, why there is no more. */
export function MatchDetailOverview({ detail, onSelectPlayer }: SectionProps) {
  const { t } = useTranslation();
  const nameOf = playerNameOf(detail);
  const result = detail.result;
  if (!result) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">{t("match.notPlayedYet")}</p>;
  }
  const report = result.report;
  const scorers = [
    ...result.home_scorers.map((goal) => ({ ...goal, team: detail.homeTeamName })),
    ...result.away_scorers.map((goal) => ({ ...goal, team: detail.awayTeamName })),
  ].sort((a, b) => a.minute - b.minute);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className={PANEL}>
        <h4 className={SECTION_TITLE}>{t("match.scorers")}</h4>
        {scorers.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
            {scorers.map((goal) => (
              <li key={`${goal.player_id}-${goal.minute}`}>
                <PlayerName
                  playerId={goal.player_id}
                  name={`${nameOf(goal.player_id) ?? t("common.unknown")} ${goal.minute}'`}
                  onSelectPlayer={onSelectPlayer}
                />{" "}
                <span className="text-xs text-gray-500 dark:text-gray-400">({goal.team})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("match.noGoals")}</p>
        )}
      </section>
      <section className={PANEL}>
        <h4 className={SECTION_TITLE}>{t("match.matchEvents")}</h4>
        {!report ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("match.noDetailedStats")}</p>
        ) : report.events.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("match.quietMatch")}</p>
        ) : (
          <ul className="flex max-h-80 flex-col gap-1.5 overflow-auto text-xs">
            {report.events.map((event, index) => {
              const display = getEventDisplay({ ...event, zone: "Midfield" } as MatchEvent);
              return (
                <li key={`${event.minute}-${event.event_type}-${index}`} className="flex gap-2">
                  <span className="w-8 shrink-0 text-right font-heading tabular-nums text-gray-500 dark:text-gray-400">
                    {event.minute}'
                  </span>
                  <span role="img" aria-label={t(`match.eventTypes.${event.event_type}`)}>
                    {display.icon}
                  </span>
                  <span className={`${display.color} flex-1 font-medium`}>
                    {eventLabel(event, nameOf, t)}
                  </span>
                  <span className="shrink-0 text-gray-500 dark:text-gray-400">
                    {event.side === "Home" ? detail.homeTeamName : detail.awayTeamName}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Both sides' team figures side by side. */
export function MatchDetailStats({ detail }: SectionProps) {
  const { t } = useTranslation();
  const report = detail.result?.report;
  if (!report) return null;
  const home = teamStatsFor(detail, "home");
  const away = teamStatsFor(detail, "away");
  return (
    <section className={PANEL}>
      <h4 className={SECTION_TITLE}>{t("match.stats")}</h4>
      <div className="mb-2 flex justify-between gap-4 text-xs font-heading font-bold uppercase tracking-wider">
        <span className="text-primary-700 dark:text-primary-400">{detail.homeTeamName}</span>
        <span className="text-right text-indigo-700 dark:text-indigo-400">
          {detail.awayTeamName}
        </span>
      </div>
      <QuickStat
        label={t("match.possession")}
        home={`${report.home_stats.possession_pct}%`}
        away={`${report.away_stats.possession_pct}%`}
        homePct={report.home_stats.possession_pct}
      />
      <QuickStat
        label={t("match.shots")}
        home={report.home_stats.shots}
        away={report.away_stats.shots}
      />
      <QuickStat
        label={t("match.shotsOnTarget")}
        home={report.home_stats.shots_on_target}
        away={report.away_stats.shots_on_target}
      />
      {home && away ? (
        <>
          <QuickStat
            label={t("teamProfile.passes")}
            home={home.passesCompleted}
            away={away.passesCompleted}
          />
          <QuickStat
            label={t("teamProfile.tacklesWon")}
            home={home.tacklesWon}
            away={away.tacklesWon}
          />
          <QuickStat
            label={t("teamProfile.interceptions")}
            home={home.interceptions}
            away={away.interceptions}
          />
        </>
      ) : null}
      <QuickStat
        label={t("match.fouls")}
        home={report.home_stats.fouls}
        away={report.away_stats.fouls}
      />
      <QuickStat
        label={t("match.corners")}
        home={report.home_stats.corners}
        away={report.away_stats.corners}
      />
      <QuickStat
        label={t("match.yellowCards")}
        home={report.home_stats.yellow_cards}
        away={report.away_stats.yellow_cards}
      />
      <QuickStat
        label={t("match.redCards")}
        home={report.home_stats.red_cards}
        away={report.away_stats.red_cards}
      />
    </section>
  );
}

/** Each side's kick-off formation, starters by slot and bench. */
export function MatchDetailLineups({ detail, onSelectPlayer }: SectionProps) {
  const { t } = useTranslation();
  const nameOf = playerNameOf(detail);
  const sides: { side: Side; team: string }[] = [
    { side: "home", team: detail.homeTeamName },
    { side: "away", team: detail.awayTeamName },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {sides.map(({ side, team }) => {
        const lineup = lineupFor(detail, side);
        if (!lineup) return null;
        return (
          <section key={side} className={PANEL}>
            <h4 className={SECTION_TITLE}>{team}</h4>
            <p className="mb-3 text-sm text-gray-700 dark:text-gray-300">
              <span className="font-heading font-bold">{lineup.formation}</span> ·{" "}
              {t(`common.playStyles.${lineup.play_style}`, { defaultValue: lineup.play_style })}
            </p>
            <h5 className={SECTION_TITLE}>{t("match.startingXI")}</h5>
            <ul className="mb-3 flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
              {lineup.starters.map((slot) => (
                <li key={slot.player_id} className="flex gap-2">
                  <span className="w-9 shrink-0 font-heading font-bold text-gray-500 dark:text-gray-400">
                    {translatePositionAbbreviation(t, slot.position)}
                  </span>
                  <PlayerName
                    playerId={slot.player_id}
                    name={nameOf(slot.player_id) ?? t("common.unknown")}
                    onSelectPlayer={onSelectPlayer}
                  />
                </li>
              ))}
            </ul>
            {lineup.bench.length > 0 ? (
              <>
                <h5 className={SECTION_TITLE}>{t("match.substitutes")}</h5>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {lineup.bench.map((id) => nameOf(id) ?? t("common.unknown")).join(", ")}
                </p>
              </>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/** Each side's players with minutes, goals, assists, shots, passes and rating. */
export function MatchDetailPlayers({ detail, onSelectPlayer }: SectionProps) {
  const { t } = useTranslation();
  const motm = manOfTheMatchId(detail);
  const sides: { side: Side; team: string }[] = [
    { side: "home", team: detail.homeTeamName },
    { side: "away", team: detail.awayTeamName },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {sides.map(({ side, team }) => (
        <section key={side} className={PANEL}>
          <h4 className={SECTION_TITLE}>{team}</h4>
          <table className="w-full text-left text-xs text-gray-700 dark:text-gray-300">
            <thead className="text-gray-500 dark:text-gray-400">
              <tr>
                <th scope="col" className="py-1 font-heading">
                  {t("match.player")}
                </th>
                <th scope="col" className="py-1 text-right font-heading">
                  {t("playerProfile.mins")}
                </th>
                <th scope="col" className="py-1 text-right font-heading">
                  {t("playerProfile.goals")}
                </th>
                <th scope="col" className="py-1 text-right font-heading">
                  {t("playerProfile.assists")}
                </th>
                <th scope="col" className="py-1 text-right font-heading">
                  {t("match.shots")}
                </th>
                <th scope="col" className="py-1 text-right font-heading">
                  {t("playerProfile.passes")}
                </th>
                <th scope="col" className="py-1 text-right font-heading">
                  {t("playerProfile.recentMatchesRating")}
                </th>
              </tr>
            </thead>
            <tbody>
              {playerLinesForSide(detail, side).map((line) => (
                <tr key={line.playerId} className="border-t border-gray-200 dark:border-navy-700">
                  <td className="py-1">
                    <span className="mr-1.5 font-heading font-bold text-gray-500 dark:text-gray-400">
                      {line.position ? translatePositionAbbreviation(t, line.position) : ""}
                    </span>
                    <PlayerName
                      playerId={line.playerId}
                      name={line.name ?? t("common.unknown")}
                      onSelectPlayer={onSelectPlayer}
                    />
                    {line.playerId === motm ? (
                      <Star
                        className="ml-1 inline h-3 w-3 fill-accent-400 text-accent-500"
                        role="img"
                        aria-label={t("match.motm")}
                      />
                    ) : null}
                  </td>
                  <td className="py-1 text-right tabular-nums">{line.minutesPlayed}</td>
                  <td className="py-1 text-right tabular-nums">{line.goals}</td>
                  <td className="py-1 text-right tabular-nums">{line.assists}</td>
                  <td className="py-1 text-right tabular-nums">{line.shots}</td>
                  <td className="py-1 text-right tabular-nums">
                    {line.passesCompleted}/{line.passesAttempted}
                  </td>
                  <td className="py-1 text-right font-heading font-bold tabular-nums">
                    {line.rating.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
