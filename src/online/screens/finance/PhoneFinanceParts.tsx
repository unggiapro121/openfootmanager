import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  ArrowUpCircle,
  Banknote,
  Dumbbell,
  Gavel,
  GraduationCap,
  HeartPulse,
  Receipt,
  Ticket,
} from "lucide-react";
import { effectChanges, formatFacilityEffect } from "../../../components/finances/facilityEffects";
import { formatDate } from "../../../lib/dateFormatting";
import { formatExactMoney } from "../../../lib/valueFormatting";
import { resolveBackendError } from "../../../utils/backendI18n";
import type { FacilityPreviewView, LedgerLineView } from "../../api";
import { FOCUS, PhoneSheet } from "../mobile/PhoneSheet";
import ResourceState from "../ResourceState";
import {
  asPreview,
  effectKeyOf,
  refPath,
  signedClass,
  titleKeyOf,
  useFacilities,
  useFacilityUpgrade,
  useKindLabel,
  useLedger,
} from "./financeShared";

export const KEY = "online.finance.phone";
const CARD =
  "rounded-[14px] border border-gray-200 bg-white p-3.5 dark:border-navy-700 dark:bg-navy-800";

const FACILITY_ICON: Record<string, { icon: ReactNode; tone: string }> = {
  training: {
    icon: <Dumbbell className="h-5 w-5" />,
    tone: "bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300",
  },
  medical: {
    icon: <HeartPulse className="h-5 w-5" />,
    tone: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  },
  academy: {
    icon: <GraduationCap className="h-5 w-5" />,
    tone: "bg-accent-100 text-accent-800 dark:bg-accent-900/40 dark:text-accent-300",
  },
};

/**
 * The facilities tab (design m-tai-chinh): each facility with what it does, its level as pips,
 * what the next level costs (or that the club is short of it), and its upgrade, confirmed in a
 * sheet that says the cash left after it.
 */
