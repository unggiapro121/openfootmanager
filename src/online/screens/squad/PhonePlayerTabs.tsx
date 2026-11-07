import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import {
  buildPlayerAttributeGroups,
  isGoalkeeper,
} from "../../../components/playerProfile/PlayerProfile.attributes";
import { PlayerAttributeRadarChart } from "../../../components/playerProfile/PlayerAttributeRadarChart";
import { TraitBadge } from "../../../components/TraitBadge";
import type { SquadPlayerView } from "../../api";
import { FOCUS } from "../mobile/PhoneSheet";
import PlayerPerformanceCards from "./PlayerPerformanceCards";
import { matchFormOf, seasonStatsOf } from "./playerPerformance";

export const KEY = "online.player.phone";

/** A value's tone, as the design grades attributes and meters. */
export function valueTone(value: number): { text: string; bar: string } {
  if (value >= 80) return { text: "text-primary-600 dark:text-primary-400", bar: "bg-primary-500" };
  if (value >= 60) return { text: "text-primary-700 dark:text-primary-300", bar: "bg-primary-300" };
  if (value >= 45) return { text: "text-accent-700 dark:text-accent-400", bar: "bg-accent-400" };
  return { text: "text-red-600 dark:text-red-400", bar: "bg-red-500" };
}

function Bar({ value, tone }: { value: number; tone: string }) {
  return (
    <span
      className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-navy-700"
      aria-hidden="true"
    >
      <span className={`block h-full ${tone}`} style={{ width: `${Math.min(100, value)}%` }} />
    </span>
  );
}

/**
 * The attributes tab: on the radar (the way every player page opens), or as groups the coach
 * opens and closes one by one.
 */
export function StatsTab({ player }: { player: SquadPlayerView }) {
  const { t } = useTranslation();
  const [view, setView] = useState<"list" | "radar">("radar");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const profile = {
    attributes: player.attributes,
    natural_position: player.naturalPosition,
    position: player.position,
  };
  const groups = buildPlayerAttributeGroups(profile, t);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {view === "list" ? t(`${KEY}.tapGroups`) : ""}
        </span>
        <div
          role="radiogroup"
          aria-label={t(`${KEY}.view`)}
          className="flex rounded-lg border border-gray-200 bg-gray-50 p-[3px] dark:border-navy-700 dark:bg-navy-900"
        >
          {(["list", "radar"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={view === id}
              onClick={() => setView(id)}
              className={`h-[30px] rounded-md px-3 text-xs font-semibold ${view === id ? "bg-primary-500 text-white dark:text-navy-900" : "text-gray-600 dark:text-gray-300"} ${FOCUS}`}
            >
              {t(id === "list" ? "common.listView" : "common.radarView")}
            </button>
          ))}
        </div>
      </div>
      {view === "radar" ? (
        <div className="rounded-xl border border-gray-200 bg-white px-1 py-2 dark:border-navy-700 dark:bg-navy-800">
          <PlayerAttributeRadarChart player={profile} isGk={isGoalkeeper(profile)} />
        </div>
      ) : (
        groups.map((group) => {
          const expanded = open[group.label] ?? false;
          const tone = valueTone(group.average);
          return (
            <section
              key={group.label}
              className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800"
            >
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen({ ...open, [group.label]: !expanded })}
                className={`grid min-h-12 w-full grid-cols-[minmax(0,1fr)_80px_32px_16px] items-center gap-2.5 px-3 text-left ${FOCUS}`}
              >
                <span className="font-heading text-[15px] font-bold uppercase tracking-wider text-gray-900 dark:text-white">
                  {group.label}
                </span>
                <Bar value={group.average} tone={tone.bar} />
                <strong className={`text-right font-heading text-lg tabular-nums ${tone.text}`}>
                  {group.average}
                </strong>
                <ChevronDown
                  className={`h-4 w-4 text-gray-400 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>
              {expanded && (
                <ul className="flex flex-col gap-2 border-t border-gray-200 px-3 py-2.5 dark:border-navy-700">
                  {group.attrs.map((attr) => {
                    const attrTone = valueTone(attr.value);
                    return (
                      <li
                        key={attr.name}
                        className="grid grid-cols-[minmax(0,1fr)_120px_28px] items-center gap-2.5 text-[13px]"
                      >
                        <span className="truncate text-gray-700 dark:text-gray-300">
                          {attr.name}
                        </span>
                        <Bar value={attr.value} tone={attrTone.bar} />
                        <strong className={`text-right tabular-nums ${attrTone.text}`}>
                          {attr.value}
                        </strong>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

/** The traits tab: each trait with what it means. */
export function TraitsTab({ traits }: { traits: string[] }) {
  const { t } = useTranslation();
  if (traits.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
        {t("online.squad.phone.noTraits")}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {traits.map((trait) => (
        <li
          key={trait}
          className="flex flex-col items-start gap-1.5 rounded-xl border border-gray-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-800"
        >
          <TraitBadge trait={trait} />
          <span className="text-[13px] leading-snug text-gray-700 dark:text-gray-300">
            {t(`traits.${trait}.desc`)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The season tab: every number of his season and his form, then the cards the desktop page shows
 * below them (ranked figures, last matches, career; C-21).
 */
export function SeasonTab({ player }: { player: SquadPlayerView }) {
  const { t, i18n } = useTranslation();
  const rating = new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const stats = seasonStatsOf(player.season);
  const form = matchFormOf(player);
  const plain = "text-gray-900 dark:text-white";
  const boxes = [
    { label: `${KEY}.apps`, value: String(stats.appearances), tone: plain },
    {
      label: `${KEY}.avgRating`,
      value: stats.appearances > 0 ? rating.format(stats.avg_rating) : "–",
      tone: "text-accent-700 dark:text-accent-400",
    },
    { label: `${KEY}.goals`, value: String(stats.goals), tone: plain },
    { label: `${KEY}.assists`, value: String(stats.assists), tone: plain },
    { label: "playerProfile.mins", value: String(stats.minutes_played), tone: plain },
    {
      label: "playerProfile.recentForm",
      value: form === undefined ? "–" : rating.format(form / 10),
      tone: "text-accent-700 dark:text-accent-400",
    },
    { label: "playerProfile.cleanSheets", value: String(stats.clean_sheets), tone: plain },
    { label: "playerProfile.yellows", value: String(stats.yellow_cards), tone: plain },
    { label: "playerProfile.reds", value: String(stats.red_cards), tone: plain },
  ];
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label={t(`${KEY}.tab.season`)} className="grid grid-cols-3 gap-2">
        {boxes.map((box) => (
          <li
            key={box.label}
            className="flex flex-col gap-0.5 rounded-xl border border-gray-200 bg-white px-3 py-3.5 dark:border-navy-700 dark:bg-navy-800"
          >
            <span
              className={`font-heading text-[26px] font-bold leading-none tabular-nums ${box.tone}`}
            >
              {box.value}
            </span>
            <span className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {t(box.label)}
            </span>
          </li>
        ))}
      </ul>
      <PlayerPerformanceCards player={player} withSeason={false} />
    </div>
  );
}
