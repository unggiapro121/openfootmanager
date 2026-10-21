import { useTranslation } from "react-i18next";
import { LogOut } from "lucide-react";
import type { CoachAccount } from "../../services/coachService";
import { CountryFlag } from "../ui";

interface CoachAccountCardProps {
  coach: CoachAccount;
  onSwitch: () => void;
}

/** The coach the player is logged in as, on the main menu, with the way back to the login screen. */
export default function CoachAccountCard({ coach, onSwitch }: CoachAccountCardProps) {
  const { t, i18n } = useTranslation();

  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-navy-600 dark:bg-navy-900">
      <CountryFlag
        code={coach.nationality}
        locale={i18n.language}
        className="text-lg leading-none"
      />
      <div className="min-w-0 flex-1">
        <p className="font-heading text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {t("coach.signedInAs")}
        </p>
        <p className="truncate font-heading font-bold uppercase tracking-wide text-gray-900 dark:text-white">
          {coach.first_name} {coach.last_name}
        </p>
        <p className="truncate text-xs text-gray-500 dark:text-gray-400">
          {t(`coach.regions.${coach.region}`)}
        </p>
      </div>
      <button
        type="button"
        onClick={onSwitch}
        className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-heading text-xs font-bold uppercase tracking-wider text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-gray-300 dark:hover:bg-navy-700 dark:hover:text-white dark:focus:ring-offset-navy-800"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
        {t("coach.switchAccount")}
      </button>
    </div>
  );
}
