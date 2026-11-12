import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { UserX } from "lucide-react";
import { requestAccountDeletion } from "../../../services/onlineAccountService";
import { resolveBackendError } from "../../../utils/backendI18n";
import { fromSessionRejection, type OnlineApiError } from "../../errors";
import { useOnlineStore } from "../../store/onlineStore";
import ItemDialogFrame, { FrameButtons, FrameCancel } from "../items/ItemDialogFrame";
import { useActionKey } from "../useActionKey";

const KEY = "online.profile.deletion";
/** What the dialog says goes, in the order it lists it. */
const LOSSES = ["lossClub", "lossMoney", "lossCareer"] as const;
const WRONG_PASSWORD = "be.error.auth.invalidCredentials";

const DANGER_ACTION =
  "flex h-12 min-w-0 flex-[2_1_200px] items-center justify-center gap-2 rounded-lg bg-red-600 px-4 font-heading text-base font-bold uppercase tracking-wider text-white shadow-md transition-all hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600 dark:focus:ring-offset-navy-800";

/**
 * The account's deletion (M3c1, m3-tech-spec §5.1): what goes, how to change one's mind, then the
 * password. It goes through the session's command, which forgets the token; a request with no
 * answer is sent again under the same key, the session pairing it with the same token. Done, the
 * online state is dropped and the coach lands on the main menu, which says the day it goes. It
 * promises nothing back on a cancel: the club may have gone to the AI in the meantime (PO M3a).
 */
export default function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const passwordId = useId();
  const errorId = useId();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<OnlineApiError | null>(null);
  const { run } = useActionKey();
  const wrongPassword = error?.code === WRONG_PASSWORD;

  const confirm = () => {
    setBusy(true);
    setError(null);
    run(
      (key) =>
        requestAccountDeletion(password, key).catch((rejection: unknown) => {
          throw fromSessionRejection(rejection);
        }),
      password,
    )
      .then((deletion) => {
        useOnlineStore.getState().reset();
        navigate("/", { state: { accountDeletion: deletion.deleteAt } });
      })
      .catch((failure: OnlineApiError) => {
        setError(failure);
        setBusy(false);
      });
  };

  return (
    <ItemDialogFrame
      icon={
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300">
          <UserX className="h-6 w-6" aria-hidden="true" />
        </span>
      }
      title={t(`${KEY}.title`)}
      busy={busy}
      onClose={onClose}
      fullPage
      footer={
        <FrameButtons>
          <FrameCancel onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </FrameCancel>
          <button
            type="button"
            className={DANGER_ACTION}
            disabled={busy || password === ""}
            onClick={confirm}
          >
            {t(`${KEY}.confirm`)}
          </button>
        </FrameButtons>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-gray-700 dark:text-gray-300">
        <p className="font-semibold text-gray-900 dark:text-white">{t(`${KEY}.lossesTitle`)}</p>
        <ul className="list-disc space-y-1.5 pl-5">
          {LOSSES.map((loss) => (
            <li key={loss}>{t(`${KEY}.${loss}`)}</li>
          ))}
        </ul>
        <p>{t(`${KEY}.grace`)}</p>
        <p className="text-gray-600 dark:text-gray-400">{t(`${KEY}.forgot`)}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={passwordId}
          className="font-heading text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300"
        >
          {t(`${KEY}.password`)}
        </label>
        <input
          id={passwordId}
          type="password"
          autoComplete="current-password"
          value={password}
          disabled={busy}
          aria-invalid={wrongPassword}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 aria-[invalid=true]:border-red-500 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-100 dark:aria-[invalid=true]:border-red-400"
        />
        {error && (
          <p id={errorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
            {resolveBackendError(error)}
          </p>
        )}
      </div>
    </ItemDialogFrame>
  );
}
