import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router-dom";
import { Button, Card, CardBody, CardHeader } from "../../components/ui";
import { resolveBackendError } from "../../utils/backendI18n";
import type { TakeoverView } from "../api";
import { online } from "../client";
import { useOnlineNow } from "../clock";
import type { OnlineApiError } from "../errors";
import { secondsUntil } from "../format";
import { refreshClub, refreshLeague, tracked, useOnlineStore } from "../store/onlineStore";
import { useActionKey } from "./useActionKey";

/** How often, and how long, the screen reads the club again while its fresh squad is made. */
export const SQUAD_POLL_MS = 2000;
export const SQUAD_POLL_LIMIT_MS = 60_000;

/**
 * Taking over a club (C-2 §3.3, S-7 §3.9). The three ways a takeover goes are explained before
 * the button, because a fresh starter squad is granted only once per account.
 */
export default function OnlineTakeover() {
  const club = useOnlineStore((state) => state.club);
  const [taken, setTaken] = useState<TakeoverView | null>(null);

  if (taken) return <TakenClub taken={taken} />;
  if (club) return <Navigate to="/online" replace />;
  return <TakeoverOffer onTaken={setTaken} />;
}

function TakeoverOffer({ onTaken }: { onTaken: (taken: TakeoverView) => void }) {
  const { t } = useTranslation();
  const now = useOnlineNow();
  const offline = useOnlineStore((state) => state.network === "offline");
  const key = useActionKey();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<OnlineApiError | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const waitSeconds = retryAt === null ? 0 : secondsUntil(retryAt, now);

  const takeOver = async () => {
    setSending(true);
    setError(null);
    try {
      const taken = await key.run((idempotencyKey) =>
        tracked(() => online.clubs.takeover(idempotencyKey)),
      );
      onTaken(taken);
      void refreshLeague().catch(() => undefined);
    } catch (failure) {
      const refusal = failure as OnlineApiError;
      setError(refusal);
      setRetryAt(
        refusal.retryAfterSeconds === undefined
          ? null
          : Date.now() + refusal.retryAfterSeconds * 1000,
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Card accent="primary" className="max-w-2xl">
      <CardHeader>{t("online.takeover.title")}</CardHeader>
      <CardBody className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
        <p>{t("online.takeover.intro")}</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>{t("online.takeover.returning")}</li>
          <li>{t("online.takeover.newcomer")}</li>
          <li>{t("online.takeover.other")}</li>
        </ul>
        {error && (
          <p role="alert" className="text-red-600 dark:text-red-400">
            {resolveBackendError(error)}
          </p>
        )}
        {waitSeconds > 0 && (
          <p className="text-gray-500 dark:text-gray-400">
            {t("online.takeover.retryIn", { seconds: waitSeconds })}
          </p>
        )}
        <Button onClick={takeOver} disabled={sending || offline || waitSeconds > 0}>
          {sending ? t("online.takeover.working") : t("online.takeover.button")}
        </Button>
      </CardBody>
    </Card>
  );
}

function TakenClub({ taken }: { taken: TakeoverView }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const refreshing = useOnlineStore(
    (state) => state.club?.squadRefreshing ?? taken.squadRefreshing,
  );
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    void refreshClub().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!refreshing) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started >= SQUAD_POLL_LIMIT_MS) {
        window.clearInterval(timer);
        setSlow(true);
        return;
      }
      void refreshClub().catch(() => undefined);
    }, SQUAD_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refreshing]);

  const done = !refreshing;
  return (
    <Card accent="success" className="max-w-2xl">
      <CardHeader>{t("online.takeover.title")}</CardHeader>
      <CardBody className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
        <p
          role="status"
          className="font-heading text-lg font-bold text-gray-900 dark:text-gray-100"
        >
          {t(`online.takeover.result.${taken.kind}`, { club: taken.club.name })}
        </p>
        {!done && !slow && <p>{t("online.takeover.makingSquad")}</p>}
        {!done && slow && <p>{t("online.takeover.squadSlow")}</p>}
        <Button onClick={() => navigate("/online")} disabled={!done && !slow}>
          {t("online.takeover.enter")}
        </Button>
      </CardBody>
    </Card>
  );
}
