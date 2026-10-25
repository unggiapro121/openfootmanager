import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LogIn, UserPlus } from "lucide-react";
import { Button } from "../../ui";
import {
  type CoachAccount,
  loginCoachWithEmail,
} from "../../../services/coachService";
import { resolveBackendError } from "../../../utils/backendI18n";
import { TextField } from "../coachFormFields";
import { readLoginEmails, rememberLoginEmail } from "./loginHistory";
import { FormFeedback, LinkButton, ServerFormHeader } from "./serverFormParts";
import {
  emailError,
  info,
  isBackendError,
  presentErrors,
  type ServerViewProps,
} from "./serverAuth.helpers";

interface ServerLoginFormProps extends ServerViewProps {
  onLoggedIn: (account: CoachAccount) => void;
}

/** Email and password, and the ways to an account, a code, or a new password. */
export default function ServerLoginForm({
  email,
  onEmailChange,
  feedback,
  onFeedback,
  onNavigate,
  onLoggedIn,
}: ServerLoginFormProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<
    Partial<Record<"email" | "password", string>>
  >({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [knownEmails] = useState(readLoginEmails);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = presentErrors({
      email: emailError(email, t),
      password: password
        ? undefined
        : t("validation.required", { field: t("coachServer.password") }),
    });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setIsSubmitting(true);
    try {
      const account = await loginCoachWithEmail(email, password);
      rememberLoginEmail(email);
      onLoggedIn(account);
    } catch (error) {
      setIsSubmitting(false);
      if (isBackendError(error, "be.error.auth.emailNotVerified")) {
        onNavigate("verify", info(t("coachServer.verifyFirst")));
      } else {
        onFeedback({ tone: "error", message: resolveBackendError(error) });
      }
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
      <ServerFormHeader
        title={t("coachServer.loginTitle")}
        hint={t("coachServer.loginSubtitle")}
      />
      <FormFeedback feedback={feedback} />
      <TextField
        label={t("coachServer.email")}
        type="email"
        autoComplete="email"
        value={email}
        onChange={onEmailChange}
        error={errors.email}
        suggestions={knownEmails}
      />
      <TextField
        label={t("coachServer.password")}
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
        error={errors.password}
      />
      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="w-full"
        disabled={isSubmitting}
        icon={<LogIn />}
      >
        {t("coachServer.logIn")}
      </Button>
      <div className="flex flex-wrap justify-between gap-2">
        <LinkButton onClick={() => onNavigate("forgot")}>
          {t("coachServer.forgotPassword")}
        </LinkButton>
        <LinkButton onClick={() => onNavigate("verify")}>
          {t("coachServer.haveCode")}
        </LinkButton>
      </div>
      <div className="border-t border-gray-200 pt-4 dark:border-navy-600">
        <p className="mb-2 text-center text-sm text-gray-500 dark:text-gray-400">
          {t("coachServer.noAccount")}
        </p>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          icon={<UserPlus />}
          onClick={() => onNavigate("register")}
        >
          {t("coach.createAccount")}
        </Button>
      </div>
    </form>
  );
}
