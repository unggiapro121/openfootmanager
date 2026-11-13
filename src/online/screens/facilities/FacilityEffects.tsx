import { useTranslation } from "react-i18next";
import { effectChanges, formatFacilityEffect } from "../../../components/finances/facilityEffects";
import type { FacilityEffectView } from "../../api";

/** The formats the game spells; the server sends them as plain strings. */
type FacilityEffectFormat = Parameters<typeof formatFacilityEffect>[0];

/**
 * An effect's label key: the fork's effects send the whole key, the academy's slots only its last
 * part, as the finance page reads them (C-5).
 */
function labelKey(key: string): string {
  return key.includes(".") ? key : `finances.facilityEffects.${key}`;
}

/**
 * What a facility does now and after, from the server's effects (c-27 T1): its numbers are the
 * game's own, only their spelling is decided here. Nothing for a facility the server lists none for.
 */
export function FacilityEffects({
  effects,
  compact = false,
}: {
  effects: FacilityEffectView[];
  /** One line each, as a card shows them; a dialog shows the table with now and after. */
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation();
  if (effects.length === 0) return null;
  const spell = (effect: FacilityEffectView, values: number[]) =>
    formatFacilityEffect(effect.format as FacilityEffectFormat, values, i18n.language) ??
    t("finances.facilityEffectNone");

  if (compact) {
    return (
      <ul className="space-y-0.5 text-xs text-gray-600 dark:text-gray-300">
        {effects.map((effect) => (
          <li key={effect.key}>
            {t(labelKey(effect.key))}:{" "}
            <span className="tabular-nums">{spell(effect, effect.current)}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left font-heading text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
          <th scope="col" className="py-1 pr-2 font-bold">
            {t("finances.facilityUpgradeEffect")}
          </th>
          <th scope="col" className="whitespace-nowrap px-2 py-1 text-right font-bold">
            {t("finances.facilityUpgradeNow")}
          </th>
          <th scope="col" className="whitespace-nowrap py-1 pl-2 text-right font-bold">
            {t("finances.facilityUpgradeAfter")}
          </th>
        </tr>
      </thead>
      <tbody>
        {effects.map((effect) => (
          <tr
            key={effect.key}
            className="border-t border-gray-200 text-gray-700 dark:border-navy-600 dark:text-gray-200"
          >
            <th scope="row" className="py-2 pr-2 text-left font-normal">
              {t(labelKey(effect.key))}
            </th>
            <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
              {spell(effect, effect.current)}
            </td>
            <td
              className={`whitespace-nowrap py-2 pl-2 text-right tabular-nums ${
                effectChanges(effect.current, effect.next)
                  ? "font-semibold text-primary-700 dark:text-primary-300"
                  : ""
              }`}
            >
              {effect.next ? spell(effect, effect.next) : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
