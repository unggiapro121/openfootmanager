import { useTranslation } from "react-i18next";
import { AlertTriangle, X } from "lucide-react";

interface CoachReportWarningProps {
  /** Hides the warning; without it the warning stays for as long as its screen. */
  onDismiss?: () => void;
}

/**
 * The account store could not take the matches just played: they earned the
 * coach nothing, though the career itself was saved (Y12).
 */
export function CoachReportWarning({ onDismiss }: CoachReportWarningProps) {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-accent-200 bg-accent-50 px-6 py-2 text-sm text-accent-800 dark:border-accent-500/30 dark:bg-accent-500/10 dark:text-accent-200"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{t("coach.reportFailed")}</span>
      {onDismiss ? (
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={onDismiss}
          className="rounded p-1 text-accent-700 transition-colors hover:bg-accent-100 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:ring-offset-2 dark:text-accent-200 dark:hover:bg-accent-500/20 dark:focus:ring-offset-navy-900"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
