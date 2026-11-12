// The opponent profile's "Trend" block (C-23b, S-46b §5.4): its last matches counted from the play
// everyone could watch. Labels name what was seen on the pitch, never a tactics dial, and the
// block reads nothing into the figures (BR-6).

import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import type { TrendSideView, TrendView } from "../../api";
import { MUTED } from "./OpponentBlocks";
import { formatTenth } from "./opponentView";
import { goalRows, laneBars, styleRows, type TeamFigure, teamRows } from "./opponentTrend";

const HEAD =
  "w-24 py-1 pl-2 text-right align-bottom text-xs font-semibold uppercase text-gray-500 dark:text-gray-400";
const LABEL = "py-1.5 pr-2 text-left text-gray-700 dark:text-gray-300";
const FIGURE = "py-1.5 pl-2 text-right font-heading tabular-nums text-gray-900 dark:text-gray-100";

/** One part of the block: a small heading and what it names. */
function Part({ title, children }: { title: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <h4
        id={id}
        className="font-heading text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300"
      >
        {title}
      </h4>
      {children(id)}
    </div>
  );
}

/** A table with a column for the club and one for its opponents. */
function TwoSides({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <table aria-labelledby={labelledBy} className="w-full text-sm">
      <thead>
        <tr>
          <th scope="col" className="py-1">
            <span className="sr-only">{t("online.opponent.trend.what")}</span>
          </th>
          <th scope="col" className={HEAD}>
            {t("online.opponent.trend.them")}
          </th>
          <th scope="col" className={HEAD}>
            {t("online.opponent.trend.theirOpponents")}
          </th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Row({ label, team, against }: { label: string; team: string; against: string }) {
  return (
    <tr className="border-t border-gray-100 dark:border-navy-600">
      <th scope="row" className={`${LABEL} font-normal`}>
        {label}
      </th>
      <td className={FIGURE}>{team}</td>
      <td className={FIGURE}>{against}</td>
    </tr>
  );
}

function useFigure() {
  const { t, i18n } = useTranslation();
  const tenth = (value: number) => formatTenth(value, i18n.language);
  return (figure: TeamFigure, side: TrendSideView): string => {
    switch (figure) {
      case "possession":
        return t("online.opponent.trend.percent", { value: tenth(side.possessionPct) });
      case "shots":
        return t("online.opponent.trend.shotsValue", {
          shots: tenth(side.shots),
          onTarget: tenth(side.shotsOnTarget),
        });
      case "corners":
        return tenth(side.corners);
      case "fouls":
        return tenth(side.fouls);
      case "cards":
        return t("online.opponent.trend.cardsValue", {
          yellow: tenth(side.yellowCards),
          red: tenth(side.redCards),
        });
      case "passAccuracy":
        return t("online.opponent.trend.percent", { value: tenth(side.passAccuracy ?? 0) });
    }
  };
}

/** One side's three lanes of the final third, left to right, each with its share. */
function Lanes({ title, side }: { title: string; side: TrendSideView }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const bars = laneBars(side);
  if (!bars) return null;
  return (
    <div role="group" aria-labelledby={id} className="space-y-1">
      <p id={id} className="text-xs text-gray-600 dark:text-gray-300">
        {title}
      </p>
      {bars.map(({ lane, share }) => {
        const label = t(`online.opponent.trend.lane.${lane}`);
        const value = t("online.opponent.trend.percent", {
          value: formatTenth(share, i18n.language),
        });
        return (
          <div key={lane} className="flex items-center gap-2 text-xs">
            <span aria-hidden="true" className="w-14 shrink-0 text-gray-600 dark:text-gray-300">
              {label}
            </span>
            <div
              role="meter"
              aria-label={label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={share}
              aria-valuetext={value}
              className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-navy-600"
            >
              <div
                className="h-2 rounded-full bg-primary-500"
                style={{ width: `${Math.max(0, Math.min(100, share))}%` }}
              />
            </div>
            <span
              aria-hidden="true"
              className="w-12 shrink-0 text-right font-heading tabular-nums text-gray-800 dark:text-gray-100"
            >
              {value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The block itself: the team's figures, the goals by how they came, where it attacks and is
 * attacked, and the play seen per match. Drawn only when the server sent a trend.
 */
export function TrendBlock({ trend }: { trend: TrendView }) {
  const { t, i18n } = useTranslation();
  const figure = useFigure();
  const goals = goalRows(trend);
  const style = styleRows(trend);
  const lanesShown = laneBars(trend.team) !== null || laneBars(trend.against) !== null;
  const perMatch = (value: number) =>
    t("online.opponent.trend.perMatch", { value: formatTenth(value, i18n.language) });
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 dark:text-gray-400">{t("online.opponent.trend.note")}</p>
      <Part title={t("online.opponent.trend.teamTitle")}>
        {(id) => (
          <TwoSides labelledBy={id}>
            {teamRows(trend).map((row) => (
              <Row
                key={row.figure}
                label={t(`online.opponent.trend.figure.${row.figure}`)}
                team={figure(row.figure, row.team)}
                against={figure(row.figure, row.against)}
              />
            ))}
          </TwoSides>
        )}
      </Part>
      <Part title={t("online.opponent.trend.goalsTitle")}>
        {(id) =>
          goals.length === 0 ? (
            <p className={MUTED}>{t("online.opponent.trend.noGoals")}</p>
          ) : (
            <table aria-labelledby={id} className="w-full text-sm">
              <thead>
                <tr>
                  <th scope="col" className="py-1">
                    <span className="sr-only">{t("online.opponent.trend.what")}</span>
                  </th>
                  <th scope="col" className={HEAD}>
                    {t("online.opponent.trend.scored")}
                  </th>
                  <th scope="col" className={HEAD}>
                    {t("online.opponent.trend.conceded")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {goals.map((row) => (
                  <Row
                    key={row.source}
                    label={t(`online.opponent.trend.source.${row.source}`)}
                    team={String(row.scored)}
                    against={String(row.conceded)}
                  />
                ))}
              </tbody>
            </table>
          )
        }
      </Part>
      {lanesShown && (
        <Part title={t("online.opponent.trend.lanesTitle")}>
          {() => (
            <div className="grid gap-3 sm:grid-cols-2">
              <Lanes title={t("online.opponent.trend.attacking")} side={trend.team} />
              <Lanes title={t("online.opponent.trend.attacked")} side={trend.against} />
            </div>
          )}
        </Part>
      )}
      {style.length > 0 && (
        <Part title={t("online.opponent.trend.styleTitle")}>
          {(id) => (
            <TwoSides labelledBy={id}>
              {style.map((row) => (
                <Row
                  key={row.behaviour}
                  label={t(`online.opponent.trend.behaviour.${row.behaviour}`)}
                  team={perMatch(row.team)}
                  against={perMatch(row.against)}
                />
              ))}
            </TwoSides>
          )}
        </Part>
      )}
    </div>
  );
}
