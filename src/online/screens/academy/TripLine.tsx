import { useTranslation } from "react-i18next";
import type { ScoutTripView } from "../../api";
import { payName, regionName, scoutFocusName } from "./academyText";

/** Where a trip went, what for and how it was paid, in a line. */
export default function TripLine({ trip }: { trip: ScoutTripView }) {
  const { t } = useTranslation();
  return (
    <span className="text-[13px] text-gray-700 dark:text-gray-300">
      {t("online.academy.scout.trip", {
        region: regionName(t, trip.region),
        focus: scoutFocusName(t, trip.focus),
        pay: payName(t, trip.paidWith),
      })}
    </span>
  );
}
