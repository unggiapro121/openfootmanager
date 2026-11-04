import { useTranslation } from "react-i18next";
import type { MyClubView } from "../../../api";
import { FOCUS, PhoneSheet } from "../../mobile/PhoneSheet";
import { ExtraResultBody, resultKicker } from "../ExtraResultBody";
import type { ExtraOutcome } from "../extraResult";

const KEY = "online.training.phone";

/** The answer to a press on a phone, in a sheet risen from the bottom (design MTapThem). */
export function PhoneExtraResult({
  club,
  outcome,
  floor,
  onClose,
}: {
  club: MyClubView;
  outcome: ExtraOutcome;
  floor: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <PhoneSheet kicker={resultKicker(t, outcome)} title={t(`${KEY}.resultTitle`)} onClose={onClose}>
      <ExtraResultBody club={club} outcome={outcome} floor={floor} />
      <button
        type="button"
        onClick={onClose}
        className={`h-12 shrink-0 rounded-[10px] bg-gray-100 text-sm font-semibold text-gray-900 dark:bg-navy-700 dark:text-white ${FOCUS}`}
      >
        {t("common.close")}
      </button>
    </PhoneSheet>
  );
}
