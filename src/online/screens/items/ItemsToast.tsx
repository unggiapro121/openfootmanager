import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Check, X } from "lucide-react";

/**
 * What a purchase or a use did, in the corner of the page (designs cua-hang.html, kho-do.html).
 * It stays until closed or the next action, and may carry one link on.
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
  return (
    <div
      role="status"
      className="fixed bottom-6 right-6 z-40 flex max-w-[min(420px,calc(100vw-48px))] items-start gap-3 rounded-xl border border-t-4 border-gray-200 border-t-success-400 bg-white p-4 shadow-xl dark:border-navy-600 dark:border-t-success-400 dark:bg-navy-700"
    >
      <Check
        className="mt-0.5 h-5 w-5 shrink-0 text-success-500 dark:text-success-400"
        aria-hidden="true"
      />
      <span className="text-sm leading-snug text-gray-800 dark:text-gray-100">
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
        className="-mr-1.5 -mt-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-400 dark:hover:bg-navy-600"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
