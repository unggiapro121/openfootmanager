import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../../components/ui";
import { resolveBackendError } from "../../../utils/backendI18n";
import { online } from "../../client";
import { useOnlineStore } from "../../store/onlineStore";
import { useFriendlyAction } from "./useFriendlyAction";

/** Under a friendly that is over (S-12 §3.12): ask for a rematch, or go back to its room. */
export function FriendlyAfterMatch({ matchId }: { matchId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const offline = useOnlineStore((state) => state.network === "offline");
  const { act, busy, error } = useFriendlyAction();

  const rematch = async () => {
    if (await act((key) => online.friendlies.rematch(key), `rematch:${matchId}`)) {
      navigate("/online/friendly");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-navy-700 dark:bg-navy-800">
      <p className="font-heading font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100">
        {t("online.friendly.after.title")}
      </p>
      <Button size="sm" onClick={rematch} disabled={busy || offline}>
        {t("online.friendly.room.rematch")}
      </Button>
      <Link
        to="/online/friendly"
        className="rounded text-sm font-semibold text-primary-700 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-primary-400 dark:focus:ring-offset-navy-800"
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
