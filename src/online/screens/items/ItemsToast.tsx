import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Check, X } from "lucide-react";
import { usePhoneLayout } from "../../../hooks/usePhoneLayout";

/**
 * What a purchase or a use did, in the corner of the page (designs cua-hang.html, kho-do.html);
 * on a phone just above the tab bar, never over it (m-cua-hang, D-S9). It stays until closed or
 * the next action, and may carry one link on.
 */
export default function ItemsToast({
  text,
  link,
  onClose,
}: {
  text: string;
  link?: { to: string; label: string };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const phone = usePhoneLayout();
  return (
    <div
      role="status"
      data-layout={phone ? "above-tabs" : "corner"}
      className={`fixed z-40 flex items-start gap-3 rounded-xl border border-gray-200 bg-white shadow-xl dark:border-navy-600 dark:bg-navy-700 ${
        phone
          ? "inset-x-3 bottom-[calc(4.75rem+var(--safe-bottom))] items-center border-l-4 border-l-success-400 py-2.5 pl-3.5 pr-1.5 dark:border-l-success-400"
          : "bottom-6 right-6 max-w-[min(420px,calc(100vw-48px))] border-t-4 border-t-success-400 p-4 dark:border-t-success-400"
      }`}
    >
      {!phone && (
        <Check
          className="mt-0.5 h-5 w-5 shrink-0 text-success-500 dark:text-success-400"
          aria-hidden="true"
        />
      )}
      <span className="min-w-0 flex-1 text-sm leading-snug text-gray-800 dark:text-gray-100">
        <span>{text}</span>
        {link && (
          <>
            {" "}
            <Link
              to={link.to}
              className="rounded font-semibold text-primary-700 hover:text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-primary-400 dark:hover:text-primary-300"
            >
              {link.label}
            </Link>
          </>
        )}
      </span>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("online.shop.closeNotice")}
        className={`flex shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-400 dark:hover:bg-navy-600 ${
          phone ? "h-10 w-10" : "-mr-1.5 -mt-1.5 h-8 w-8"
        }`}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
