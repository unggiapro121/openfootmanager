import { useTranslation } from "react-i18next";
import { useOnlineNow } from "../clock";
import { countdownTo } from "../format";

/** The time left until `iso` as the player reads it ("1d 02:03:04"); null once it has passed. */
export function useCountdownText(iso: string | undefined): string | null {
  const { t } = useTranslation();
  const now = useOnlineNow();
  if (!iso) return null;
  const left = countdownTo(iso, now);
  if (!left) return null;
  return left.days > 0
    ? t("online.countdown.withDays", { days: left.days, clock: left.clock })
    : left.clock;
}
