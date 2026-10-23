import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { Button } from "../../components/ui";
import { reopenOnlineGate } from "../client";
import { type OnlineGate, useOnlineStore } from "../store/onlineStore";

/**
 * What the whole online mode shows while the revision gate is closed (E6-8, C2-4): the client
 * and the server speak different contract revisions, so no other screen may read the server.
 */
export default function OnlineGateScreen({ gate }: { gate: Exclude<OnlineGate, "open"> }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const retry = () => {
    reopenOnlineGate();
    useOnlineStore.getState().reset();
    navigate("/online", { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-6 dark:bg-navy-900">
      <div
        role="alert"
        className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-xl dark:border-navy-600 dark:bg-navy-800"
      >
        <ShieldAlert className="mx-auto mb-4 h-10 w-10 text-accent-500 dark:text-accent-400" />
        <h1 className="mb-2 font-heading text-xl font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100">
          {t(`online.gate.${gate}Title`)}
        </h1>
        <p className="mb-6 text-sm text-gray-600 dark:text-gray-300">
          {t(`be.error.online.${gate}`)}
        </p>
        <div className="flex justify-center gap-3">
          <Button variant="outline" onClick={() => navigate("/")}>
            {t("online.nav.mainMenu")}
          </Button>
          {gate === "serverOutdated" && <Button onClick={retry}>{t("online.retry")}</Button>}
        </div>
      </div>
    </div>
  );
}
