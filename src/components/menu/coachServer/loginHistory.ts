const KEY = "ofm.online.loginEmails";
const MOST = 8;

/** The emails that logged in on this machine, the latest first. Emails only, never a password. */
export function readLoginEmails(): string[] {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(KEY) ?? "[]",
    );
    return Array.isArray(parsed)
      ? parsed
          .filter((item): item is string => typeof item === "string")
          .slice(0, MOST)
      : [];
  } catch {
    return [];
  }
}

/** Put `email` first in the history after a login, once, whatever its case. */
export function rememberLoginEmail(email: string): void {
  const value = email.trim();
  if (!value) return;
  const rest = readLoginEmails().filter(
    (known) => known.toLowerCase() !== value.toLowerCase(),
  );
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify([value, ...rest].slice(0, MOST)),
    );
  } catch {
    // Storage may be blocked; the login does not depend on it.
  }
}
