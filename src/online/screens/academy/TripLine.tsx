import { useTranslation } from "react-i18next";
import type { ScoutTripView } from "../../api";
import { payName, scoutLineName } from "./academyText";

/** The line a trip looked for and how it was paid, in a line (C-15 C15-4). */
export default function TripLine({ trip }: { trip: ScoutTripView }) {
  const { t } = useTranslation();
  return (
    <span className="text-[13px] text-gray-700 dark:text-gray-300">
      {t("online.academy.scout.trip", {
        line: scoutLineName(t, trip.line),
        pay: payName(t, trip.paidWith),
      })}
    </span>
  );
}
