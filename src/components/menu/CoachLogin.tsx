import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, UserPlus } from "lucide-react";
import { Button } from "../ui";
import {
  type CoachAccount,
  createCoachAccount,
  deleteCoachAccount,
  listCoachAccounts,
  loginCoachAccount,
} from "../../services/coachService";
import { showError } from "../../lib/errorDialog";
import { resolveBackendError } from "../../utils/backendI18n";
import CoachAccountForm from "./CoachAccountForm";
import CoachAccountList from "./CoachAccountList";
import {
  type CoachAccountErrors,
  type CoachAccountField,
  type CoachAccountFormData,
  EMPTY_COACH_ACCOUNT_FORM,
  toCoachIdentity,
  validateCoachAccountForm,
} from "./coachAccountForm.helpers";

interface CoachLoginProps {
  onLoggedIn: (account: CoachAccount) => void;
}

/**
 * The gate in front of the main menu: the player picks the coach he plays as,
 * or makes one. With no account on this machine yet, the form opens directly.
 */
export default function CoachLogin({ onLoggedIn }: CoachLoginProps) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<CoachAccount[] | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState<CoachAccountFormData>(EMPTY_COACH_ACCOUNT_FORM);
  const [formErrors, setFormErrors] = useState<CoachAccountErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loggingInId, setLoggingInId] = useState<string | null>(null);

  useEffect(() => {
    listCoachAccounts()
      .then((list) => setAccounts(list ?? []))
      .catch(async (error) => {
        setAccounts([]);
        await showError(t("errors.title"), resolveBackendError(error));
      });
  }, [t]);

  const logIn = async (account: CoachAccount) => {
    setLoggingInId(account.id);
    try {
      onLoggedIn(await loginCoachAccount(account.id));
    } catch (error) {
      setLoggingInId(null);
      await showError(t("errors.title"), resolveBackendError(error));
    }
  };

  const handleChange = (field: CoachAccountField, value: string) => {
    setFormData((previous) => ({ ...previous, [field]: value }));
    setFormErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors = validateCoachAccountForm(formData, new Date(), t);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setIsSubmitting(true);
    try {
      const account = await createCoachAccount(toCoachIdentity(formData));
      await logIn(account);
    } catch (error) {
      await showError(t("errors.title"), resolveBackendError(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteCoachAccount(id);
      setAccounts((previous) => (previous ?? []).filter((account) => account.id !== id));
    } catch (error) {
      await showError(t("errors.title"), resolveBackendError(error));
    }
  };

  if (accounts === null) {
    return (
      <div className="flex min-h-48 items-center justify-center" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" aria-hidden="true" />
        <span className="sr-only">{t("common.loading")}</span>
      </div>
    );
  }

  if (isCreating || accounts.length === 0) {
    return (
      <CoachAccountForm
        formData={formData}
        formErrors={formErrors}
        isSubmitting={isSubmitting}
        onChange={handleChange}
        onClose={accounts.length > 0 ? () => setIsCreating(false) : null}
        onSubmit={(event) => {
          void handleCreate(event);
        }}
      />
    );
  }

  return (
    <section aria-labelledby="coach-login-title" className="flex flex-col gap-4">
      <div>
        <h2
          id="coach-login-title"
          className="font-heading text-xl font-bold uppercase tracking-wide text-gray-900 dark:text-white"
        >
          {t("coach.loginTitle")}
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("coach.loginSubtitle")}</p>
      </div>
      <CoachAccountList
        accounts={accounts}
        loggingInId={loggingInId}
        onLogin={(account) => {
          void logIn(account);
        }}
        onDelete={(id) => {
          void handleDelete(id);
        }}
      />
      <Button
        type="button"
        variant="outline"
        className="w-full"
        icon={<UserPlus />}
        onClick={() => {
          setFormData(EMPTY_COACH_ACCOUNT_FORM);
          setFormErrors({});
          setIsCreating(true);
        }}
      >
        {t("coach.createAccount")}
      </Button>
    </section>
  );
}
