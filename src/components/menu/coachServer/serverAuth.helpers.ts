/** The screens of the server login, and what each tells the player at the top. */
export type ServerLoginView = "login" | "register" | "verify" | "forgot" | "reset";

export type Feedback = { tone: "info" | "error"; message: string } | null;

/** What every view of the server login shares: the email typed so far, and the way between views. */
export interface ServerViewProps {
  email: string;
  onEmailChange: (email: string) => void;
  feedback: Feedback;
  onFeedback: (feedback: Feedback) => void;
  onNavigate: (view: ServerLoginView, feedback?: Feedback) => void;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The server's own limits (`ofm-server` validate.rs), checked here only so the
 * player hears about them before sending; the server decides.
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function info(message: string): Feedback {
  return { tone: "info", message };
}

export function emailError(email: string, t: Translate): string | undefined {
  if (!email.trim()) return t("validation.required", { field: t("coachServer.email") });
  if (!EMAIL_PATTERN.test(email.trim())) return t("coachServer.invalidEmail");
  return undefined;
}

export function passwordError(password: string, t: Translate): string | undefined {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
    return t("coachServer.passwordLength", {
      min: PASSWORD_MIN_LENGTH,
      max: PASSWORD_MAX_LENGTH,
    });
  }
  return undefined;
}

export function confirmationError(
  password: string,
  confirmation: string,
  t: Translate,
): string | undefined {
  return password === confirmation ? undefined : t("coachServer.passwordMismatch");
}

export function codeError(code: string, t: Translate): string | undefined {
  return code.trim() ? undefined : t("coachServer.codeRequired");
}

/** Whether a rejected command failed with the backend error `key`. */
export function isBackendError(error: unknown, key: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim() === key;
}

/** Only the messages that are set: an empty object means the form can be sent. */
export function presentErrors<T extends string>(
  errors: Partial<Record<T, string | undefined>>,
): Partial<Record<T, string>> {
  return Object.fromEntries(
    Object.entries(errors).filter(([, message]) => message !== undefined),
  ) as Partial<Record<T, string>>;
}
