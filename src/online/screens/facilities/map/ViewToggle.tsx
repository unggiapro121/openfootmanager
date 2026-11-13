import { useTranslation } from "react-i18next";
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