export function FacilitiesTab({ cash, locked }: { cash: number; locked: boolean }) {
  const { t } = useTranslation();
  const { resource, reload } = useFacilities();
  const [upgrading, setUpgrading] = useState<FacilityPreviewView | null>(null);
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2.5">
      {done && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {done}
        </p>
      )}
      <ResourceState resource={resource} reload={reload}>
        {(facilities) => (
          <ul className="flex flex-col gap-2.5">
            {facilities.map((facility) => {
              const max = facility.cost === null;
              const short = !max && (facility.cost ?? 0) > cash;
              const look = FACILITY_ICON[facility.facility] ?? FACILITY_ICON.training;
              return (
                <li key={facility.facility} className={`${CARD} flex flex-col gap-2.5`}>
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${look.tone}`}
                    >
                      {look.icon}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-heading text-[17px] font-bold uppercase tracking-wide text-gray-900 dark:text-white">
                        {t(titleKeyOf(facility.facility))}
                      </span>
                      <span className="text-xs leading-snug text-gray-600 dark:text-gray-400">
                        {t(effectKeyOf(facility.facility))}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-center rounded-[10px] border border-gray-200 bg-gray-50 px-2.5 py-1 dark:border-navy-700 dark:bg-navy-900">
                      <span className="text-[9px] uppercase tracking-widest text-gray-500 dark:text-gray-400">
                        {t(`${KEY}.level`)}
                      </span>
                      <span
                        className={`font-heading text-[22px] font-bold leading-none ${max ? "text-accent-600 dark:text-accent-400" : "text-gray-900 dark:text-white"}`}
                      >
                        {facility.level}
                      </span>
                    </span>
                  </div>
                  <div
                    role="img"
                    aria-label={t(`${KEY}.levelOf`, {
                      level: facility.level,
                      max: facility.maxLevel,
                    })}
                    className="grid gap-[3px]"
                    style={{ gridTemplateColumns: `repeat(${facility.maxLevel}, minmax(0, 1fr))` }}
                  >
                    {Array.from({ length: facility.maxLevel }, (_, index) => (
                      <span
                        key={index}
                        className={`h-1.5 rounded-sm ${index < facility.level ? (max ? "bg-accent-500" : "bg-primary-500") : "bg-gray-200 dark:bg-navy-700"}`}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex-1 text-xs ${max ? "text-accent-700 dark:text-accent-400" : short ? "text-red-600 dark:text-red-400" : "text-gray-600 dark:text-gray-400"}`}
                    >
                      {max
                        ? t("finances.facilityMaxLevel")
                        : t(short ? `${KEY}.short` : "online.finance.nextCost", {
                            cost: formatExactMoney(facility.cost ?? 0),
                          })}
                    </span>
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      disabled={max || short || locked}
                      onClick={() => {
                        setDone(null);
                        setUpgrading(facility);
                      }}
                      className={`h-10 shrink-0 rounded-[10px] bg-primary-700 px-4 font-heading text-[15px] font-bold uppercase tracking-wider text-white disabled:bg-gray-200 disabled:text-gray-500 dark:bg-primary-600 dark:disabled:bg-navy-700 dark:disabled:text-gray-400 ${FOCUS}`}
                    >
                      {t("finances.upgradeFacility")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ResourceState>
      {upgrading && (
        <UpgradeSheet
          facility={upgrading}
          cash={cash}
          onClose={() => setUpgrading(null)}
          onDone={(level) => {
            setUpgrading(null);
            setDone(
              t("online.finance.upgraded", { facility: t(titleKeyOf(upgrading.facility)), level }),
            );
            reload();
          }}
        />
      )}
    </div>
  );
}

function UpgradeSheet({
  facility,
  cash,
  onClose,
  onDone,
}: {
  facility: FacilityPreviewView;
  cash: number;
  onClose: () => void;
  onDone: (level: number) => void;
}) {
  const { t } = useTranslation();
  const { confirm, isUpgrading, refusal } = useFacilityUpgrade(facility, onDone);
  const cost = facility.cost ?? 0;
  const { effects } = asPreview(facility);
  return (
    <PhoneSheet
      title={t(`${KEY}.upTitle`, {
        facility: t(titleKeyOf(facility.facility)),
        level: facility.level + 1,
      })}
      onClose={onClose}
    >
      <dl className="flex flex-col gap-2 rounded-xl bg-gray-50 px-3.5 py-3 text-sm dark:bg-navy-900">
        <div className="flex justify-between">
          <dt className="text-gray-600 dark:text-gray-400">{t(`${KEY}.cost`)}</dt>
          <dd className="font-bold tabular-nums text-red-600 dark:text-red-400">
            {formatExactMoney(-cost)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-600 dark:text-gray-400">{t(`${KEY}.cashAfter`)}</dt>
          <dd className="font-bold tabular-nums text-gray-900 dark:text-white">
            {formatExactMoney(cash - cost)}
          </dd>
        </div>
      </dl>
      <p className="text-[13px] leading-normal text-gray-700 dark:text-gray-300">
        {t(effectKeyOf(facility.facility))}
      </p>
      {effects.length > 0 && <EffectTable effects={effects} />}
      {refusal !== null && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {resolveBackendError(refusal)}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onClose}
          className={`h-12 rounded-[10px] border border-gray-300 text-sm font-semibold text-gray-700 dark:border-navy-600 dark:text-gray-200 ${FOCUS}`}
        >
          {t(`${KEY}.later`)}
        </button>
        <button
          type="button"
          disabled={isUpgrading || refusal !== null}
          onClick={confirm}
          className={`h-12 rounded-[10px] bg-primary-700 font-heading text-base font-bold uppercase tracking-wider text-white disabled:opacity-50 dark:bg-primary-600 ${FOCUS}`}
        >
          {t(`${KEY}.upConfirm`)}
        </button>
      </div>
    </PhoneSheet>
  );
}

/**
 * What the upgrade changes, effect by effect, now and after it: the desktop dialog's table
 * (FacilityUpgradeDialog), the moving values set apart.
 */
function EffectTable({ effects }: { effects: ReturnType<typeof asPreview>["effects"] }) {
  const { t, i18n } = useTranslation();
  const write = (effect: (typeof effects)[number], values: number[]) =>
    formatFacilityEffect(effect.format, values, i18n.language) ?? t("finances.facilityEffectNone");
  return (
    <table
      aria-label={t("finances.facilityUpgradeEffect")}
      className="w-full rounded-xl bg-gray-50 text-[13px] dark:bg-navy-900"
    >
      <thead>
        <tr className="text-left text-[10px] font-heading uppercase tracking-wider text-gray-500 dark:text-gray-400">
          <th scope="col" className="px-3.5 pb-1 pt-2.5 font-bold">
            {t("finances.facilityUpgradeEffect")}
          </th>
          <th scope="col" className="px-1.5 pb-1 pt-2.5 text-right font-bold whitespace-nowrap">
            {t("finances.facilityUpgradeNow")}
          </th>
          <th
            scope="col"
            className="pb-1 pl-1.5 pr-3.5 pt-2.5 text-right font-bold whitespace-nowrap"
          >
            {t("finances.facilityUpgradeAfter")}
          </th>
        </tr>
      </thead>
      <tbody>
        {effects.map((effect) => (
          <tr
            key={effect.key}
            className="border-t border-gray-200 text-gray-700 dark:border-navy-700 dark:text-gray-200"
          >
            <th scope="row" className="px-3.5 py-2 text-left font-normal leading-snug">
              {t(effect.key)}
            </th>
            <td className="px-1.5 py-2 text-right tabular-nums whitespace-nowrap">
              {write(effect, effect.current)}
            </td>
            <td
              className={`py-2 pl-1.5 pr-3.5 text-right tabular-nums whitespace-nowrap ${
                effectChanges(effect.current, effect.next)
                  ? "font-semibold text-primary-700 dark:text-primary-300"
                  : ""
              }`}
            >
              {effect.next ? write(effect, effect.next) : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const KIND_ICON: Record<string, ReactNode> = {
  wage: <Banknote className="h-4.5 w-4.5" />,
  tickets: <Ticket className="h-4.5 w-4.5" />,
  facility: <ArrowUpCircle className="h-4.5 w-4.5" />,
  settle: <Gavel className="h-4.5 w-4.5" />,
  bid: <Gavel className="h-4.5 w-4.5" />,
};

type Flow = "all" | "in" | "out";

/** The lines' month, the key they are grouped under. */
function monthOf(line: LedgerLineView): string {
  return (line.gameDate ?? line.at).slice(0, 7);
}

/**
 * The ledger tab (design m-tai-chinh): money in, money out or both; the lines read so far under
 * their months, each month with its sum; and the next page on demand.
 */
export function LedgerTab() {
  const { t, i18n } = useTranslation();
  const label = useKindLabel();
  const { resource, reload, lines, hasMore, more, moreError } = useLedger();
  const [flow, setFlow] = useState<Flow>("all");
  const shown = lines.filter(
    (line) => flow === "all" || (flow === "in" ? line.amount > 0 : line.amount < 0),
  );
  const months = shown.reduce<{ month: string; lines: LedgerLineView[] }[]>((all, line) => {
    const month = monthOf(line);
    const last = all[all.length - 1];
    if (last?.month === month) last.lines.push(line);
    else all.push({ month, lines: [line] });
    return all;
  }, []);
  return (
    <div className="flex flex-col gap-2.5">
      <div
        role="radiogroup"
        aria-label={t(`${KEY}.flow`)}
        className="grid grid-cols-3 rounded-[10px] border border-gray-200 bg-gray-50 p-[3px] dark:border-navy-700 dark:bg-navy-900"
      >
        {(["all", "in", "out"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={flow === id}
            onClick={() => setFlow(id)}
            className={`h-9 rounded-lg text-[13px] font-semibold ${flow === id ? "bg-white text-gray-900 shadow-sm dark:bg-navy-700 dark:text-white" : "text-gray-500 dark:text-gray-400"} ${FOCUS}`}
          >
            {t(`${KEY}.filter.${id}`)}
          </button>
        ))}
      </div>
      <ResourceState resource={resource} reload={reload}>
        {() =>
          shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
              {t("online.finance.ledgerEmpty")}
            </p>
          ) : (
            <ul aria-label={t("online.finance.ledger")} className="flex flex-col">
              {months.map((group) => {
                const sum = group.lines.reduce((total, line) => total + line.amount, 0);
                return (
                  <li key={group.month} className="flex flex-col">
                    <div className="flex items-baseline justify-between px-1 pb-1 pt-2.5">
                      <h3 className="font-heading text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        {formatDate(`${group.month}-01`, i18n.language, {
                          month: "long",
                          year: "numeric",
                        })}
                      </h3>
                      <span className={`text-xs font-bold tabular-nums ${signedClass(sum)}`}>
                        {formatExactMoney(sum)}
                      </span>
                    </div>
                    <ul className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800">
                      {group.lines.map((line) => (
                        <LedgerRow key={line.id} line={line} label={label(line.kind)} />
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )
        }
      </ResourceState>
      {moreError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {moreError}
        </p>
      )}
      {hasMore && (
        <button
          type="button"
          onClick={more}
          className={`h-11 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-800 dark:border-navy-700 dark:bg-navy-800 dark:text-gray-200 ${FOCUS}`}
        >
          {t("online.finance.more")}
        </button>
      )}
    </div>
  );
}

function LedgerRow({ line, label }: { line: LedgerLineView; label: string }) {
  const { t, i18n } = useTranslation();
  const path = refPath(line);
  const income = line.amount > 0;
  const body = (
    <>
      <span
        aria-hidden="true"
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${income ? "bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300" : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"}`}
      >
        {KIND_ICON[line.kind] ?? <Receipt className="h-4.5 w-4.5" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
          {label}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {formatDate(line.gameDate ?? line.at, i18n.language, {
            day: "numeric",
            month: "short",
          })}{" "}
          · {t(`online.finance.account.${line.account}`, { defaultValue: line.account })}
        </span>
      </span>
      <span className={`shrink-0 text-sm font-bold tabular-nums ${signedClass(line.amount)}`}>
        {formatExactMoney(line.amount)}
      </span>
    </>
  );
  const row = "flex min-h-[52px] items-center gap-3 px-3 py-1.5";
  return (
    <li className="border-t border-gray-100 first:border-t-0 dark:border-navy-700">
      {path ? (
        <Link to={path} className={`${row} ${FOCUS}`}>
          {body}
        </Link>
      ) : (
        <div className={row}>{body}</div>
      )}
    </li>
  );
}
