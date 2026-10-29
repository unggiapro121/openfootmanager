import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { useGuardedNavigate } from "./leaveGuard";

const ITEM =
  "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left font-heading text-sm font-semibold uppercase tracking-wider text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-200 dark:hover:bg-navy-600";

/**
 * The coach's account in the header (design vi-coin.html): a round button that opens the
 * coach's profile and the way back to the main menu. It closes on a choice, on Escape and on a
 * click elsewhere.
 */
export default function AccountMenu() {
  const { t } = useTranslation();
  const navigate = useGuardedNavigate();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <div ref={root} className="relative">
      <button
        ref={toggle}
        type="button"
        aria-label={t("online.header.account")}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((was) => !was)}
        className="inline-flex h-11 items-center gap-1.5 rounded-full pl-1 pr-2 text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-300 dark:hover:bg-navy-600"
      >
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-200 text-gray-800 dark:bg-navy-600 dark:text-white"
          aria-hidden="true"
        >
          <UserRound className="h-4.5 w-4.5" />
        </span>
        <ChevronDown
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <ul
          id={menuId}
          className="absolute right-0 top-full z-30 mt-2 flex w-56 flex-col gap-0.5 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg dark:border-navy-600 dark:bg-navy-800"
        >
          <li>
            <button type="button" className={ITEM} onClick={() => go("/online/profile")}>
              <UserRound className="h-4 w-4" aria-hidden="true" />
              {t("online.nav.profile")}
            </button>
          </li>
          <li>
            <button type="button" className={ITEM} onClick={() => go("/")}>
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {t("online.nav.mainMenu")}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
