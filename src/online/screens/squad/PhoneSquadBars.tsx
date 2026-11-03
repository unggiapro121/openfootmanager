import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Search, Smartphone, UserCheck, X } from "lucide-react";
import { PhoneHeaderPart } from "../mobile/PhoneHeaderSlots";
import { FOCUS, LENSES, type Lens, ROW_GRID } from "./PhoneSquadParts";
import { PHONE_SORT_IDS, type PhoneSortId } from "./phoneSquadList";
import type { SquadFilter, SquadGroup, SquadScope } from "./squadList";

const KEY = "online.squad.phone";
/** The rotate hint, once hidden, stays hidden on this device. */
const ROTATE_HINT_KEY = "ofm-squad-rotate-hint-hidden";

const SCOPES: Array<{ scope: SquadScope; label: string }> = [
  { scope: "all", label: "common.all" },
  { scope: "xi", label: "squad.starter" },
  { scope: "bench", label: "squad.benchOption" },
  { scope: "injured", label: "common.injured" },
];
const GROUPS: SquadGroup[] = ["All", "Goalkeeper", "Defender", "Midfielder", "Forward"];
const SORT_LABEL: Record<PhoneSortId, string> = {
  pos: "common.position",
  ovr: "common.ovr",
  condition: "common.condition",
  potential: "online.squad.potential",
  age: "common.age",
  style: "squad.styleFit",
};

interface FilterProps {
  filter: SquadFilter;
  onFilter: (filter: SquadFilter) => void;
}

/** In the app bar: a search to open, and the status tabs with the count of each. */
export function SquadAppBarParts({
  filter,
  onFilter,
  counts,
}: FilterProps & { counts: Record<SquadScope, number> }) {
  const { t } = useTranslation();
  const [searching, setSearching] = useState(false);
  const setFilter = onFilter;
  return (
    <>
      <PhoneHeaderPart place="actions">
        <button
          type="button"
          onClick={() => {
            setSearching(!searching);
            if (searching) setFilter({ ...filter, search: "" });
          }}
          aria-label={t(`${KEY}.searchToggle`)}
          aria-expanded={searching}
          className={`flex h-10 w-10 items-center justify-center rounded-full text-gray-700 dark:text-gray-200 ${searching ? "bg-gray-100 dark:bg-navy-700" : ""} ${FOCUS}`}
        >
          <Search className="h-5 w-5" aria-hidden="true" />
        </button>
      </PhoneHeaderPart>
      <PhoneHeaderPart place="below">
        {searching && (
          <div className="px-4 pb-2">
            <input
              type="search"
              // biome-ignore lint/a11y/noAutofocus: the field opens on the coach's own tap to search
              autoFocus
              aria-label={t(`${KEY}.searchLabel`)}
              placeholder={t(`${KEY}.searchPlaceholder`)}
              value={filter.search}
              onChange={(event) => setFilter({ ...filter, search: event.target.value })}
              className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/40 dark:border-navy-600 dark:bg-navy-900 dark:text-white dark:placeholder:text-gray-500"
            />
          </div>
        )}
        <div
          role="tablist"
          aria-label={t("common.status")}
          className="grid grid-cols-4 gap-0.5 border-b border-gray-200 px-3 dark:border-navy-700"
        >
          {SCOPES.map(({ scope, label }) => {
            const on = filter.scope === scope;
            return (
              <button
                key={scope}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setFilter({ ...filter, scope })}
                className={`h-10 whitespace-nowrap border-b-2 px-0.5 text-xs font-semibold ${on ? "border-primary-500 text-gray-900 dark:text-white" : "border-transparent text-gray-500 dark:text-gray-400"} ${FOCUS}`}
              >
                {t(label)}{" "}
                <span
                  className={`tabular-nums ${on ? "text-primary-700 dark:text-primary-400" : "text-gray-400 dark:text-gray-500"}`}
                >
                  {counts[scope]}
                </span>
              </button>
            );
          })}
        </div>
      </PhoneHeaderPart>
    </>
  );
}

/** The line the assistant picks the eleven by, to the tactics where it is turned off. */
export function AssistantLink() {
  const { t } = useTranslation();
  return (
    <Link
      to="/online/tactics"
      className={`mx-4 mt-3 flex min-h-10 items-center gap-2.5 rounded-[10px] border border-primary-300 bg-primary-50 px-3 py-2 text-[13px] text-gray-800 dark:border-primary-800 dark:bg-primary-900/20 dark:text-gray-200 ${FOCUS}`}
    >
      <UserCheck
        className="h-4.5 w-4.5 shrink-0 text-primary-600 dark:text-primary-400"
        aria-hidden="true"
      />
      <span className="flex-1">{t(`${KEY}.assistant`)}</span>
      <span className="flex items-center whitespace-nowrap font-semibold text-primary-700 dark:text-primary-400">
        {t("online.nav.tactics")}
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </span>
    </Link>
  );
}

