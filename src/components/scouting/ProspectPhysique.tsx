import { useTranslation } from "react-i18next";

import type { ScoutReportData } from "../../store/types";
import { formatPlayerPhysique } from "../playerProfile/PlayerProfile.helpers";
import { WeakFootRating } from "../playerProfile/PlayerProfileHeroCard";

/** A youth prospect's build and feet, which anyone watching him can see. */
export default function ProspectPhysique({ report }: { report: ScoutReportData }) {
  const { t, i18n } = useTranslation();
  const cells = [
    {
      label: t("common.footednessLabel"),
      value: t(`common.footedness.${report.footedness ?? "Right"}`),
    },
    { label: t("common.weakFoot"), value: <WeakFootRating value={report.weak_foot ?? 0} /> },
    {
      label: t("common.height"),
      value: formatPlayerPhysique(report.height_cm ?? undefined, "centimeter", i18n.language),
    },
    {
      label: t("common.weight"),
      value: formatPlayerPhysique(report.weight_kg ?? undefined, "kilogram", i18n.language),
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
      {cells.map((cell) => (
        <div key={cell.label} className="min-w-0">
          <dt className="text-[10px] font-heading font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
            {cell.label}
          </dt>
          <dd className="mt-0.5 text-sm font-semibold text-gray-800 dark:text-gray-200">
            {cell.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
