import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LeadersView } from "../../api";
import { online } from "../../client";
import { tracked } from "../../store/onlineStore";
import { useOnlineResource } from "../../useOnlineResource";
import ResourceState from "../ResourceState";
import { rankLeaders, tiedWithFirst } from "./leagueView";
import { FOCUS } from "./phoneLeagueLook";
import { onTablistKeyDown, tabIndexOf } from "../mobile/tablistKeys";

const KEY = "online.league.phone";

/** The league's boards, as chips: each with its title, its unit, and a card colour for the cards. */
const CATEGORIES: Array<{
  id: keyof LeadersView;
  chip: string;
  title: string;
  unit: string;
  swatch?: string;
}> = [
  {
    id: "goals",
    chip: `${KEY}.catGoals`,
    title: "tournaments.topScorers",
    unit: `${KEY}.unitGoals`,
  },
  {
    id: "assists",
    chip: `${KEY}.catAssists`,
    title: "tournaments.topAssists",
    unit: `${KEY}.unitAssists`,
  },
  {
    id: "cleanSheets",
    chip: `${KEY}.catCleanSheets`,
    title: "tournaments.topCleanSheets",
    unit: `${KEY}.unitMatches`,
  },
  {
    id: "yellowCards",
    chip: `${KEY}.catYellow`,
    title: "tournaments.mostYellowCards",
    unit: `${KEY}.unitCards`,
    swatch: "bg-yellow-400",
  },
  {
    id: "redCards",
    chip: `${KEY}.catRed`,
    title: "tournaments.mostRedCards",
    unit: `${KEY}.unitCards`,
    swatch: "bg-red-500",
  },
];

/** Initials for the leader's medallion, from his name. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/**
 * Who leads the league on a phone (design m-giai-dau): a board at a time, its leader on a card
 * (with how many share the lead), the rest under it, and a switch to see the coach's own players
 * only.
 */
export default function PhoneLeagueStats({
  leagueId,
  myClub,
}: {
  leagueId: string;
  myClub: { id: string; name: string } | null;
}) {
  const { t } = useTranslation();
  const [categoryId, setCategoryId] = useState<keyof LeadersView>("goals");
  const [mineOnly, setMineOnly] = useState(false);
  const { resource, reload } = useOnlineResource(
    () => tracked(() => online.leagues.leaders(leagueId)),
    [leagueId],
  );
  const category = CATEGORIES.find((one) => one.id === categoryId) ?? CATEGORIES[0];

  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        onKeyDown={onTablistKeyDown}
        aria-label={t(`${KEY}.statsCategories`)}
        className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]"
      >
        {CATEGORIES.map((one) => {
          const on = one.id === categoryId;
          return (
            <button
              key={one.id}
              type="button"
              role="tab"
              aria-selected={on}
              tabIndex={tabIndexOf(on)}
              onClick={() => setCategoryId(one.id)}
              className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold ${on ? "border-primary-500 bg-primary-50 text-primary-800 dark:bg-primary-900/40 dark:text-primary-300" : "border-gray-200 bg-white text-gray-700 dark:border-navy-700 dark:bg-navy-800 dark:text-gray-200"} ${FOCUS}`}
            >
              {one.swatch && (
                <span aria-hidden="true" className={`h-[13px] w-2.5 rounded-[2px] ${one.swatch}`} />
              )}
              {t(one.chip)}
            </button>
          );
        })}
      </div>
      <ResourceState resource={resource} reload={reload}>
        {(leaders) => {
          const ranked = rankLeaders(leaders[category.id]).filter(
            (line) => !mineOnly || line.clubId === myClub?.id,
          );
          const [lead, ...rest] = ranked;
          if (!lead) {
            return (
              <p className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-[13px] text-gray-500 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-400">
                {t(`${KEY}.noData`)}
              </p>
            );
          }
          const ownTone = (clubId: string) =>
            clubId === myClub?.id
              ? "text-primary-700 dark:text-primary-400"
              : "text-gray-500 dark:text-gray-400";
          const tied = tiedWithFirst(ranked);
          return (
            <>
              <section
                aria-label={t(`${KEY}.leader`)}
                className="flex items-center gap-3.5 rounded-2xl border border-accent-300 bg-accent-50 p-3.5 dark:border-accent-900 dark:bg-accent-900/20"
              >
                <span
                  aria-hidden="true"
                  className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-accent-400 bg-white font-heading text-lg font-bold text-gray-900 dark:bg-navy-700 dark:text-white"
                >
                  {initials(lead.name)}
                  <span className="absolute -right-1.5 -top-2 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-accent-400 text-xs text-navy-900">
                    1
                  </span>
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[11px] uppercase tracking-wider text-accent-800 dark:text-accent-300">
                    {t(category.title)}
                  </span>
                  <span className="truncate text-[17px] font-bold text-gray-900 dark:text-white">
                    {lead.name}
                  </span>
                  <span className={`text-xs ${ownTone(lead.clubId)}`}>
                    <span>{lead.clubName}</span>
                    {tied > 0 && <span> · {t(`${KEY}.tiedWith`, { count: tied })}</span>}
                  </span>
                </span>
                <span className="flex flex-col items-center">
                  <span className="font-heading text-[40px] font-bold leading-none text-accent-700 dark:text-accent-400">
                    {lead.value}
                  </span>
                  <span className="text-[11px] text-gray-600 dark:text-gray-400">
                    {t(category.unit)}
                  </span>
                </span>
              </section>
              {rest.length > 0 && (
                <ol className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800">
                  {rest.map((line) => (
                    <li
                      key={line.playerId}
                      className={`grid min-h-[52px] grid-cols-[22px_minmax(0,1fr)_40px] items-center gap-2.5 border-t border-gray-200 px-3.5 py-2 first:border-t-0 dark:border-navy-700 ${line.clubId === myClub?.id ? "bg-primary-50 dark:bg-primary-900/20" : ""}`}
                    >
                      <span className="text-right font-heading text-[15px] font-bold text-gray-500 dark:text-gray-400">
                        {line.rank}
                      </span>
                      <span className="flex min-w-0 flex-col gap-px">
                        <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                          {line.name}
                        </span>
                        <span className={`truncate text-xs ${ownTone(line.clubId)}`}>
                          {line.clubName}
                        </span>
                      </span>
                      <span className="text-right font-heading text-xl font-bold text-accent-700 dark:text-accent-400">
                        {line.value}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          );
        }}
      </ResourceState>
      {myClub && (
        <div className="flex min-h-11 items-center gap-2.5 text-[13px] text-gray-700 dark:text-gray-200">
          <button
            type="button"
            role="switch"
            aria-checked={mineOnly}
            aria-label={t(`${KEY}.mineOnly`, { club: myClub.name })}
            onClick={() => setMineOnly(!mineOnly)}
            className={`flex h-6 w-10 shrink-0 rounded-full p-0.5 ${mineOnly ? "justify-end bg-primary-500" : "justify-start bg-gray-300 dark:bg-navy-600"} ${FOCUS}`}
          >
            <span className="h-5 w-5 rounded-full bg-white" />
          </button>
          <span aria-hidden="true">{t(`${KEY}.mineOnly`, { club: myClub.name })}</span>
        </div>
      )}
    </div>
  );
}
