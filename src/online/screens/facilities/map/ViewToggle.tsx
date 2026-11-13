import { useTranslation } from "react-i18next";
import { List, Map as MapIcon } from "lucide-react";
import { FOCUS } from "../../mobile/PhoneSheet";
import type { FacilitiesViewMode } from "./viewMode";

const MODES: FacilitiesViewMode[] = ["map", "list"];

/** The facilities screen's Map / List switch (c-27 §6.3), in the hero or the phone's app bar. */
export function ViewToggle({
  mode,
  onChange,
}: {
  mode: FacilitiesViewMode;
  onChange: (mode: FacilitiesViewMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t("online.facilities.view.group")}
      className="grid shrink-0 grid-cols-2 gap-0.5 rounded-lg border border-gray-200 bg-gray-100 p-0.5 dark:border-navy-600 dark:bg-navy-900"
    >
      {MODES.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={mode === option}
          onClick={() => onChange(option)}
          className={`min-h-8 rounded-md px-2.5 text-xs font-bold ${FOCUS} ${
            mode === option
              ? "bg-white text-gray-900 shadow-sm dark:bg-navy-600 dark:text-white"
              : "text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
          }`}
        >
          {t(`online.facilities.view.${option}`)}
        </button>
      ))}
    </div>
  );
}

/**
 * The phone's switch (P5-59 K1): one icon button to the other view, so the app bar keeps room for
 * the page's name.
 */
export function ViewSwitchButton({
  mode,
  onChange,
}: {
  mode: FacilitiesViewMode;
  onChange: (mode: FacilitiesViewMode) => void;
}) {
  const { t } = useTranslation();
  const next: FacilitiesViewMode = mode === "map" ? "list" : "map";
  const Icon = next === "map" ? MapIcon : List;
  return (
    <button
      type="button"
      aria-label={t(
        next === "map" ? "online.facilities.view.showMap" : "online.facilities.view.showList",
      )}
      onClick={() => onChange(next)}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-navy-700 ${FOCUS}`}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
