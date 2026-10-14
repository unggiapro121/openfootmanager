import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";

import DashboardModalFrame from "../dashboard/DashboardModalFrame";
import { Button } from "../ui";
import { formatExactMoney } from "../../lib/helpers";
import {
  getFacilityUpgradePreview,
  type FacilityKind,
  type FacilityUpgradePreviewData,
} from "../../services/financeService";
import { resolveBackendError } from "../../utils/backendI18n";
import { effectChanges, formatFacilityEffect } from "./facilityEffects";

interface FacilityUpgradeDialogProps {
  facility: FacilityKind;
  titleKey: string;
  balance: number;
  /** A finance rule that forbids any upgrade now, as a backend error key. */
  blockReason: string | null;
  isUpgrading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Asks before a facility upgrade spends the money: what it costs, what the
 * balance becomes, and every effect now and after — the backend's numbers.
 */
export default function FacilityUpgradeDialog({
  facility,
  titleKey,
  balance,
  blockReason,
  isUpgrading,
  onCancel,
  onConfirm,
}: FacilityUpgradeDialogProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const [preview, setPreview] = useState<FacilityUpgradePreviewData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    getFacilityUpgradePreview(facility)
      .then((loaded) => {
        if (current) setPreview(loaded);
      })
      .catch((error: unknown) => {
        if (current) setLoadError(resolveBackendError(error));
      });
    return () => {
      current = false;
    };
  }, [facility]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isUpgrading) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isUpgrading, onCancel]);

  const cost = preview?.cost ?? null;
  const refusal =
    loadError ??
    (blockReason ? resolveBackendError(blockReason) : null) ??
    (preview && cost === null ? t("finances.facilityMaxLevel") : null) ??
    (cost !== null && balance < cost ? t("finances.insufficientFunds") : null);
  const canConfirm = preview !== null && cost !== null && refusal === null && !isUpgrading;
  const writeEffect = (format: Parameters<typeof formatFacilityEffect>[0], values: number[]) =>
    formatFacilityEffect(format, values, i18n.language) ?? t("finances.facilityEffectNone");

  return (
    <DashboardModalFrame maxWidthClassName="max-w-2xl">
      <div
        className="space-y-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="facility-upgrade-title"
      >
        <h3
          id="facility-upgrade-title"
          className="text-lg font-heading font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
        >
          {preview
            ? t("finances.facilityUpgradeTitle", {
                facility: t(titleKey),
                from: preview.level,
                to: preview.level + 1,
              })
            : t(titleKey)}
        </h3>

        {preview && cost !== null && (
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {t("finances.facilityUpgradeCostLine", {
              cost: formatExactMoney(cost),
              before: formatExactMoney(balance),
              after: formatExactMoney(balance - cost),
            })}
          </p>
        )}

        {preview ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-heading uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <th scope="col" className="py-1 pr-2 font-bold">
                  {t("finances.facilityUpgradeEffect")}
                </th>
                <th scope="col" className="py-1 px-2 text-right font-bold whitespace-nowrap">
                  {t("finances.facilityUpgradeNow")}
                </th>
                <th scope="col" className="py-1 pl-2 text-right font-bold whitespace-nowrap">
                  {t("finances.facilityUpgradeAfter")}
                </th>
              </tr>
            </thead>
            <tbody>
              {preview.effects.map((effect) => {
                const changes = effectChanges(effect.current, effect.next);
                return (
                  <tr
                    key={effect.key}
                    className="border-t border-gray-200 dark:border-navy-600 text-gray-700 dark:text-gray-200"
                  >
                    <th scope="row" className="py-2 pr-2 text-left font-normal">
                      {t(effect.key)}
                    </th>
                    <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">
                      {writeEffect(effect.format, effect.current)}
                    </td>
                    <td
                      className={`py-2 pl-2 text-right tabular-nums whitespace-nowrap ${
                        changes ? "font-semibold text-primary-700 dark:text-primary-300" : ""
                      }`}
                    >
                      {effect.next ? writeEffect(effect.format, effect.next) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          !loadError && (
            <p className="text-sm text-gray-500 dark:text-gray-400">{t("common.loading")}</p>
          )
        )}

        {refusal && <p className="text-sm text-red-500 dark:text-red-400">{refusal}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={isUpgrading}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={!canConfirm}>
            {cost !== null
              ? t("finances.facilityUpgradeConfirm", { cost: formatExactMoney(cost) })
              : t("finances.upgradeFacility")}
          </Button>
        </div>
      </div>
    </DashboardModalFrame>
  );
}
