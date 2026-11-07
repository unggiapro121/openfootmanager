import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardBody, CardHeader } from "../../../components/ui";
import { usePhoneLayout } from "../../../hooks/usePhoneLayout";
import { formatExactMoney } from "../../../lib/valueFormatting";
import type { AwardView, ClubRecordsView, ClubSeasonView } from "../../api";
import { awardName, awardValue, coachName } from "./honoursText";
import { MedalIcon } from "./TrophyIcon";

const MUTED = "text-sm text-gray-600 dark:text-gray-300";

/** The club's players' awards and champion's medals, newest first (C20-2). */
export function AwardsCard({ awards }: { awards: AwardView[] }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>{t("online.honours.awardsTitle")}</CardHeader>
      <CardBody>
        {awards.length === 0 ? (
          <p className={MUTED}>{t("online.honours.noAwards")}</p>
        ) : (
          <AwardList awards={awards} showClub={false} />
        )}
      </CardBody>
    </Card>
  );
}

/** Awards as a list, each with its season and level; a player's page also names the club. */
export function AwardList({ awards, showClub }: { awards: AwardView[]; showClub: boolean }) {
  const { t } = useTranslation();
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {awards.map((award) => (
        <li key={award.id} className="flex items-center gap-3">
          <MedalIcon level={award.place.level} className="h-8 w-8 shrink-0" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-gray-900 dark:text-gray-100">
              {awardName(t, award.kind)}
              {!showClub && <span className="font-normal"> · {award.playerName}</span>}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("online.honours.awardPlace", {
                level: award.place.level,
                season: award.place.seasonNumber,
                value: awardValue(t, award.kind, award.value, award.matches),
              })}
              {showClub && ` · ${award.club.name}`}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Each season the club played: a table on a desktop, a card a season on a phone (C20-2). */
export function SeasonsCard({ seasons }: { seasons: ClubSeasonView[] }) {
  const { t } = useTranslation();
  const phone = usePhoneLayout();
  return (
    <Card>
      <CardHeader>{t("online.honours.seasonsTitle")}</CardHeader>
      {seasons.length === 0 ? (
        <CardBody>
          <p className={MUTED}>{t("online.honours.noSeasons")}</p>
        </CardBody>
      ) : phone ? (
        <CardBody>
          <ul className="flex flex-col gap-2">
            {seasons.map((season) => (
              <li
                key={season.place.seasonNumber}
                className="rounded-lg border border-gray-200 p-3 text-sm dark:border-navy-600"
              >
                <p className="flex items-center justify-between font-semibold text-gray-900 dark:text-gray-100">
                  <span>{t("online.honours.season", { season: season.place.seasonNumber })}</span>
                  <SeasonMark season={season} />
                </p>
                <p className="text-gray-600 dark:text-gray-300">
                  {t("online.honours.seasonLine", {
                    league: season.leagueName,
                    position: season.position,
                    points: season.points,
                  })}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {coachName(t, season.coach)}
                </p>
              </li>
            ))}
          </ul>
        </CardBody>
      ) : (
        <div className="overflow-x-auto">
          <SeasonsTable seasons={seasons} />
        </div>
      )}
    </Card>
  );
}

function SeasonsTable({ seasons }: { seasons: ClubSeasonView[] }) {
  const { t } = useTranslation();
  const head = "px-3 py-2 font-heading text-xs font-bold uppercase tracking-wider";
  const cell = "px-3 py-2";
  return (
    <table className="w-full text-left text-sm text-gray-700 dark:text-gray-300">
      <thead className="border-b border-gray-200 text-gray-500 dark:border-navy-600 dark:text-gray-400">
        <tr>
          <th scope="col" className={head}>
            {t("online.honours.col.season")}
          </th>
          <th scope="col" className={head}>
            {t("online.honours.col.league")}
          </th>
          <th scope="col" className={`${head} text-right`}>
            {t("online.honours.col.position")}
          </th>
          <th scope="col" className={`${head} text-right`}>
            {t("online.honours.col.record")}
          </th>
          <th scope="col" className={`${head} text-right`}>
            {t("online.honours.col.goals")}
          </th>
          <th scope="col" className={`${head} text-right`}>
            {t("common.pts")}
          </th>
          <th scope="col" className={head}>
            {t("online.honours.col.coach")}
          </th>
          <th scope="col" className={head}>
            {t("online.honours.col.scorer")}
          </th>
        </tr>
      </thead>
      <tbody>
        {seasons.map((season) => (
          <tr
            key={season.place.seasonNumber}
            className="border-b border-gray-100 dark:border-navy-700"
          >
            <td className={`${cell} font-semibold text-gray-900 dark:text-gray-100`}>
              <span className="flex items-center gap-2">
                {season.place.seasonNumber}
                <SeasonMark season={season} />
              </span>
            </td>
            <td className={cell}>{season.leagueName}</td>
            <td className={`${cell} text-right tabular-nums`}>{season.position}</td>
            <td className={`${cell} text-right tabular-nums`}>
              {season.won}-{season.drawn}-{season.lost}
            </td>
            <td className={`${cell} text-right tabular-nums`}>
              {season.goalsFor}:{season.goalsAgainst}
            </td>
            <td className={`${cell} text-right font-heading font-bold tabular-nums`}>
              {season.points}
            </td>
            <td className={cell}>{coachName(t, season.coach)}</td>
            <td className={cell}>
              {season.topScorer && `${season.topScorer.name} (${season.topScorer.goals})`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A champion's or a promoted season's mark. */
function SeasonMark({ season }: { season: ClubSeasonView }) {
  const { t } = useTranslation();
  if (!season.champion && !season.promoted) return null;
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${
        season.champion
          ? "bg-accent-100 text-accent-800 dark:bg-accent-900/40 dark:text-accent-300"
          : "bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300"
      }`}
    >
      {t(season.champion ? "online.honours.champion" : "online.honours.promoted")}
    </span>
  );
}

/** The club's records, those its seasons gave (C20-2, S-42 §3.8). */
export function RecordsCard({ records }: { records: ClubRecordsView }) {
  const { t } = useTranslation();
  const lines = recordLines(t, records);
  return (
    <Card>
      <CardHeader>{t("online.honours.recordsTitle")}</CardHeader>
      <CardBody>
        {lines.length === 0 ? (
          <p className={MUTED}>{t("online.honours.noRecords")}</p>
        ) : (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {lines.map(([label, value]) => (
              <div key={label} className="flex flex-col">
                <dt className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {label}
                </dt>
                <dd className="font-semibold text-gray-900 dark:text-gray-100">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardBody>
    </Card>
  );
}

function recordLines(t: TFunction, records: ClubRecordsView): Array<[string, ReactNode]> {
  const label = (key: string) => t(`online.honours.records.${key}`);
  const lines: Array<[string, ReactNode]> = [];
  const { highestLevel, bestFinish, mostPoints, biggestWin, worstDefeat } = records;
  if (highestLevel) {
    lines.push([
      label("highestLevel"),
      t("online.honours.recordValue.highestLevel", {
        level: highestLevel.value,
        season: highestLevel.seasonNumber,
      }),
    ]);
  }
  if (bestFinish) {
    lines.push([
      label("bestFinish"),
      t("online.honours.recordValue.bestFinish", {
        position: bestFinish.value,
        level: bestFinish.level,
        season: bestFinish.seasonNumber,
      }),
    ]);
  }
  if (mostPoints) {
    lines.push([
      label("mostPoints"),
      t("online.honours.recordValue.mostPoints", {
        points: mostPoints.value,
        season: mostPoints.seasonNumber,
      }),
    ]);
  }
  for (const [key, match] of [
    ["biggestWin", biggestWin],
    ["worstDefeat", worstDefeat],
  ] as const) {
    if (match) {
      lines.push([
        label(key),
        t("online.honours.recordValue.match", {
          scored: match.goalsFor,
          conceded: match.goalsAgainst,
          opponent: match.opponentName,
          season: match.seasonNumber,
        }),
      ]);
    }
  }
  if (records.topScorerSeason) {
    lines.push([
      label("topScorerSeason"),
      t("online.honours.recordValue.scorer", {
        name: records.topScorerSeason.playerName,
        goals: records.topScorerSeason.goals,
        season: records.topScorerSeason.seasonNumber,
      }),
    ]);
  }
  for (const [key, transfer] of [
    ["recordPurchase", records.recordPurchase],
    ["recordSale", records.recordSale],
  ] as const) {
    if (transfer) {
      lines.push([
        label(key),
        t("online.honours.recordValue.transfer", {
          name: transfer.playerName,
          price: formatExactMoney(transfer.price),
          season: transfer.seasonNumber,
        }),
      ]);
    }
  }
  if (records.longestCoach) {
    const run = records.longestCoach;
    lines.push([
      label("longestCoach"),
      t("online.honours.recordValue.coach", {
        name: coachName(t, run.coach),
        seasons: run.seasons,
        from: run.fromSeason,
        to: run.toSeason,
      }),
    ]);
  }
  return lines;
}
