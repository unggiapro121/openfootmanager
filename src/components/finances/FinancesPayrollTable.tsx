import { useState } from "react";
import { useTranslation } from "react-i18next";
import { User } from "lucide-react";
import { Card, CardHeader, CardBody, Badge } from "../ui";
import { calcAge, formatExactMoney, formatVal, positionBadgeVariant } from "../../lib/helpers";
import { getPlayerOvr } from "../../lib/playerOvr";
import { weeklyWageAmount } from "../../lib/finance";
import type { PlayerData, PlayerSelectionOptions, StaffData } from "../../store/gameStore";
import ContextMenu from "../ContextMenu";
import { translatePositionAbbreviation } from "../squad/SquadTab.helpers";
import { staffOvr } from "../staff/staffRating";

type PayrollView = "players" | "staff";

interface FinancesPayrollTableProps {
  roster: PlayerData[];
  /** The club's staff, who are paid from the same wage bill. */
  staff: StaffData[];
  onSelectPlayer?: (id: string, options?: PlayerSelectionOptions) => void;
}

const HEADER_CELL =
  "py-3 px-5 font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400";
const HEADER_ROW =
  "bg-gray-50 dark:bg-navy-800 border-b border-gray-200 dark:border-navy-600 text-xs";

export default function FinancesPayrollTable({
  roster,
  staff,
  onSelectPlayer,
}: FinancesPayrollTableProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<PayrollView>("players");
  const tabs: { id: PayrollView; label: string }[] = [
    { id: "players", label: t("finances.payrollPlayers", { count: roster.length }) },
    { id: "staff", label: t("finances.payrollStaff", { count: staff.length }) },
  ];

  return (
    <Card className="lg:col-span-3">
      <CardHeader
        action={
          <div className="flex gap-1" role="tablist" aria-label={t("finances.payroll")}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                id={`payroll-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={view === tab.id}
                aria-controls="payroll-tabpanel"
                onClick={() => setView(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-heading font-bold uppercase tracking-wider transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800 ${
                  view === tab.id
                    ? "bg-primary-500 text-white shadow-sm"
                    : "bg-white dark:bg-navy-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-navy-600 hover:text-gray-700 dark:hover:text-gray-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        }
      >
        {t("finances.payroll")}
      </CardHeader>
      <CardBody className="p-0">
        <div
          className="overflow-x-auto"
          id="payroll-tabpanel"
          role="tabpanel"
          aria-labelledby={`payroll-tab-${view}`}
        >
          {view === "players" ? (
            <PlayerPayroll roster={roster} onSelectPlayer={onSelectPlayer} />
          ) : (
            <StaffPayroll staff={staff} />
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function PlayerPayroll({
  roster,
  onSelectPlayer,
}: Pick<FinancesPayrollTableProps, "roster" | "onSelectPlayer">) {
  const { t } = useTranslation();

  return (
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className={HEADER_ROW}>
          <th className={HEADER_CELL}>{t("common.player")}</th>
          <th className={HEADER_CELL}>{t("common.position")}</th>
          <th className={HEADER_CELL}>{t("common.age")}</th>
          <th className={HEADER_CELL}>{t("common.ovr")}</th>
          <th className={HEADER_CELL}>{t("finances.wagePerWeek")}</th>
          <th className={HEADER_CELL}>{t("finances.marketValue")}</th>
          <th className={HEADER_CELL}>{t("common.contract")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 dark:divide-navy-600">
        {[...roster]
          .sort((a, b) => b.wage - a.wage)
          .slice(0, 10)
          .map((p) => {
            const contextItems = onSelectPlayer
              ? [
                  {
                    label: t("squad.viewProfile"),
                    icon: <User className="w-4 h-4" />,
                    onClick: () => onSelectPlayer(p.id),
                  },
                ]
              : [];

            const row = (
              <tr
                key={p.id}
                onClick={() => onSelectPlayer?.(p.id)}
                onKeyDown={
                  onSelectPlayer
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelectPlayer(p.id);
                        }
                      }
                    : undefined
                }
                role={onSelectPlayer ? "button" : undefined}
                tabIndex={onSelectPlayer ? 0 : undefined}
                className={`hover:bg-gray-50 dark:hover:bg-navy-700/50 transition-colors ${onSelectPlayer ? "cursor-pointer group" : ""}`}
              >
                <td className="py-3 px-5 font-semibold text-sm text-gray-800 dark:text-gray-200">
                  <span className="group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                    {p.full_name}
                  </span>
                </td>
                <td className="py-3 px-5">
                  <Badge variant={positionBadgeVariant(p.position)}>
                    {translatePositionAbbreviation(t, p.position)}
                  </Badge>
                </td>
                <td className="py-3 px-5 text-sm text-gray-600 dark:text-gray-400 tabular-nums">
                  {calcAge(p.date_of_birth)}
                </td>
                <td className="py-3 px-5 font-heading font-bold text-sm text-gray-800 dark:text-gray-200 tabular-nums">
                  {getPlayerOvr(p)}
                </td>
                <td className="py-3 px-5 text-sm font-medium text-gray-700 dark:text-gray-300">
                  {formatExactMoney(weeklyWageAmount(p.wage))}
                </td>
                <td className="py-3 px-5 text-sm text-gray-600 dark:text-gray-400">
                  {formatVal(p.market_value)}
                </td>
                <td className="py-3 px-5 text-sm text-gray-500 dark:text-gray-400">
                  {p.contract_end
                    ? t("finances.until", {
                        year: p.contract_end.substring(0, 4),
                      })
                    : "—"}
                </td>
              </tr>
            );

            if (!onSelectPlayer) {
              return row;
            }

            return (
              <ContextMenu items={contextItems} key={p.id}>
                {row}
              </ContextMenu>
            );
          })}
      </tbody>
    </table>
  );
}

function StaffPayroll({ staff }: Pick<FinancesPayrollTableProps, "staff">) {
  const { t } = useTranslation();

  if (staff.length === 0) {
    return (
      <p className="py-8 px-5 text-center text-sm text-gray-400 dark:text-gray-500">
        {t("finances.payrollNoStaff")}
      </p>
    );
  }

  return (
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className={HEADER_ROW}>
          <th className={HEADER_CELL}>{t("finances.staffName")}</th>
          <th className={HEADER_CELL}>{t("finances.staffRole")}</th>
          <th className={HEADER_CELL}>{t("common.age")}</th>
          <th className={HEADER_CELL}>{t("common.ovr")}</th>
          <th className={HEADER_CELL}>{t("finances.wagePerWeek")}</th>
          <th className={HEADER_CELL}>{t("common.contract")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 dark:divide-navy-600">
        {[...staff]
          .sort((a, b) => b.wage - a.wage)
          .map((member) => (
            <tr
              key={member.id}
              className="hover:bg-gray-50 dark:hover:bg-navy-700/50 transition-colors"
            >
              <td className="py-3 px-5 font-semibold text-sm text-gray-800 dark:text-gray-200">
                {member.first_name} {member.last_name}
              </td>
              <td className="py-3 px-5 text-sm text-gray-600 dark:text-gray-400">
                {t(`staff.roles.${member.role}`)}
              </td>
              <td className="py-3 px-5 text-sm text-gray-600 dark:text-gray-400 tabular-nums">
                {calcAge(member.date_of_birth)}
              </td>
              <td className="py-3 px-5 font-heading font-bold text-sm text-gray-800 dark:text-gray-200 tabular-nums">
                {staffOvr(member)}
              </td>
              <td className="py-3 px-5 text-sm font-medium text-gray-700 dark:text-gray-300">
                {formatExactMoney(weeklyWageAmount(member.wage))}
              </td>
              <td className="py-3 px-5 text-sm text-gray-500 dark:text-gray-400">
                {member.contract_end
                  ? t("finances.until", { year: member.contract_end.substring(0, 4) })
                  : "—"}
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}
