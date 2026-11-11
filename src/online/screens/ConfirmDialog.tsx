import { useTranslation } from "react-i18next";
import DashboardModalFrame from "../../components/dashboard/DashboardModalFrame";
import { Button } from "../../components/ui";

/** A yes-or-no question over the page, in the dashboard's modal frame. */
export default function ConfirmDialog({
  title,
  body,
  confirm,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirm: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DashboardModalFrame maxWidthClassName="max-w-md">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="online-confirm-title"
        className="space-y-4"
      >
        <h3
          id="online-confirm-title"
          className="font-heading text-lg font-bold text-gray-900 dark:text-gray-100"
        >
          {title}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-300">{body}</p>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button type="button" size="sm" onClick={onConfirm}>
            {confirm}
          </Button>
        </div>
      </div>
    </DashboardModalFrame>
  );
}
