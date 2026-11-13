import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Check, ChevronRight, HardHat } from "lucide-react";
import { formatVal } from "../../../lib/valueFormatting";
import type { FacilitiesView } from "../../api";
import { useOnlineNow } from "../../clock";
import { useOnlineStore } from "../../store/onlineStore";
import { FOCUS } from "../mobile/PhoneSheet";
import { ClubArt } from "./art/ClubArt";
import { buildClock, buildsOverTime } from "./cardState";
import { clockText } from "./FacilityCard";
import { cardArt, facilityName } from "./facilityText";
import { useUnseenCompletion } from "./seen";

/** How long after it completed a build is still worth a chip on the overview (c-27 §5.8). */
const RECENT_MS = 24 * 3_600_000;

/** The club's facilities view when its season builds them over time; `null` otherwise. */
export function useBuildingFacilities(): FacilitiesView | null {
  const view = useOnlineStore((state) => state.facilities);
  return view && buildsOverTime(view) ? view : null;
}

/** The build under way in one line, "Stands level 4 · 1d 06:00:00 left"; `null` without one. */
function useBuildLine(view: FacilitiesView): string | null {
  const { t } = useTranslation();
  const now = useOnlineNow();
  const offset = useOnlineStore((state) => state.facilitiesOffsetMs);
  const build = view.build ?? null;
  if (!build) return null;
  const clock = buildClock(build, view.lineupLocked ?? false, now, offset);
  return t("online.facilities.touch.building", {
    facility: facilityName(t, build.facility),
    level: build.toLevel,
    left: clockText(t, clock),
  });
}

/**
 * Finance's way to the facilities (c-27 §5.8, design 8.1), in place of its old upgrade card when
 * the season builds them over time: the stadium, the build under way, the season's upkeep.
 */
export function FacilitiesLinkCard({
  view,
  className = "",
}: {
  view: FacilitiesView;
  className?: string;
}) {
  const { t } = useTranslation();
  const line = useBuildLine(view);
  const stands = view.items?.find((item) => item.facility === "stands");
  return (
    <Link
      to="/online/facilities"
      className={`flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 hover:bg-gray-50 dark:border-navy-600 dark:bg-navy-800 dark:hover:bg-navy-700 ${FOCUS} ${className}`}
    >
      <ClubArt art={stands ? cardArt(stands) : null} className="h-14 w-20 shrink-0 rounded-lg" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <b className="font-heading text-base uppercase tracking-wider text-gray-900 dark:text-gray-100">
          {t("online.nav.facilities")}
        </b>
        <span className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-200">
          <HardHat className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{line ?? t("online.facilities.crew.free")}</span>
        </span>
        {view.upkeepPerSeason !== undefined && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("online.facilities.hero.upkeep", { amount: formatVal(view.upkeepPerSeason) })}
          </span>
        )}
      </span>
      <ChevronRight
        className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500"
        aria-hidden="true"
      />
    </Link>
  );
}

/**
 * The overview's chips (c-27 §5.8, design 8.2): the build under way, and a build completed in
 * the last 24 hours the coach has not seen yet. Nothing when there is neither.
 */
export function FacilitiesOverviewChips() {
  const view = useBuildingFacilities();
  return view ? <Chips view={view} /> : null;
}

function Chips({ view }: { view: FacilitiesView }) {
  const { t } = useTranslation();
  const unseen = useUnseenCompletion();
  const now = useOnlineNow();
  const line = useBuildLine(view);
  const recent = unseen && now - Date.parse(unseen.completedAt) < RECENT_MS ? unseen : null;
  if (!line && !recent) return null;
  const chip = `inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border px-3 text-sm font-semibold ${FOCUS}`;
  return (
    <div className="flex flex-wrap gap-2">
      {line && (
        <Link
          to="/online/facilities"
          className={`${chip} border-accent-300 bg-accent-50 text-gray-900 hover:bg-accent-100 dark:border-accent-500/40 dark:bg-accent-500/10 dark:text-gray-100 dark:hover:bg-accent-500/20`}
        >
          <HardHat
            className="h-4 w-4 shrink-0 text-accent-700 dark:text-accent-300"
            aria-hidden="true"
          />
          <span className="truncate">{t("online.facilities.touch.chipBuilding", { line })}</span>
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        </Link>
      )}
      {recent && (
        <Link
          to="/online/facilities"
          className={`${chip} border-primary-300 bg-primary-50 text-gray-900 hover:bg-primary-100 dark:border-primary-500/40 dark:bg-primary-500/10 dark:text-gray-100 dark:hover:bg-primary-500/20`}
        >
          <Check
            className="h-4 w-4 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <span className="truncate">
            {t("online.facilities.touch.chipDone", {
              facility: facilityName(t, recent.facility),
              level: recent.level,
            })}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
