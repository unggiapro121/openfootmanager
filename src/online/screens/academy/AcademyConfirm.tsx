import { useTranslation } from "react-i18next";
import DashboardModalFrame from "../../../components/dashboard/DashboardModalFrame";
import { Button } from "../../../components/ui";

/** An academy action asked once more: what it does, then cancel or go on. */
export default function AcademyConfirm({
  title,
  text,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  text: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DashboardModalFrame maxWidthClassName="max-w-md">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="academy-confirm-title"
        className="space-y-4"
      >
        <h3
          id="academy-confirm-title"
          className="font-heading text-lg font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
        >
          {title}
        </h3>
        <p className="text-sm text-gray-700 dark:text-gray-300">{text}</p>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={onConfirm}>
            {t("online.academy.confirm")}
          </Button>
        </div>
      </div>
    </DashboardModalFrame>
  );
}
