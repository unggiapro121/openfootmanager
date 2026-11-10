import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound } from "lucide-react";
import { Button } from "../../ui";
import { usePhoneForm } from "../../../hooks/usePhoneForm";
import { resetCoachPassword } from "../../../services/coachService";
import { resolveBackendError } from "../../../utils/backendI18n";
import { TextField } from "../coachFormFields";
import { FormFeedback, LinkButton, ServerFormHeader } from "./serverFormParts";
import {
  codeError,
  confirmationError,
  info,
  passwordError,
  presentErrors,
  type ServerViewProps,
} from "./serverAuth.helpers";

type ResetField = "code" | "password" | "confirmation";

/** The code from the reset email and the new password. */
export default function ServerResetForm({ feedback, onFeedback, onNavigate }: ServerViewProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errors, setErrors] = useState<Partial<Record<ResetField, string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const phoneForm = usePhoneForm();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = presentErrors<ResetField>({
      code: codeError(code, t),
      password: passwordError(password, t),
      confirmation: confirmationError(password, confirmation, t),
    });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setIsSubmitting(true);
    try {
      await resetCoachPassword(code, password);
      onNavigate("login", info(t("coachServer.passwordChanged")));
    } catch (error) {
      setIsSubmitting(false);
      onFeedback({ tone: "error", message: resolveBackendError(error) });
    }
  };

  return (
    <form
      {...phoneForm}
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      <ServerFormHeader title={t("coachServer.resetTitle")} />
      <FormFeedback feedback={feedback} />
      <TextField
        label={t("coachServer.code")}
        autoComplete="one-time-code"
        verbatim
        value={code}
        onChange={setCode}
        error={errors.code}
      />
      <TextField
        label={t("coachServer.newPassword")}
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
        error={errors.password}
      />
      <TextField
        label={t("coachServer.confirmPassword")}
        type="password"
        autoComplete="new-password"
        enterKeyHint="send"
        value={confirmation}
        onChange={setConfirmation}
        error={errors.confirmation}
      />
      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="w-full"
        disabled={isSubmitting}
        icon={<KeyRound />}
      >
        {t("coachServer.resetPassword")}
      </Button>
      <div className="flex flex-wrap justify-between gap-2">
        <LinkButton onClick={() => onNavigate("forgot")}>{t("coachServer.resendCode")}</LinkButton>
        <LinkButton onClick={() => onNavigate("login")}>{t("coachServer.backToLogin")}</LinkButton>
      </div>
    </form>
  );
}
