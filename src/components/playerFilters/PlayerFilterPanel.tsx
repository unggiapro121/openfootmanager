import { SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Select } from "../ui";
import { translatePositionLabel } from "../squad/SquadTab.helpers";
import type { DirectoryRegion } from "../teams/TeamsListTab.helpers";
import {
  PLAYER_FILTER_DEFAULTS,
  POSITION_GROUPS,
  type PlayerFilterValues,
  SPECIFIC_POSITIONS_BY_GROUP,
  countActivePlayerFilters,
} from "./playerFilters";

interface PlayerFilterPanelProps {
  filters: PlayerFilterValues;
  /** Set some of the panel's fields; the caller resets the page. */
  onChange: (patch: Partial<PlayerFilterValues>) => void;
  /** Regions → countries → leagues, for the competition pickers. */
  directoryTree: DirectoryRegion[];
}

const fieldClass =
  "w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-navy-900 border border-gray-200 dark:border-navy-600 text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50";
const labelClass =
  "text-[11px] font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400";

/** A whole number from an input, or null when it is empty or not a number. */
function parseBound(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * The player filter button and the panel it opens: age and OVR
 * ranges, a position group then one of its positions, and a competition by
 * region, then country, then league. The badge counts the filters that are on.
 */
export default function PlayerFilterPanel({
  filters,
  onChange,
  directoryTree,
}: PlayerFilterPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  const activeCount = countActivePlayerFilters(filters);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      // The pickers' menus are portaled to <body>; a press inside one belongs to the panel.
      if (containerRef.current?.contains(target)) return;
      if ((target as Element).closest?.('[role="listbox"]')) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const region = directoryTree.find((candidate) => candidate.id === filters.regionId);
  const country = region?.countries.find((candidate) => candidate.id === filters.countryId);
  const groupPositions = filters.positionGroup
    ? (SPECIFIC_POSITIONS_BY_GROUP[filters.positionGroup] ?? [])
    : [];

  const rangeField = (
    label: string,
    minKey: "ageMin" | "ovrMin",
    maxKey: "ageMax" | "ovrMax",
    bounds: [number, number],
  ) => (
    <fieldset className="space-y-1.5">
      <legend className={labelClass}>{label}</legend>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={bounds[0]}
          max={bounds[1]}
          aria-label={`${label} ${t("playerFilters.min")}`}
          placeholder={t("playerFilters.min")}
          value={filters[minKey] ?? ""}
          onChange={(event) => onChange({ [minKey]: parseBound(event.target.value) })}
          className={fieldClass}
        />
        <span aria-hidden="true" className="text-gray-400">
          –
        </span>
        <input
          type="number"
          inputMode="numeric"
          min={bounds[0]}
          max={bounds[1]}
          aria-label={`${label} ${t("playerFilters.max")}`}
          placeholder={t("playerFilters.max")}
          value={filters[maxKey] ?? ""}
          onChange={(event) => onChange({ [maxKey]: parseBound(event.target.value) })}
          className={fieldClass}
        />
      </div>
    </fieldset>
  );

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={
          activeCount > 0
            ? t("playerFilters.buttonActive", { count: activeCount })
            : t("playerFilters.button")
        }
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-bold uppercase tracking-wider transition-all focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800 ${activeCount > 0 ? "bg-primary-700 text-white shadow-sm" : "bg-white dark:bg-navy-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-navy-600"}`}
      >
        <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
        {t("playerFilters.button")}
        {activeCount > 0 ? (
          <span
            aria-hidden="true"
            className="bg-white/20 text-[0.65rem] px-1.5 py-0.5 rounded-full leading-none"
          >
            {activeCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={t("playerFilters.title")}
          className="absolute left-0 top-full mt-2 z-30 w-[22rem] max-w-[calc(100vw-2rem)] p-4 space-y-4 rounded-xl bg-white dark:bg-navy-800 border border-gray-200 dark:border-navy-600 shadow-xl"
        >
          <div className="grid grid-cols-2 gap-3">
            {rangeField(t("common.age"), "ageMin", "ageMax", [15, 45])}
            {rangeField(t("common.ovr"), "ovrMin", "ovrMax", [1, 99])}
          </div>

          <fieldset className="space-y-1.5">
            <legend className={labelClass}>{t("playerFilters.position")}</legend>
            <div className="grid grid-cols-2 gap-2">
              <Select
                selectSize="sm"
                fullWidth
                aria-label={t("playerFilters.positionGroup")}
                value={filters.positionGroup ?? ""}
                onChange={(event) =>
                  onChange({ positionGroup: event.target.value || null, position: null })
                }
              >
                <option value="">{t("playerFilters.anyPositionGroup")}</option>
                {POSITION_GROUPS.map((group) => (
                  <option key={group} value={group}>
                    {t(`common.positionGroups.${group}`, {
                      defaultValue: t(`common.positions.${group}`, { defaultValue: group }),
                    })}
                  </option>
                ))}
              </Select>
              <Select
                selectSize="sm"
                fullWidth
                disabled={groupPositions.length <= 1}
                aria-label={t("playerFilters.specificPosition")}
                value={filters.position ?? ""}
                onChange={(event) => onChange({ position: event.target.value || null })}
              >
                <option value="">{t("playerFilters.anyPosition")}</option>
                {groupPositions.map((position) => (
                  <option key={position} value={position}>
                    {t(`common.posAbbr.${position}`)} · {translatePositionLabel(t, position)}
                  </option>
                ))}
              </Select>
            </div>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className={labelClass}>{t("playerFilters.competition")}</legend>
            <div className="grid grid-cols-1 gap-2">
              <Select
                selectSize="sm"
                fullWidth
                aria-label={t("playerFilters.region")}
                value={filters.regionId ?? ""}
                onChange={(event) =>
                  onChange({
                    regionId: event.target.value || null,
                    countryId: null,
                    leagueId: null,
                  })
                }
              >
                <option value="">{t("playerFilters.anyRegion")}</option>
                {directoryTree.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </Select>
              <Select
                selectSize="sm"
                fullWidth
                disabled={!region}
                aria-label={t("playerFilters.country")}
                value={filters.countryId ?? ""}
                onChange={(event) =>
                  onChange({ countryId: event.target.value || null, leagueId: null })
                }
              >
                <option value="">{t("playerFilters.anyCountry")}</option>
                {(region?.countries ?? []).map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </Select>
              <Select
                selectSize="sm"
                fullWidth
                disabled={!country}
                aria-label={t("playerFilters.league")}
                value={filters.leagueId ?? ""}
                onChange={(event) => onChange({ leagueId: event.target.value || null })}
              >
                <option value="">{t("players.allLeagues")}</option>
                {(country?.leagues ?? []).map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </Select>
            </div>
          </fieldset>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={activeCount === 0}
              onClick={() => onChange(PLAYER_FILTER_DEFAULTS)}
              className="px-3 py-1.5 rounded-lg text-xs font-heading font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-navy-600 hover:bg-gray-50 dark:hover:bg-navy-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {t("playerFilters.clear")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
