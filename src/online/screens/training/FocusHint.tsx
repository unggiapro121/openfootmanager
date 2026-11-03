import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FocusFitView } from "../../api";
import { focusHint } from "./focusHintModel";

const TONE = {
  best: "text-primary-700 dark:text-primary-300",
  fair: "text-gray-500 dark:text-gray-400",
  poor: "text-accent-700 dark:text-accent-400",
  nothing: "font-semibold text-accent-700 dark:text-accent-400",
} as const;

/**
 * One line under a player's focus: whether it is the focus that lifts him most, and which one
 * does when it is not (C-13a). Nothing for a resting player or one the server gives no fit.
 */
export default function FocusHint({ fit, shown }: { fit?: FocusFitView; shown?: string }) {
  const { t } = useTranslation();
  const hint = focusHint(fit, shown);
  if (!hint) return null;
  const label = (focus: string) => t(`training.focuses.${focus}.label`);
  const text =
    hint.verdict === "best"
      ? t("online.training.focusHint.best")
      : hint.verdict === "nothing"
        ? t("online.training.focusHint.nothing", {
            current: label(hint.current),
            best: label(hint.best),
          })
        : t(`online.training.focusHint.${hint.verdict}`, { best: label(hint.best) });
  return (
    <span className={`flex items-start gap-1 text-[11px] leading-snug ${TONE[hint.verdict]}`}>
      {hint.verdict === "best" && <Check className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />}
      {text}
    </span>
  );
}
