import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../../components/ui";
import { resolveBackendError } from "../../../utils/backendI18n";
import { online } from "../../client";
import { useOnlineStore } from "../../store/onlineStore";
import { useFriendlyAction } from "./useFriendlyAction";

/**
 * Under a friendly that is over (S-12 §3.12), for one of its coaches: go back to the friendly room
 * to play the next one, or ask for a rematch here. `inline` sits in the full-time line of the match
 * screen, where a league match links to its result.
 */
export function FriendlyAfterMatch({
  matchId,
  inline = false,
  coach = false,
}: {
  matchId: string;
  inline?: boolean;
  /** The viewer coaches a side of this match (the live screen knows); otherwise only a coach whose
   * room played it is offered anything. */
  coach?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const offline = useOnlineStore((state) => state.network === "offline");
  const room = useOnlineStore((state) =>
    state.friendly?.seat?.state === "room" ? state.friendly.seat.room : undefined,
  );
  const { act, busy, error } = useFriendlyAction();

  const rematch = async () => {
    if (await act((key) => online.friendlies.rematch(key), `rematch:${matchId}`)) {
      navigate("/online/friendly");
    }
  };

  const ownRoom = room?.matchId === matchId;
  // A spectator who opened the match is offered nothing; a coach always the way back, even when
  // the other coach already asked for a rematch (the room is full again, with no match yet) or the
  // room has closed.
  if (!coach && !ownRoom) return null;
  // A rematch: once the room has finished this match — a moment after the last frame, when the
  // match is settled; asked before, it would be refused — or when the other coach asked first,
  // which makes it getting ready.
  const canRematch =
    (ownRoom && room?.status === "finished") ||
    (room !== undefined && room.status === "full" && room.matchId === undefined);

  return (
    <div
      className={
        inline
          ? "ml-auto flex flex-wrap items-center gap-3"
          : "flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-navy-700 dark:bg-navy-800"
      }
    >
      {!inline && (
        <p className="font-heading font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100">
          {t("online.friendly.after.title")}
        </p>
      )}
      {room !== undefined && (ownRoom || room.status === "full") && (
        <Button size="sm" onClick={rematch} disabled={busy || offline || !canRematch}>
          {t("online.friendly.room.rematch")}
        </Button>
      )}
      <Link
        to="/online/friendly"
        className="inline-flex items-center rounded-lg border border-primary-600 px-3 py-1.5 font-heading text-sm font-bold uppercase tracking-wider text-primary-700 hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:border-primary-400 dark:text-primary-400 dark:hover:bg-primary-500/10 dark:focus:ring-offset-navy-800"
      >
        {t("online.friendly.after.back")}
      </Link>
      {error !== null && (
        <p role="alert" className="w-full text-sm text-red-600 dark:text-red-400">
          {resolveBackendError(error)}
        </p>
      )}
    </div>
  );
}
