import type { ReactNode } from "react";
import type { Feedback } from "./serverAuth.helpers";

/** The heading of a server login view, with a line under it. */
export function ServerFormHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h2 className="font-heading text-xl font-bold uppercase tracking-wide text-gray-900 dark:text-white">
        {title}
      </h2>
      {hint ? <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{hint}</p> : null}
    </div>
  );
}

/** The server's answer, or the next step, at the top of the view. */
export function FormFeedback({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  const isError = feedback.tone === "error";
  return (
    <p
      role={isError ? "alert" : "status"}
      className={`rounded-lg px-3 py-2 text-sm ${
        isError
          ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
          : "bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300"
      }`}
    >
      {feedback.message}
    </p>
  );
}

/** A way to another view, styled as a link. */
export function LinkButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded text-sm font-medium text-primary-600 hover:underline max-md:min-h-11 max-md:px-1 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 dark:text-primary-400"
    >
      {children}
    </button>
  );
}
