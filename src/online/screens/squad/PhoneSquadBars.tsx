import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Search,
  Smartphone,
  UserCheck,
  X,
} from "lucide-react";
import { PhoneHeaderPart } from "../mobile/PhoneHeaderSlots";
import { FOCUS, LENSES, type Lens, ROW_GRID } from "./PhoneSquadParts";
import type { SquadFilter, SquadGroup, SquadScope, SquadSort, SquadSortKey } from "./squadList";
import { onTablistKeyDown, tabIndexOf } from "../mobile/tablistKeys";

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
          onKeyDown={onTablistKeyDown}
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
                tabIndex={tabIndexOf(on)}
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

/** The lines as chips. */
export function LineChips({ filter, onFilter }: FilterProps) {
  const { t } = useTranslation();
  const setFilter = onFilter;
  return (
    <div
      role="group"
      aria-label={t("common.position")}
      className="flex gap-1.5 overflow-x-auto px-4 pt-3 [scrollbar-width:none]"
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
 * What the list's two columns show, and the headings that sort it, as the desktop table's do: a
 * heading tapped sorts by its column, tapped again turns it round. It stays under the app bar
 * while the list scrolls (`--phone-header-h`).
 */
export function LensBar({
  lens,
  onLens,
  sort,
  onSort,
}: {
  lens: Lens;
  onLens: (lens: Lens) => void;
  sort: SquadSort;
  onSort: (key: SquadSortKey) => void;
}) {
  const { t } = useTranslation();
  const setLens = onLens;
  const shown = LENSES.find((one) => one.id === lens) ?? LENSES[0];
  const heading = (col: SquadSortKey, label: string, className: string) => (
    <SortHeading col={col} label={t(label)} sort={sort} onSort={onSort} className={className} />
  );
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
        role="group"
        aria-label={t(`${KEY}.sort`)}
        className={`grid ${ROW_GRID} items-stretch gap-1.5 pb-1 pr-2.5 pt-1 text-[10px] font-semibold uppercase tracking-wider`}
      >
        {heading("pos", "match.player", "col-span-3 justify-start pl-[56px]")}
        {heading(shown.sorts[0], shown.columns[0], "justify-center text-center")}
        {heading(shown.sorts[1], shown.columns[1], "justify-center text-center")}
        {heading("ovr", "common.ovr", "justify-end text-right")}
      </div>
    </div>
  );
}

/** One column heading to tap; the column sorted by is lit, with an arrow for its direction. */
function SortHeading({
  col,
  label,
  sort,
  onSort,
  className,
}: {
  col: SquadSortKey;
  label: string;
  sort: SquadSort;
  onSort: (key: SquadSortKey) => void;
  className: string;
}) {
  const active = sort.key === col;
  const Arrow = sort.dir === "asc" ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSort(col)}
      className={`flex min-h-8 items-center gap-0.5 rounded leading-tight uppercase ${className} ${active ? "text-primary-600 dark:text-primary-400" : "text-gray-500 dark:text-gray-400"} ${FOCUS}`}
    >
      {label}
      {active && <Arrow className="h-3 w-3 shrink-0" aria-hidden="true" />}
    </button>
  );
}
