import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

/** The login gate while it finds out where the accounts are, or reads them. */
export default function CoachLoginLoading() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-48 items-center justify-center" role="status">
      <Loader2 className="h-8 w-8 animate-spin text-primary-500" aria-hidden="true" />
      <span className="sr-only">{t("common.loading")}</span>
    </div>
  );
}
