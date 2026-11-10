import { useState } from "react";
import { useTranslation } from "react-i18next";
import { registerCoachAccount } from "../../../services/coachService";
import { resolveBackendError } from "../../../utils/backendI18n";
import CoachAccountForm from "../CoachAccountForm";
import { TextField } from "../coachFormFields";
import {
  type CoachAccountErrors,
  type CoachAccountField,
  type CoachAccountFormData,
  EMPTY_COACH_ACCOUNT_FORM,
  toCoachIdentity,
  validateCoachAccountForm,
} from "../coachAccountForm.helpers";
import { FormFeedback } from "./serverFormParts";
import {
  confirmationError,
  emailError,
  info,
  passwordError,
  presentErrors,
  type ServerViewProps,
} from "./serverAuth.helpers";

type CredentialField = "email" | "password" | "confirmation";

/** The coach account form, with the email and password the server account logs in with. */
export default function ServerRegisterForm({
  email,
  onEmailChange,
  feedback,
  onFeedback,
  onNavigate,
}: ServerViewProps) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState<CoachAccountFormData>(EMPTY_COACH_ACCOUNT_FORM);
  const [formErrors, setFormErrors] = useState<CoachAccountErrors>({});
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [credentialErrors, setCredentialErrors] = useState<
    Partial<Record<CredentialField, string>>
  >({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (field: CoachAccountField, value: string) => {
    setFormData((previous) => ({ ...previous, [field]: value }));
    setFormErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const identityErrors = validateCoachAccountForm(formData, new Date(), t);
    const credentials = presentErrors<CredentialField>({
      email: emailError(email, t),
      password: passwordError(password, t),
      confirmation: confirmationError(password, confirmation, t),
    });
    setFormErrors(identityErrors);
    setCredentialErrors(credentials);
    if (Object.keys(identityErrors).length > 0 || Object.keys(credentials).length > 0) return;
    setIsSubmitting(true);
    try {
      await registerCoachAccount({ email, password, identity: toCoachIdentity(formData) });
      onNavigate("verify", info(t("coachServer.codeSent", { email: email.trim() })));
    } catch (error) {
      setIsSubmitting(false);
      onFeedback({ tone: "error", message: resolveBackendError(error) });
    }
  };

  return (
    <CoachAccountForm
      title={t("coachServer.registerTitle")}
      formData={formData}
      formErrors={formErrors}
      isSubmitting={isSubmitting}
      onChange={handleChange}
      onClose={() => onNavigate("login")}
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      feedback={<FormFeedback feedback={feedback} />}
      leadingFields={
        <>
          <TextField
            label={t("coachServer.email")}
            type="email"
            autoComplete="username"
            verbatim
            value={email}
            onChange={onEmailChange}
            error={credentialErrors.email}
          />
          <TextField
            label={t("coachServer.password")}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            error={credentialErrors.password}
          />
          <TextField
            label={t("coachServer.confirmPassword")}
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={setConfirmation}
            error={credentialErrors.confirmation}
          />
        </>
      }
    />
  );
}
