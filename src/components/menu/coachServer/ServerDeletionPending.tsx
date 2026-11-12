import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import { Button } from "../../ui";
import { useBackAction } from "../../../hooks/useBackAction";
import { resolveBackendError } from "../../../utils/backendI18n";
import { FormFeedback, LinkButton, ServerFormHeader } from "./serverFormParts";
import type { Feedback } from "./serverAuth.helpers";

interface ServerDeletionPendingProps {
  /** The login's refusal, `be.error.auth.deletionPending?deleteAt=…`: it says the server's day. */
  refusal: unknown;
  /** Cancel the deletion and log in; rejects with the reason when either is refused. */
  onCancelDeletion: () => Promise<void>;
  /** Leave the deletion as it is, back to the login form. */
  onKeep: () => void;
  onForgotPassword: () => void;
}

/**
 * A login refused because the account waits to be deleted (M3c1, m3-tech-spec §5.2): the day it
 * goes, as the server sends it (the grace is the server's setting, never a number written here),
 * and the coach's three ways out. A forgotten password is reset, then the login cancels (K5).
 */
export default function ServerDeletionPending({
  refusal,
  onCancelDeletion,
  onKeep,
  onForgotPassword,
}: ServerDeletionPendingProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  // The phone's Back leaves the deletion as it is, as "Leave it" does.
  useBackAction(!busy, onKeep);

  const cancel = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      await onCancelDeletion();
    } catch (error) {
      setFeedback({ tone: "error", message: resolveBackendError(error) });
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <ServerFormHeader title={t("coachServer.deletionPendingTitle")} />
      <p
        role="status"
        className="rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-800 dark:bg-accent-500/10 dark:text-accent-200"
      >
        {resolveBackendError(refusal)}
      </p>
      <FormFeedback feedback={feedback} />
      <Button
        type="button"
        variant="primary"
        size="lg"
        className="w-full"
        disabled={busy}
        icon={<RotateCcw />}
        onClick={() => {
          void cancel();
        }}
      >
        {t("coachServer.cancelDeletion")}
      </Button>
      <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={onKeep}>
        {t("coachServer.keepDeletion")}
      </Button>
      <div className="flex justify-center">
        <LinkButton onClick={onForgotPassword} disabled={busy}>
          {t("coachServer.forgotPassword")}
        </LinkButton>
      </div>
    </div>
  );
}
