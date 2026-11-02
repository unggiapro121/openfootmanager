import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { Backpack, Banknote, Clock, Coins, Gift, Mail, Plus, Store } from "lucide-react";
import { formatVal } from "../../lib/valueFormatting";
import { formatCoins } from "../format";
import { claimsWaiting, useOnlineStore } from "../store/onlineStore";
import AccountMenu from "./AccountMenu";
import { FriendlyChip } from "./friendly/FriendlyChip";
import { useGuardedNavigate } from "./leaveGuard";
import { isCurrent, pageTitleKey, seasonText, visibleCoinBalance } from "./shellNav";
import { useCountdownText } from "./useCountdownText";

const FOCUS =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-navy-800";

function Divider() {
  return <span className="mx-1 h-7 w-px bg-gray-200 dark:bg-navy-600" aria-hidden="true" />;
}

/** The time left to the coach's next match, opening it. */
function NextMatch({ fixtureId, kickoff }: { fixtureId: string; kickoff: string }) {
  const { t } = useTranslation();
  const navigate = useGuardedNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(`/online/fixtures/${fixtureId}`)}
      className={`inline-flex h-11 items-center gap-2 rounded-lg bg-primary-50 px-3.5 font-heading text-sm font-semibold uppercase tracking-wider text-primary-700 hover:bg-primary-100 dark:bg-primary-900/40 dark:text-primary-300 dark:hover:bg-primary-900/60 ${FOCUS}`}
    >
      <Clock className="h-4 w-4" aria-hidden="true" />
      {t("online.header.nextMatch")}
      <span className="text-base font-bold tabular-nums text-gray-900 dark:text-white">
        {kickoff}
      </span>
    </button>
  );
}

/** The club's money, opening the finance page. */
function Budget({ cash }: { cash: number }) {
  const { t } = useTranslation();
  const navigate = useGuardedNavigate();
  const amount = formatVal(cash);
  return (
    <button
      type="button"
      onClick={() => navigate("/online/finance")}
      aria-label={t("online.header.cash", { amount })}
      className={`inline-flex h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold tabular-nums text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-navy-600 ${FOCUS}`}
    >
      <Banknote className="h-4 w-4 text-primary-600 dark:text-primary-400" aria-hidden="true" />
      {amount}
    </button>
  );
}

/** The coach's coins, opening the wallet; shown once coins are open or held (C-7 Qc7-2). */
export function CoinChip({ balance, current }: { balance: number; current: boolean }) {
  const { t, i18n } = useTranslation();
  const navigate = useGuardedNavigate();
  const amount = formatCoins(balance, i18n.language);
  const tone =
    balance < 0 ? "text-red-600 dark:text-red-400" : "text-accent-700 dark:text-accent-400";
  const frame = current
    ? "border-accent-500 bg-accent-50 dark:border-accent-400 dark:bg-accent-900/40"
    : "border-gray-200 bg-gray-50 hover:bg-gray-100 dark:border-navy-600 dark:bg-navy-900 dark:hover:bg-navy-600";
  return (
    <button
      type="button"
      onClick={() => navigate("/online/coins")}
      aria-current={current ? "page" : undefined}
      aria-label={t("online.header.coins", { amount })}
      className={`inline-flex h-11 items-center gap-2 rounded-lg border pl-3 pr-1.5 font-heading text-lg font-bold tabular-nums ${frame} ${tone} ${FOCUS}`}
    >
      <Coins className="h-4.5 w-4.5" aria-hidden="true" />
      {amount}
      <span
        className="ml-0.5 flex h-7 w-7 items-center justify-center rounded-md bg-accent-100 text-accent-800 dark:bg-accent-900/40 dark:text-accent-300"
        aria-hidden="true"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
    </button>
  );
}

