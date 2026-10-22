import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import { Button } from "../../ui";
import { requestCoachPasswordReset } from "../../../services/coachService";
import { resolveBackendError } from "../../../utils/backendI18n";
import { TextField } from "../coachFormFields";
import { FormFeedback, LinkButton, ServerFormHeader } from "./serverFormParts";
import { emailError, info, type ServerViewProps } from "./serverAuth.helpers";

/** The account's email, to send a code that resets its password. */
export default function ServerForgotForm({
  email,
  onEmailChange,
  feedback,
  onFeedback,
  onNavigate,
}: ServerViewProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const invalid = emailError(email, t);
    setError(invalid);
    if (invalid) return;
    setIsSubmitting(true);
    try {
      await requestCoachPasswordReset(email);
      onNavigate("reset", info(t("coachServer.resetCodeSent", { email: email.trim() })));
    } catch (failure) {
      setIsSubmitting(false);
      onFeedback({ tone: "error", message: resolveBackendError(failure) });
    }
  };

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      <ServerFormHeader title={t("coachServer.forgotTitle")} hint={t("coachServer.forgotHint")} />
      <FormFeedback feedback={feedback} />
      <TextField
        label={t("coachServer.email")}
        type="email"
        autoComplete="email"
        value={email}
        onChange={onEmailChange}
        error={error}
      />
      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="w-full"
        disabled={isSubmitting}
        icon={<Send />}
      >
        {t("coachServer.sendResetCode")}
      </Button>
      <div className="flex flex-wrap justify-between gap-2">
        <LinkButton onClick={() => onNavigate("reset")}>{t("coachServer.haveCode")}</LinkButton>
        <LinkButton onClick={() => onNavigate("login")}>{t("coachServer.backToLogin")}</LinkButton>
      </div>
    </form>
  );
}
