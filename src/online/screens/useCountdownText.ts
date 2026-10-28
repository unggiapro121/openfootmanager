import { useTranslation } from "react-i18next";
import { useOnlineNow } from "../clock";
import { countdownTo } from "../format";

/**
 * The time left until `iso` as the player reads it ("1d 02:03:04"); null once it has passed.
 * `offsetMs` is the server's clock less this machine's, for a countdown that must run on the
 * server's time (the academy's trips, C-7 C7-40).
 */
export function useCountdownText(iso: string | undefined, offsetMs = 0): string | null {
  const { t } = useTranslation();
  const now = useOnlineNow();
  if (!iso) return null;
  const left = countdownTo(iso, now + offsetMs);
  if (!left) return null;
  return left.days > 0
    ? t("online.countdown.withDays", { days: left.days, clock: left.clock })
    : left.clock;
}
