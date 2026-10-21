import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Trash2 } from "lucide-react";
import { formatDate } from "../../lib/helpers";
import type { CoachAccount } from "../../services/coachService";
import { CountryFlag } from "../ui";

interface CoachAccountListProps {
  accounts: CoachAccount[];
  loggingInId: string | null;
  onLogin: (account: CoachAccount) => void;
  onDelete: (id: string) => void;
}

/** The coach accounts on this machine: log in as one, or delete one after confirming. */
export default function CoachAccountList({
  accounts,
  loggingInId,
  onLogin,
  onDelete,
}: CoachAccountListProps) {
  const { t, i18n } = useTranslation();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  return (
    <ul className="flex max-h-[18rem] flex-col gap-2 overflow-y-auto pr-0.5">
      {accounts.map((account) => {
        const name = `${account.first_name} ${account.last_name}`;
        return (
          <li
            key={account.id}
            className="group relative flex w-full items-center rounded-xl border border-gray-200 bg-white transition-all duration-200 hover:border-primary-400 hover:bg-primary-50 dark:border-navy-600 dark:bg-navy-700 dark:hover:border-primary-500 dark:hover:bg-navy-600"
          >
            <button
              type="button"
              aria-label={t("coach.logInAs", { name })}
              disabled={loggingInId !== null}
              onClick={() => onLogin(account)}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-3 text-left focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 dark:focus:ring-offset-navy-800"
            >
              <CountryFlag
                code={account.nationality}
                locale={i18n.language}
                className="text-lg leading-none"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-heading text-sm font-bold uppercase tracking-wide text-gray-900 dark:text-white">
                  {name}
                </span>
                <span className="truncate text-xs text-gray-500 dark:text-gray-400">
                  {t(`coach.regions.${account.region}`)} ·{" "}
                  {account.last_login_at
                    ? t("coach.lastLogin", {
                        date: formatDate(account.last_login_at, i18n.language),
                      })
                    : t("coach.neverLoggedIn")}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-primary-500" />
            </button>

            <button
              type="button"
              aria-label={t("coach.deleteAccount", { name })}
              onClick={() => setConfirmDeleteId(account.id)}
              className="mr-2 shrink-0 rounded-lg p-1.5 text-gray-400 transition-all hover:bg-red-50 hover:text-red-500 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:text-gray-500 dark:hover:bg-red-500/10 dark:hover:text-red-400 dark:focus:ring-offset-navy-800"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>

            {confirmDeleteId === account.id && (
              <div
                role="alertdialog"
                aria-label={t("coach.deleteAccount", { name })}
                className="absolute inset-0 flex items-center justify-end gap-1.5 rounded-xl bg-white px-3 dark:bg-navy-700"
              >
                <p className="mr-auto text-xs text-gray-700 dark:text-gray-300">
                  {t("coach.deleteConfirm", { name })}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onDelete(account.id);
                    setConfirmDeleteId(null);
                  }}
                  className="rounded-lg bg-red-500 px-2.5 py-1 font-heading text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800"
                >
                  {t("menu.delete")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className="rounded-lg bg-gray-200 px-2.5 py-1 font-heading text-xs font-bold uppercase tracking-wider text-gray-700 transition-colors hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:bg-navy-800 dark:text-gray-300 dark:hover:bg-navy-900 dark:focus:ring-offset-navy-800"
                >
                  {t("menu.cancel")}
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
