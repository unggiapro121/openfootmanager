import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useOnlineStore } from "../../store/onlineStore";
import ClubCrestMark from "../ClubCrestMark";
import { useGuardedNavigate } from "../leaveGuard";
import { CoinChip, InboxButton } from "../OnlineHeader";
import { isCurrent, navGroupOf, pageTitleKey, seasonText, visibleCoinBalance } from "../shellNav";

const FOCUS =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-navy-800";

/**
 * A phone's app bar (designs m-tong-quan.html and the others): on the overview the club's crest
 * and name, elsewhere the page's name, with the season's day below; then the coins and the inbox.
 * A page under More, reached from a sheet rather than a tab, gets a way back to the overview.
 */
export default function MobileAppBar() {
  const { t } = useTranslation();
  const navigate = useGuardedNavigate();
  const { pathname } = useLocation();
  const club = useOnlineStore((state) => state.club);
  const season = useOnlineStore((state) => state.season);
  const balance = useOnlineStore((state) => visibleCoinBalance(state.coins));
  const group = navGroupOf(pathname);
  const titleKey = group === "overview" ? undefined : pageTitleKey(pathname);
  const title = titleKey ? t(titleKey) : (club?.club.name ?? t("online.title"));

  return (
    <header className="flex items-center gap-2.5 border-b border-gray-200 bg-white/95 px-4 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] backdrop-blur dark:border-navy-700 dark:bg-navy-800/95">
      {group === "more" ? (
        <button
          type="button"
          onClick={() => navigate("/online")}
          aria-label={t("common.back")}
          className={`-ml-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-navy-700 ${FOCUS}`}
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
      ) : group === "overview" && club ? (
        <span className="h-9 w-9 shrink-0" aria-hidden="true">
          <ClubCrestMark profile={club.club} />
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="truncate font-heading text-xl font-bold uppercase leading-tight tracking-wider text-gray-900 dark:text-white">
          {title}
        </h1>
        <p className="truncate text-xs text-gray-500 dark:text-gray-400">{seasonText(t, season)}</p>
      </div>
      {balance !== undefined && (
        <CoinChip balance={balance} current={isCurrent("/online/coins", pathname)} />
      )}
      {club && <InboxButton unread={club.unreadMail} />}
    </header>
  );
}
