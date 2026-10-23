import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, CardHeader } from "../../../components/ui";
import { resolveBackendError } from "../../../utils/backendI18n";
import type { FriendlyOutcome } from "../../api";
import { online } from "../../client";
import { useOnlineNow } from "../../clock";
import { refreshFriendly, tracked, useOnlineStore } from "../../store/onlineStore";
import { FriendlyRoom } from "./FriendlyRoom";
import { isWholeCode, typedCode, waitedText } from "./friendlyCode";
import { useFriendlyAction } from "./useFriendlyAction";

/** Where the reason of the last outcome the coach dismissed is kept, per device. */
const SEEN_OUTCOME = "ofm.online.friendly.seenOutcome";

function seenOutcome(): string | null {
  try {
    return window.localStorage.getItem(SEEN_OUTCOME);
  } catch {
    return null;
  }
}

function markSeen(at: string): void {
  try {
    window.localStorage.setItem(SEEN_OUTCOME, at);
  } catch {
    // A private window keeps nothing: the reason shows again next time, which is harmless.
  }
}

/**
 * Friendlies (S-12, C-3): make a room and send its code to a friend, join one by its code, or be
 * paired by the queue with a coach of a like club; then the room, until the match. Nothing of a
 * friendly counts outside its match.
 */
export default function OnlineFriendly() {
  const { t } = useTranslation();
  const friendly = useOnlineStore((state) => state.friendly);
  const [loadError, setLoadError] = useState<unknown>(null);

  useEffect(() => {
    refreshFriendly().catch(setLoadError);
  }, []);

  if (friendly === undefined) {
    return loadError !== null ? (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        {resolveBackendError(loadError)}
      </p>
    ) : (
      <p className="text-sm text-gray-500 dark:text-gray-400">{t("online.loading")}</p>
    );
  }
  const seat = friendly.seat;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {friendly.lastOutcome && <OutcomeNotice outcome={friendly.lastOutcome} />}
      {seat?.state === "room" ? (
        <FriendlyRoom room={seat.room} />
      ) : seat?.state === "queued" ? (
        <Queued queuedAt={seat.queuedAt} />
      ) : (
        <Start />
      )}
    </div>
  );
}

/** Why the coach's last queue or room ended without them, shown until they dismiss it. */
function OutcomeNotice({ outcome }: { outcome: FriendlyOutcome }) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(() => seenOutcome() === outcome.at);
  if (dismissed) return null;
  return (
    <div
      role="status"
      className="flex items-start justify-between gap-3 rounded-lg border border-accent-400/40 bg-accent-50 px-4 py-3 text-sm text-gray-800 dark:bg-accent-500/10 dark:text-gray-100"
    >
      <p>{t(`online.friendly.reason.${outcome.reason}`)}</p>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          markSeen(outcome.at);
          setDismissed(true);
        }}
      >
        {t("online.friendly.dismiss")}
      </Button>
    </div>
  );
}

function Start() {
  const { t } = useTranslation();
  const offline = useOnlineStore((state) => state.network === "offline");
  const { act, busy, error } = useFriendlyAction();
  const [code, setCode] = useState("");

  const join = (event: FormEvent) => {
    event.preventDefault();
    if (isWholeCode(code)) void act((key) => online.friendlies.join(code, key), `join:${code}`);
  };

  return (
    <Card accent="primary">
      <CardHeader>{t("online.friendly.title")}</CardHeader>
      <CardBody className="space-y-5 text-sm text-gray-700 dark:text-gray-300">
        <p>{t("online.friendly.intro")}</p>
        {error !== null && (
          <p role="alert" className="text-red-600 dark:text-red-400">
            {resolveBackendError(error)}
          </p>
        )}
        <section className="space-y-2">
          <h3 className="font-heading font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100">
            {t("online.friendly.create.title")}
          </h3>
          <p>{t("online.friendly.create.text")}</p>
          <Button
            onClick={() => void act((key) => online.friendlies.createRoom(key), "create")}
            disabled={busy || offline}
          >
            {t("online.friendly.create.button")}
          </Button>
        </section>
        <form className="space-y-2" onSubmit={join}>
          <h3 className="font-heading font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100">
            {t("online.friendly.join.title")}
          </h3>
          <label className="flex flex-col gap-1">
            <span>{t("online.friendly.join.label")}</span>
            <input
              value={code}
              onChange={(event) => setCode(typedCode(event.target.value))}
              placeholder="XXX-XXX"
              autoComplete="off"
              spellCheck={false}
              className="w-40 rounded-md border border-gray-300 bg-white px-3 py-2 font-heading text-lg tracking-widest text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:border-navy-600 dark:bg-navy-900 dark:text-gray-100 dark:focus:ring-offset-navy-800"
            />
          </label>
          <Button type="submit" variant="outline" disabled={busy || offline || !isWholeCode(code)}>
            {t("online.friendly.join.button")}
          </Button>
        </form>
        <section className="space-y-2">
          <h3 className="font-heading font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100">
            {t("online.friendly.queue.title")}
          </h3>
          <p>{t("online.friendly.queue.text")}</p>
          <Button
            variant="accent"
            onClick={() => void act((key) => online.friendlies.queue(key), "queue")}
            disabled={busy || offline}
          >
            {t("online.friendly.queue.button")}
          </Button>
        </section>
      </CardBody>
    </Card>
  );
}

function Queued({ queuedAt }: { queuedAt: string }) {
  const { t } = useTranslation();
  const now = useOnlineNow();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const stop = async () => {
    setLeaving(true);
    setError(null);
    try {
      await tracked(() => online.friendlies.leaveQueue());
      await refreshFriendly();
    } catch (failure) {
      setError(failure);
    } finally {
      setLeaving(false);
    }
  };

  return (
    <Card accent="accent">
      <CardHeader>{t("online.friendly.queue.title")}</CardHeader>
      <CardBody className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
        <p
          role="status"
          className="font-heading text-lg font-bold text-gray-900 dark:text-gray-100"
        >
          {t("online.friendly.queued.searching", { time: waitedText(queuedAt, now) })}
        </p>
        <p>{t("online.friendly.queued.text")}</p>
        {error !== null && (
          <p role="alert" className="text-red-600 dark:text-red-400">
            {resolveBackendError(error)}
          </p>
        )}
        <Button variant="outline" onClick={stop} disabled={leaving}>
          {t("online.friendly.queued.cancel")}
        </Button>
      </CardBody>
    </Card>
  );
}
