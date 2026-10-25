import { SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SPECIFIC_POSITIONS_BY_GROUP } from "../../../components/playerFilters/playerFilters";
import { translatePositionLabel } from "../../../components/squad/SquadTab.helpers";
import { Select } from "../../../components/ui";

/** The groups a coach filters by, as the server names them (`MarketQuery.position`). */
export const POSITION_GROUPS = ["Goalkeeper", "Defender", "Midfielder", "Forward"] as const;
export const NUMBER_FILTERS = ["minOvr", "maxOvr", "maxPrice", "maxAge"] as const;

const fieldClass =
  "w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-navy-900 border border-gray-200 dark:border-navy-600 text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50";
const labelClass =
  "text-[11px] font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400";

/**
 * The market's filter button and the panel it opens, laid out as the offline player filter is:
 * an OVR range, the oldest age, the highest price and a position group. The badge counts the
 * filters that are on. The values live in the address (`params`), where the market reads them.
 */
export default function MarketFilterPanel({
  params,
  onChange,
  onClear,
}: {
  params: URLSearchParams;
  /** Sets some filters at once: one update to the address, so none is lost. */
  onChange: (patch: Record<string, string>) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  const activeCount = [...NUMBER_FILTERS, "position", "naturalPosition"].filter((name) =>
    params.get(name),
  ).length;
  const group = params.get("position") ?? "";
  const groupPositions = SPECIFIC_POSITIONS_BY_GROUP[group] ?? [];

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      // The pickers' menus are portaled to <body>; a press inside one belongs to the panel.
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

  const number = (name: (typeof NUMBER_FILTERS)[number], placeholder?: string) => (
    <input
      type="number"
      min={0}
      inputMode="numeric"
      aria-label={t(`online.market.filter.${name}`)}
      placeholder={placeholder}
      value={params.get(name) ?? ""}
      onChange={(event) => onChange({ [name]: event.target.value })}
      className={fieldClass}
    />
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
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-heading text-xs font-bold uppercase tracking-wider transition-all focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800 ${activeCount > 0 ? "bg-primary-700 text-white shadow-sm" : "border border-gray-200 bg-white text-gray-500 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-400"}`}
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        {t("playerFilters.button")}
        {activeCount > 0 ? (
          <span
            aria-hidden="true"
            className="rounded-full bg-white/20 px-1.5 py-0.5 text-[0.65rem] leading-none"
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
          className="absolute left-0 top-full z-30 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-xl dark:border-navy-600 dark:bg-navy-800"
        >
          <div className="grid grid-cols-2 gap-3">
            <fieldset className="space-y-1.5">
              <legend className={labelClass}>{t("common.ovr")}</legend>
              <div className="flex items-center gap-2">
                {number("minOvr", t("playerFilters.min"))}
                <span aria-hidden="true" className="text-gray-400">
                  –
                </span>
                {number("maxOvr", t("playerFilters.max"))}
              </div>
            </fieldset>
            <fieldset className="space-y-1.5">
              <legend className={labelClass}>{t("online.market.filter.maxAge")}</legend>
              {number("maxAge")}
            </fieldset>
          </div>
          <fieldset className="space-y-1.5">
            <legend className={labelClass}>{t("online.market.filter.maxPrice")}</legend>
            {number("maxPrice")}
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className={labelClass}>{t("playerFilters.position")}</legend>
            <div className="grid grid-cols-2 gap-2">
              <Select
                selectSize="sm"
                fullWidth
                aria-label={t("online.market.filter.position")}
                value={group}
                onChange={(event) => {
                  onChange({ position: event.target.value, naturalPosition: "" });
                }}
              >
                <option value="">{t("online.market.filter.anyPosition")}</option>
                {POSITION_GROUPS.map((one) => (
                  <option key={one} value={one}>
                    {t(`online.market.group.${one}`)}
                  </option>
                ))}
              </Select>
              <Select
                selectSize="sm"
                fullWidth
                disabled={groupPositions.length <= 1}
                aria-label={t("playerFilters.specificPosition")}
                value={params.get("naturalPosition") ?? ""}
                onChange={(event) => onChange({ naturalPosition: event.target.value })}
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
          <div className="flex justify-end">
            <button
              type="button"
              disabled={activeCount === 0}
              onClick={onClear}
              className="rounded-lg border border-gray-200 px-3 py-1.5 font-heading text-xs font-bold uppercase tracking-wider text-gray-600 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-navy-600 dark:text-gray-300 dark:hover:bg-navy-700"
            >
              {t("playerFilters.clear")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