/** One of the person's pages in the header; its name shows once the header has room. */
function HeaderLink({
  path,
  label,
  icon,
  badge,
}: {
  path: string;
  label: string;
  icon: ReactNode;
  badge?: number;
}) {
  const navigate = useGuardedNavigate();
  const { pathname } = useLocation();
  const current = isCurrent(path, pathname);
  return (
    <button
      type="button"
      onClick={() => navigate(path)}
      aria-current={current ? "page" : undefined}
      aria-label={badge ? `${label} (${badge})` : label}
      title={label}
      className={`relative inline-flex h-11 items-center gap-2 rounded-lg px-3 font-heading text-sm uppercase tracking-wider ${FOCUS} ${
        current
          ? "bg-gray-100 font-bold text-primary-700 dark:bg-navy-600 dark:text-primary-400"
          : "font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-navy-600"
      }`}
    >
      <span className="[&>svg]:h-4.5 [&>svg]:w-4.5" aria-hidden="true">
        {icon}
      </span>
      <span className="hidden @5xl:inline">{label}</span>
      {badge ? (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-400 px-1.5 font-sans text-xs font-bold text-navy-900">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

/** The club's inbox, a dot when mail waits unread. */
export function InboxButton({ unread }: { unread: number }) {
  const { t } = useTranslation();
  const navigate = useGuardedNavigate();
  const { pathname } = useLocation();
  const current = isCurrent("/online/inbox", pathname);
  return (
    <button
      type="button"
      onClick={() => navigate("/online/inbox")}
      aria-current={current ? "page" : undefined}
      aria-label={
        unread > 0 ? t("online.header.inboxUnread", { count: unread }) : t("online.nav.inbox")
      }
      className={`relative inline-flex h-11 w-11 items-center justify-center rounded-lg ${FOCUS} ${
        current
          ? "bg-gray-100 text-primary-700 dark:bg-navy-600 dark:text-primary-400"
          : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-navy-600"
      }`}
    >
      <Mail className="h-5 w-5" aria-hidden="true" />
      {unread > 0 && (
        <span
          className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full border-2 border-white bg-primary-500 dark:border-navy-800"
          aria-hidden="true"
        />
      )}
    </button>
  );
}

/**
 * The online header (C-2 §3.1; design vi-coin.html): the page's name and the season's day; then
 * the next match, the club's money and the coins; then the person's pages, the inbox and the
 * account. A container, so the pages' names fold to icons when the header is narrow.
 */
export default function OnlineHeader() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const club = useOnlineStore((state) => state.club);
  const season = useOnlineStore((state) => state.season);
  const finance = useOnlineStore((state) => state.finance);
  const coins = useOnlineStore((state) => state.coins);
  const claims = useOnlineStore((state) => claimsWaiting(state.events));
  const fixture = club?.nextFixture;
  const kickoff = useCountdownText(fixture?.kickoffAt);
  const titleKey = pageTitleKey(pathname);
  const cash = club && finance?.economy ? finance.cash : undefined;
  const balance = visibleCoinBalance(coins);
  const hasMatch = fixture !== undefined && kickoff !== null;
  const hasMoney = cash !== undefined || balance !== undefined;

  return (
    <header className="@container relative z-20 border-b border-gray-200 bg-white px-6 py-3.5 xl:px-8 dark:border-navy-700 dark:bg-navy-800">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="font-heading text-2xl font-bold uppercase leading-tight tracking-wider text-gray-900 dark:text-white">
            {titleKey ? t(titleKey) : (club?.club.name ?? t("online.title"))}
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">{seasonText(t, season)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FriendlyChip />
          {fixture && kickoff && <NextMatch fixtureId={fixture.id} kickoff={kickoff} />}
          {hasMatch && hasMoney && <Divider />}
          {cash !== undefined && <Budget cash={cash} />}
          {balance !== undefined && (
            <CoinChip balance={balance} current={isCurrent("/online/coins", pathname)} />
          )}
          {hasMoney && <Divider />}
          <HeaderLink
            path="/online/events"
            label={t("online.nav.events")}
            icon={<Gift />}
            badge={claims > 0 ? claims : undefined}
          />
          <HeaderLink path="/online/shop" label={t("online.nav.shop")} icon={<Store />} />
          <HeaderLink
            path="/online/inventory"
            label={t("online.nav.inventory")}
            icon={<Backpack />}
          />
          {club && <InboxButton unread={club.unreadMail} />}
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
