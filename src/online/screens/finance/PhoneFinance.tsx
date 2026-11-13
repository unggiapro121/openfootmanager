import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowLeftRight } from "lucide-react";
import { formatExactMoney } from "../../../lib/valueFormatting";
import type { FinanceView } from "../../api";
import { useOnlineStore } from "../../store/onlineStore";
import { FacilitiesLinkCard, useBuildingFacilities } from "../facilities/FacilityTouchPoints";
import { FOCUS } from "../mobile/PhoneSheet";
import { Banners, signedClass, useKindLabel, wagePerDay } from "./financeShared";
import { FacilitiesTab, KEY, LedgerTab } from "./PhoneFinanceParts";
import { onTablistKeyDown, tabIndexOf } from "../mobile/tablistKeys";

type Tab = "over" | "fac" | "led";
const TABS: Tab[] = ["over", "fac", "led"];
/** Wages this many times the ticket money are worth a warning. */
const WAGE_WARNING_RATIO = 1.5;

const CARD =
  "rounded-[14px] border border-gray-200 bg-white p-3.5 dark:border-navy-700 dark:bg-navy-800";
const HEADING =
  "font-heading text-[17px] font-bold uppercase tracking-wider text-gray-900 dark:text-white";

/**
 * The club's money on a phone (design m-tai-chinh): the balance card (cash, money held for bids,
 * the season and the weekly wages, the way to exchange coins), then three tabs: the overview of
 * the season and the wage bill, the facilities, and the ledger. Every number is the server's.
 */
export default function PhoneFinance({ finance }: { finance: FinanceView }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("over");
  // A season that builds over time upgrades on the facilities screen (c-27 C27-9).
  const building = useBuildingFacilities();
  return (
    <div className="-mx-3 -mt-3 flex flex-col">
      <div className="flex flex-col gap-2.5 px-4 pt-3 empty:hidden">
        <Banners finance={finance} />
      </div>
      <div className="px-4 pt-3">
        <Balance finance={finance} />
      </div>
      <div
        role="tablist"
        onKeyDown={onTablistKeyDown}
        aria-label={t("online.finance.title")}
        className="mt-3 grid grid-cols-3 border-b border-gray-200 px-4 dark:border-navy-700"
      >
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            tabIndex={tabIndexOf(tab === id)}
            onClick={() => setTab(id)}
            className={`-mb-px h-11 whitespace-nowrap border-b-2 font-heading text-[15px] font-bold uppercase tracking-wider ${tab === id ? "border-primary-500 text-gray-900 dark:text-white" : "border-transparent text-gray-500 dark:text-gray-400"} ${FOCUS}`}
          >
            {t(`${KEY}.tab.${id}`)}
          </button>
        ))}
      </div>
      <main className="px-4 pb-6 pt-3">
        {tab === "over" && <Overview finance={finance} />}
        {tab === "fac" &&
          (building ? (
            <FacilitiesLinkCard view={building} />
          ) : (
            <FacilitiesTab cash={finance.cash} locked={finance.locked} />
          ))}
        {tab === "led" && <LedgerTab />}
      </main>
    </div>
  );
}

