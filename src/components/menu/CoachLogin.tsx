import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { logError } from "../../lib/logger";
import { isMobileBuild } from "../../lib/platform";
import {
  type CoachAccount,
  type CoachAccountMode,
  getCoachAccountMode,
} from "../../services/coachService";
import CoachLocalLogin from "./CoachLocalLogin";
import CoachLoginLoading from "./CoachLoginLoading";
import CoachServerLogin from "./coachServer/CoachServerLogin";

interface CoachLoginProps {
  onLoggedIn: (account: CoachAccount) => void;
}

/**
 * The gate in front of the main menu. With an account server configured the
 * player logs in with email and password; otherwise he picks an account on
 * this machine, or, on the phone app, which has no offline game (DM-1), is told
 * to reinstall it.
 */
export default function CoachLogin({ onLoggedIn }: CoachLoginProps) {
  const [mode, setMode] = useState<CoachAccountMode | null>(null);

  useEffect(() => {
    getCoachAccountMode()
      .then(setMode)
      .catch((error) => {
        console.error("Failed to read the account mode:", error);
        setMode("local");
      });
  }, []);

  if (mode === null) return <CoachLoginLoading />;
  if (mode === "server") return <CoachServerLogin onLoggedIn={onLoggedIn} />;
  if (isMobileBuild()) return <NoServerNotice />;
  return <CoachLocalLogin onLoggedIn={onLoggedIn} />;
}

/**
 * The phone app built without a usable server address (none, or not https, M2b-6): only a store
 * build fixes it, so there is nothing to fill in or retry (M2b4, P5-23).
 */
function NoServerNotice() {
  const { t } = useTranslation();
  useEffect(() => {
    logError("coach login: the phone app has no server address; showing the reinstall notice");
  }, []);
  return (
    <div role="alert" className="flex flex-col items-center gap-4 py-2 text-center">
      <ShieldAlert className="h-10 w-10 text-accent-500 dark:text-accent-400" aria-hidden="true" />
      <p className="break-words text-sm text-gray-600 dark:text-gray-300">{t("coach.noServer")}</p>
    </div>
  );
}
