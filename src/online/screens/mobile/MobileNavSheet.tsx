import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { ChevronRight, X } from "lucide-react";
import { useGuardedNavigate } from "../leaveGuard";
import { isCurrent, type NavGroup } from "../shellNav";

const FOCUS =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-navy-800";

/**
 * One group's pages, risen from the bottom of a phone (design m-tong-quan.html, the tab bar's
 * sheets). Tapping a page opens it and closes the sheet; Escape, the close button or a tap on
 * the dimmed page closes it where it was.
 */
export default function MobileNavSheet({
  group,
  onClose,
}: {
  group: NavGroup;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useGuardedNavigate();
  const { pathname } = useLocation();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  const open = (path: string) => {
    onClose();
    navigate(path);
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end md:hidden">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 bg-navy-900/60"
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        className="relative rounded-t-2xl border-t border-gray-200 bg-white px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-2xl focus:outline-none motion-safe:animate-sheet-up dark:border-navy-600 dark:bg-navy-800"
      >
        <span
          className="mx-auto mb-3 block h-1 w-10 rounded-full bg-gray-300 dark:bg-navy-600"
          aria-hidden="true"
        />
        <div className="mb-2 flex items-center justify-between">
          <h2
            id={titleId}
            className="font-heading text-lg font-bold uppercase tracking-wider text-gray-900 dark:text-white"
          >
            {t(group.label)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className={`inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-navy-700 ${FOCUS}`}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <ul className="flex flex-col gap-1">
          {group.entries.map((entry) => {
            const current = isCurrent(entry.path, pathname);
            return (
              <li key={entry.path}>
                <button
                  type="button"
                  onClick={() => open(entry.path)}
                  aria-current={current ? "page" : undefined}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left ${FOCUS} ${
                    current
                      ? "bg-primary-50 dark:bg-primary-900/30"
                      : "hover:bg-gray-50 active:bg-gray-100 dark:hover:bg-navy-700 dark:active:bg-navy-700"
                  }`}
                >
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300"
                    aria-hidden="true"
                  >
                    <entry.icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-white">
                    {t(entry.label)}
                  </span>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500"
                    aria-hidden="true"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
