import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MailCheck } from "lucide-react";
import { Button } from "../../ui";
import { usePhoneForm } from "../../../hooks/usePhoneForm";
import { resendCoachVerification, verifyCoachEmail } from "../../../services/coachService";
import { resolveBackendError } from "../../../utils/backendI18n";
import { TextField } from "../coachFormFields";
import { FormFeedback, LinkButton, ServerFormHeader } from "./serverFormParts";
import { codeError, emailError, info, type ServerViewProps } from "./serverAuth.helpers";

/** The code from the verification email, and a fresh one if it was lost or expired. */
export default function ServerVerifyForm({
  email,
  onEmailChange,
  feedback,
  onFeedback,
  onNavigate,
}: ServerViewProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<Partial<Record<"email" | "code", string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const phoneForm = usePhoneForm();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const missing = codeError(code, t);
    setErrors({ code: missing });
    if (missing) return;
    setIsSubmitting(true);
    try {
      await verifyCoachEmail(code);
      onNavigate("login", info(t("coachServer.verified")));
    } catch (error) {
      setIsSubmitting(false);
      onFeedback({ tone: "error", message: resolveBackendError(error) });
    }
  };

  const handleResend = async () => {
    const invalid = emailError(email, t);
    setErrors({ email: invalid });
    if (invalid) return;
    try {
      await resendCoachVerification(email);
      onFeedback(info(t("coachServer.codeSent", { email: email.trim() })));
    } catch (error) {
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
      <ServerFormHeader title={t("coachServer.verifyTitle")} hint={t("coachServer.verifyHint")} />
      <FormFeedback feedback={feedback} />
      <TextField
        label={t("coachServer.email")}
        type="email"
        autoComplete="email"
        verbatim
        value={email}
        onChange={onEmailChange}
        error={errors.email}
      />
      <TextField
        label={t("coachServer.code")}
        autoComplete="one-time-code"
        enterKeyHint="send"
        verbatim
        value={code}
        onChange={setCode}
        error={errors.code}
      />
      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="w-full"
        disabled={isSubmitting}
        icon={<MailCheck />}
      >
        {t("coachServer.verify")}
      </Button>
      <div className="flex flex-wrap justify-between gap-2">
        <LinkButton
          onClick={() => {
            void handleResend();
          }}
        >
          {t("coachServer.resendCode")}
        </LinkButton>
        <LinkButton onClick={() => onNavigate("login")}>{t("coachServer.backToLogin")}</LinkButton>
      </div>
    </form>
  );
}
