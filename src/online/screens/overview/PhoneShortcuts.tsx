import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Backpack, Dumbbell, Gift, type LucideIcon, Store } from "lucide-react";
import { claimsWaiting, useOnlineStore } from "../../store/onlineStore";

interface Shortcut {
  path: string;
  label: string;
  icon: LucideIcon;
  tile: string;
}

const SHORTCUTS: Shortcut[] = [
  {
    path: "/online/events",
    label: "online.nav.events",
    icon: Gift,
    tile: "bg-accent-100 text-accent-800 dark:bg-accent-900/40 dark:text-accent-300",
  },
  {
    path: "/online/shop",
    label: "online.nav.shop",
    icon: Store,
    tile: "bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300",
  },
  {
    path: "/online/inventory",
    label: "online.nav.inventory",
    icon: Backpack,
    tile: "bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  },
  {
    path: "/online/training",
    label: "online.nav.training",
    icon: Dumbbell,
    tile: "bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300",
  },
];

/**
 * The overview's row of shortcuts on a phone (design m-tong-quan.html): the pages a coach opens
 * every day, one tap from the overview, a count on events with rewards to claim. The desktop
 * keeps them in its header and sidebar instead.
 */
export default function PhoneShortcuts() {
  const { t } = useTranslation();
  const claims = useOnlineStore((state) => claimsWaiting(state.events));
  return (
    <nav aria-label={t("online.overview.shortcuts")}>
      <ul className="grid grid-cols-4 gap-2">
        {SHORTCUTS.map((shortcut) => {
          const badge = shortcut.path === "/online/events" && claims > 0 ? claims : undefined;
          return (
            <li key={shortcut.path}>
              <Link
                to={shortcut.path}
                aria-label={badge ? `${t(shortcut.label)} (${badge})` : undefined}
                className="relative flex h-full flex-col items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-1 py-3 text-center shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 active:scale-[0.97] dark:border-navy-600 dark:bg-navy-700 dark:focus:ring-offset-navy-900"
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-lg ${shortcut.tile}`}
                  aria-hidden="true"
                >
                  <shortcut.icon className="h-5 w-5" />
                </span>
                <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                  {t(shortcut.label)}
                </span>
                {badge !== undefined && (
                  <span
                    className="absolute right-1.5 top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white dark:bg-red-500 dark:text-white"
                    aria-hidden="true"
                  >
                    {badge}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
