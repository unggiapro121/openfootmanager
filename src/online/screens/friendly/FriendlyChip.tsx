import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { useOnlineNow } from "../../clock";
import { useOnlineStore } from "../../store/onlineStore";
import { waitedText } from "./friendlyCode";

const CHIP_CLASS =
  "rounded-full bg-accent-100 px-3 py-1 font-heading text-sm font-bold uppercase tracking-wider text-accent-800 hover:bg-accent-200 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-2 dark:bg-accent-500/20 dark:text-accent-300 dark:hover:bg-accent-500/30 dark:focus:ring-offset-navy-800";

/**
 * The coach's friendly, seen from any online page (S-12 §3.12): the time spent looking for an
 * opponent, a room waiting for them to get ready, a match being played. A coach may leave the
 * friendly page while queued — to change the lineup — and still see it.
 */
export function FriendlyChip() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const now = useOnlineNow();
  const seat = useOnlineStore((state) => state.friendly?.seat);
  if (!seat) return null;
  if (seat.state === "queued") {
    return (
      <Link to="/online/friendly" className={CHIP_CLASS}>
        {t("online.friendly.chip.searching", { time: waitedText(seat.queuedAt, now) })}
      </Link>
    );
  }
  const room = seat.room;
  if (room.status === "playing" && room.matchId) {
    if (pathname === `/online/match/${room.matchId}`) return null;
    return (
      <Link to={`/online/match/${room.matchId}`} className={CHIP_CLASS}>
        {t("online.friendly.chip.playing")}
      </Link>
    );
  }
  if (room.status === "full" && pathname !== "/online/friendly") {
    return (
      <Link to="/online/friendly" className={CHIP_CLASS}>
        {t("online.friendly.chip.room")}
      </Link>
    );
  }
  return null;
}
