import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { online } from "../../client";
import { tracked } from "../../store/onlineStore";
import { useOnlineResource } from "../../useOnlineResource";
import { TrophyIcon } from "./TrophyIcon";

/** The coach's online honours on his profile (C20-7): titles and promotions, at any club. */
export default function ProfileHonoursLine() {
  const { t } = useTranslation();
  const { resource } = useOnlineResource(() => tracked(() => online.me.honours()), []);
  if (resource.status !== "ready") return null;
  const { titles, promotions } = resource.data;
  return (
    <p className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-300">
      <TrophyIcon level={1} className="h-5 w-5 shrink-0" />
      {t("online.honours.profileLine", { titles, promotions })}
      <Link
        to="/online/honours"
        className="ml-auto rounded font-semibold text-primary-700 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:text-primary-400 dark:focus:ring-offset-navy-800"
      >
        {t("online.honours.open")}
      </Link>
    </p>
  );
}