/** The lines as chips, and the order of the list. */
export function LineChips({
  filter,
  onFilter,
  sortId,
  onSort,
}: FilterProps & { sortId: PhoneSortId; onSort: (sortId: PhoneSortId) => void }) {
  const { t } = useTranslation();
  const setFilter = onFilter;
  const setSortId = onSort;
  return (
    <div className="flex items-center gap-2 pl-4 pt-3">
      <div
        role="group"
        aria-label={t("common.position")}
        className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pr-1 [scrollbar-width:none]"
      >
        {GROUPS.map((group) => {
          const on = filter.group === group;
          return (
            <button
              key={group}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter({ ...filter, group })}
              className={`h-8 shrink-0 rounded-full border px-3 text-xs font-semibold ${on ? "border-primary-500 bg-primary-50 text-primary-800 dark:bg-primary-900/40 dark:text-primary-300" : "border-gray-200 bg-white text-gray-700 dark:border-navy-700 dark:bg-navy-800 dark:text-gray-200"} ${FOCUS}`}
            >
              {group === "All" ? t("common.all") : t(`online.market.group.${group}`)}
            </button>
          );
        })}
      </div>
      <label className="relative mr-4 shrink-0">
        <select
          aria-label={t(`${KEY}.sort`)}
          value={sortId}
          onChange={(event) => setSortId(event.target.value as PhoneSortId)}
          className={`h-8 appearance-none rounded-lg border border-gray-200 bg-white pl-2.5 pr-7 text-xs font-semibold text-gray-700 dark:border-navy-700 dark:bg-navy-800 dark:text-gray-200 ${FOCUS}`}
        >
          {PHONE_SORT_IDS.map((id) => (
            <option key={id} value={id}>
              ↕ {t(SORT_LABEL[id])}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500 dark:text-gray-400"
          aria-hidden="true"
        />
      </label>
    </div>
  );
}

function rotateHintHidden(): boolean {
  try {
    return localStorage.getItem(ROTATE_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function hideRotateHint() {
  try {
    localStorage.setItem(ROTATE_HINT_KEY, "1");
  } catch {
    // Storage blocked: the hint just comes back next time.
  }
}

/** Turning the phone sideways shows the full table; hidden for good once dismissed. */
export function RotateHint() {
  const { t } = useTranslation();
  const [showRotate, setShowRotate] = useState(() => !rotateHintHidden());
  if (!showRotate) return null;
  return (
    <div className="mx-4 mt-2.5 flex items-center gap-2.5 rounded-[10px] border border-dashed border-gray-300 bg-white py-2 pl-3 pr-2 text-xs text-gray-600 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-400">
      <Smartphone
        className="h-4.5 w-4.5 shrink-0 rotate-90 text-blue-500 dark:text-blue-300"
        aria-hidden="true"
      />
      <span className="flex-1">{t(`${KEY}.rotateHint`)}</span>
      <button
        type="button"
        onClick={() => {
          hideRotateHint();
          setShowRotate(false);
        }}
        aria-label={t(`${KEY}.hideRotate`)}
        className={`flex h-8 w-8 items-center justify-center rounded-full text-gray-500 dark:text-gray-400 ${FOCUS}`}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * What the list's two columns show, and their headings: it stays under the app bar while the
 * list scrolls (`--phone-header-h`).
 */
export function LensBar({ lens, onLens }: { lens: Lens; onLens: (lens: Lens) => void }) {
  const { t } = useTranslation();
  const setLens = onLens;
  const columns = LENSES.find((one) => one.id === lens)?.columns ?? LENSES[0].columns;
  return (
    <div className="sticky top-[var(--phone-header-h,0px)] z-10 mt-2.5 bg-gray-100 px-4 pt-2 dark:bg-navy-900">
      <div
        role="radiogroup"
        aria-label={t(`${KEY}.lens`)}
        className="grid grid-cols-4 gap-0.5 rounded-[10px] border border-gray-200 bg-white p-[3px] dark:border-navy-700 dark:bg-navy-800"
      >
        {LENSES.map((one) => {
          const on = lens === one.id;
          return (
            <button
              key={one.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setLens(one.id)}
              className={`h-[34px] rounded-lg text-xs font-semibold ${on ? "bg-gray-100 text-gray-900 dark:bg-navy-700 dark:text-white" : "text-gray-500 dark:text-gray-400"} ${FOCUS}`}
            >
              {t(one.label)}
            </button>
          );
        })}
      </div>
      <div
        aria-hidden="true"
        className={`grid ${ROW_GRID} gap-1.5 pb-1.5 pr-2.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400`}
      >
        <span className="col-span-3 pl-[56px]">{t("match.player")}</span>
        <span className="text-center">{t(columns[0])}</span>
        <span className="text-center">{t(columns[1])}</span>
        <span className="text-right">{t("common.ovr")}</span>
      </div>
    </div>
  );
}