function Balance({ finance }: { finance: FinanceView }) {
  const { t } = useTranslation();
  const canExchange = useOnlineStore((state) => state.coins?.priceListVersion !== undefined);
  const net = finance.season.reduce((sum, line) => sum + line.amount, 0);
  return (
    <section
      aria-label={t(`${KEY}.balance`)}
      className="flex flex-col gap-3 rounded-[18px] border border-gray-200 bg-linear-to-br from-primary-50 to-white p-4 dark:border-navy-700 dark:from-primary-900/40 dark:to-navy-800"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-widest text-gray-600 dark:text-gray-400">
          {t("online.finance.cash")}
        </span>
        {canExchange && (
          <Link
            to="/online/coins"
            className={`inline-flex h-9 items-center gap-1.5 rounded-full border border-accent-500 bg-accent-50 px-3 text-xs font-bold text-accent-800 dark:bg-accent-900/30 dark:text-accent-300 ${FOCUS}`}
          >
            <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
            {t("online.finance.exchangeCoins")}
          </Link>
        )}
      </div>
      <span
        className={`font-heading text-[38px] font-bold leading-none tabular-nums ${finance.cash < 0 ? "text-red-600 dark:text-red-400" : "text-primary-700 dark:text-primary-400"}`}
      >
        {formatExactMoney(finance.cash)}
      </span>
      {finance.held > 0 && (
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {t(`${KEY}.heldLine`, { amount: formatExactMoney(finance.held) })}
        </span>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5 rounded-xl bg-white/70 px-3 py-2.5 dark:bg-navy-900/60">
          <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t(`${KEY}.seasonNet`)}
          </span>
          <span className={`font-heading text-xl font-bold tabular-nums ${signedClass(net)}`}>
            {formatExactMoney(net)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-xl bg-white/70 px-3 py-2.5 dark:bg-navy-900/60">
          <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t("online.finance.wageBill")}
          </span>
          <span className="font-heading text-xl font-bold tabular-nums text-gray-900 dark:text-white">
            {formatExactMoney(finance.weeklyWageBill)}
          </span>
        </div>
      </div>
    </section>
  );
}

/** The season by kind, each a bar against the largest, its total, and the wage bill. */
function Overview({ finance }: { finance: FinanceView }) {
  const { t, i18n } = useTranslation();
  const label = useKindLabel();
  const total = finance.season.reduce((sum, line) => sum + line.amount, 0);
  const largest = Math.max(1, ...finance.season.map((line) => Math.abs(line.amount)));
  const sumOf = (kind: string) =>
    finance.season.filter((line) => line.kind === kind).reduce((sum, line) => sum + line.amount, 0);
  const tickets = sumOf("tickets");
  const wages = -sumOf("wage");
  const ratio = tickets > 0 ? wages / tickets : 0;
  const ratioText = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(
    ratio,
  );
  const fund = [
    { label: t(`${KEY}.perWeek`), value: formatExactMoney(finance.weeklyWageBill) },
    {
      label: t(`${KEY}.perDay`),
      value: `≈ ${formatExactMoney(wagePerDay(finance.weeklyWageBill))}`,
    },
    ...(finance.academyWeeklyWageBill !== undefined
      ? [
          {
            label: t("online.finance.facility.academy"),
            value: t(`${KEY}.weekly`, { amount: formatExactMoney(finance.academyWeeklyWageBill) }),
          },
        ]
      : []),
  ];
  return (
    <div className="flex flex-col gap-3">
      <section aria-labelledby="phone-season-title" className={`${CARD} flex flex-col gap-3`}>
        <h2 id="phone-season-title" className={HEADING}>
          {t("online.finance.season")}
        </h2>
        {finance.season.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("online.finance.seasonEmpty")}
          </p>
        ) : (
          <>
            {finance.season.map((line) => (
              <div key={line.kind} className="flex flex-col gap-1.5">
                <div className="flex justify-between gap-2 text-[13px]">
                  <span className="text-gray-700 dark:text-gray-300">{label(line.kind)}</span>
                  <strong className={`tabular-nums ${signedClass(line.amount)}`}>
                    {formatExactMoney(line.amount)}
                  </strong>
                </div>
                <div
                  className="h-2.5 overflow-hidden rounded-full bg-gray-200 dark:bg-navy-700"
                  aria-hidden="true"
                >
                  <div
                    className={`h-full ${line.amount < 0 ? "bg-red-400" : "bg-primary-500"}`}
                    style={{ width: `${(Math.abs(line.amount) / largest) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            <div className="flex items-baseline justify-between border-t border-gray-200 pt-2.5 dark:border-navy-700">
              <span className="text-[13px] font-semibold text-gray-900 dark:text-white">
                {t("online.finance.total")}
              </span>
              <span
                className={`font-heading text-2xl font-bold tabular-nums ${signedClass(total)}`}
              >
                {formatExactMoney(total)}
              </span>
            </div>
            {ratio >= WAGE_WARNING_RATIO && (
              <p className="rounded-[10px] bg-red-50 px-3 py-2.5 text-xs leading-snug text-red-800 dark:bg-red-900/25 dark:text-red-300">
                {t(`${KEY}.wageWarning`, { times: ratioText })}
              </p>
            )}
          </>
        )}
      </section>
      <section aria-labelledby="phone-wages-title" className={`${CARD} flex flex-col gap-2.5`}>
        <h2 id="phone-wages-title" className={HEADING}>
          {t("online.finance.wageBill")}
        </h2>
        <dl className="grid grid-cols-3 gap-2">
          {fund.map((cell) => (
            <div key={cell.label} className="rounded-[10px] bg-gray-50 p-2.5 dark:bg-navy-900">
              <dt className="text-[10px] leading-tight text-gray-500 dark:text-gray-400">
                {cell.label}
              </dt>
              <dd className="mt-1 text-[13px] font-bold tabular-nums text-gray-900 dark:text-white">
                {cell.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
