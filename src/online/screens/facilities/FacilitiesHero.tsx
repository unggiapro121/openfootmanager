import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { HardHat, Hourglass, PenLine, Wrench } from "lucide-react";
import { usePhoneLayout } from "../../../hooks/usePhoneLayout";
import { formatCount, formatVal } from "../../../lib/valueFormatting";
import type { FacilitiesView } from "../../api";
import { useOnlineNow } from "../../clock";
import { useOnlineStore } from "../../store/onlineStore";
import { FOCUS } from "../mobile/PhoneSheet";
import { ClubArt } from "./art/ClubArt";
import { buildClock } from "./cardState";
import { clockText, useWritesOff } from "./FacilityCard";
import { cardArt, facilityName, styleName } from "./facilityText";

const LINK = `rounded font-semibold text-primary-700 hover:underline dark:text-primary-400 ${FOCUS}`;

/**
 * The top of the facilities screen (c-27 §5.3): the stadium in the club's colours, its name with
 * the rename, its style, seats and level, the builders' line, and the season's upkeep. On a phone
 * the builders' line sticks under the app bar as the page scrolls.
 */
export function FacilitiesHero({
  view,
  onRename,
  onSpeedUp,
}: {
  view: FacilitiesView;
  onRename: () => void;
  onSpeedUp: (secondsLeft: number) => void;
}) {
  const { t } = useTranslation();
  const phone = usePhoneLayout();
  const stands = view.items?.find((item) => item.facility === "stands");
  const profileName = useOnlineStore((state) => state.club?.club.stadiumName);
  const stadium = profileName ?? view.stadiumName ?? "";
  const level = stands?.level ?? 1;
  const crew = <CrewLine view={view} onSpeedUp={onSpeedUp} />;
  const upkeep = <UpkeepLine view={view} />;

  return (
    <>
      <section
        aria-labelledby="facilities-stadium"
        className="grid overflow-hidden rounded-2xl border border-gray-200 bg-white md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] dark:border-navy-600 dark:bg-navy-800"
      >
        <ClubArt art={stands ? cardArt(stands) : null} className="aspect-[16/9] w-full" />
        <div className="flex min-w-0 flex-col justify-center gap-3 p-4 md:p-6">
          <span className="hidden font-heading text-xs font-bold uppercase tracking-wider text-gray-500 md:block dark:text-gray-400">
            {t("online.facilities.hero.kicker")}
          </span>
          <div className="flex items-start gap-2">
            <h2
              id="facilities-stadium"
              title={stadium}
              className="line-clamp-2 min-w-0 flex-1 break-words font-heading text-2xl font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
            >
              {stadium}
            </h2>
            <button
              type="button"
              onClick={onRename}
              aria-label={t("online.facilities.hero.rename")}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-navy-700 ${FOCUS}`}
            >
              <PenLine className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <p className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <span className="rounded-full bg-accent-100 px-2.5 py-0.5 text-xs font-bold text-accent-800 dark:bg-accent-500/20 dark:text-accent-300">
              {styleName(t, level)}
            </span>
            <span className="tabular-nums">
              {t("online.facilities.hero.capacity", {
                capacity: formatCount(view.capacity ?? 0),
                level,
                max: stands?.maxLevel ?? level,
              })}
            </span>
          </p>
          {!phone && crew}
          {!phone && upkeep}
        </div>
      </section>
      {phone && (
        <div className="sticky top-[var(--phone-header-h,0px)] z-10 -mx-3 flex flex-col gap-1.5 border-b border-gray-200 bg-gray-100/95 px-3 py-2 backdrop-blur dark:border-navy-700 dark:bg-navy-900/95">
          {crew}
          {upkeep}
        </div>
      )}
    </>
  );
}

/**
 * The builders (c-27 §5.3, T6): free, with what to do next; or busy, with the build, its time
 * left, its bar and a press that opens the speed-up.
 */
function CrewLine({
  view,
  onSpeedUp,
}: {
  view: FacilitiesView;
  onSpeedUp: (secondsLeft: number) => void;
}) {
  const { t } = useTranslation();
  const now = useOnlineNow();
  const offset = useOnlineStore((state) => state.facilitiesOffsetMs);
  const writesOff = useWritesOff();
  const build = view.build ?? null;
  const box = "flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm";

  if (!build) {
    return (
      <div className={`${box} border-gray-200 bg-gray-50 dark:border-navy-600 dark:bg-navy-900`}>
        <HardHat className="h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400" aria-hidden="true" />
        <span className="flex min-w-0 flex-col">
          <b className="whitespace-nowrap text-gray-900 dark:text-gray-100">
            {t("online.facilities.crew.free")}
          </b>
          <span className="text-xs text-gray-600 dark:text-gray-300">
            {t("online.facilities.crew.freeHint")}
          </span>
        </span>
      </div>
    );
  }

  const clock = buildClock(build, view.lineupLocked ?? false, now, offset);
  const label = t("online.facilities.crew.busy", {
    facility: facilityName(t, build.facility),
    level: build.toLevel,
  });
  const left = clockText(t, clock);
  const share = clock.kind === "running" ? clock.share : 1;
  const canSpeed = clock.kind === "running" && writesOff === null;
  const body = (
    <>
      <HardHat
        className="h-5 w-5 shrink-0 text-accent-600 dark:text-accent-400"
        aria-hidden="true"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-2">
          <b className="text-gray-900 dark:text-gray-100">{label}</b>
          <span className="text-xs tabular-nums text-gray-600 dark:text-gray-300">{left}</span>
        </span>
        <span
          className="block h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-navy-600"
          aria-hidden="true"
        >
          <span
            className="block h-full rounded-full bg-accent-400"
            style={{ width: `${share * 100}%` }}
          />
        </span>
      </span>
      {canSpeed && (
        <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-accent-700 dark:text-accent-300">
          <Hourglass className="h-3.5 w-3.5" aria-hidden="true" />
          {t("online.facilities.crew.speedUp")}
        </span>
      )}
    </>
  );
  const colours = "border-accent-300 bg-accent-50 dark:border-accent-500/40 dark:bg-accent-500/10";
  if (!canSpeed || clock.kind !== "running") {
    return <div className={`${box} ${colours}`}>{body}</div>;
  }
  return (
    <button
      type="button"
      aria-label={`${label}, ${left}. ${t("online.facilities.crew.speedUp")}`}
      onClick={() => onSpeedUp(clock.secondsLeft)}
      className={`${box} ${colours} min-h-11 hover:bg-accent-100 dark:hover:bg-accent-500/20 ${FOCUS}`}
    >
      {body}
    </button>
  );
}

/** What the club's levels cost to keep up a season, and where the money is (c-27 §5.3). */
function UpkeepLine({ view }: { view: FacilitiesView }) {
  const { t } = useTranslation();
  if (view.upkeepPerSeason === undefined) return null;
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
      <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
      {t("online.facilities.hero.upkeep", { amount: formatVal(view.upkeepPerSeason) })}
      <span aria-hidden="true">·</span>
      <Link to="/online/finance" className={LINK}>
        {t("online.facilities.hero.financeLink")}
      </Link>
    </p>
  );
}
