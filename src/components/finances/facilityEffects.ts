import type { FacilityEffectFormat } from "../../services/financeService";

/**
 * Write one facility effect's numbers for `language`, as the backend projected
 * them: the numbers are the game's own, only their spelling is decided here.
 * Returns `null` for an effect that changes nothing at this level, which the
 * dialog writes as "no change".
 */
export function formatFacilityEffect(
  format: FacilityEffectFormat,
  values: number[],
  language: string,
): string | null {
  const [value = 0] = values;
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const percent = (signDisplay: "auto" | "exceptZero") =>
    new Intl.NumberFormat(language, {
      style: "percent",
      maximumFractionDigits: 1,
      signDisplay,
    });

  switch (format) {
    case "multiplier":
      return `×${new Intl.NumberFormat(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)}`;
    case "percentChange":
      return value === 0 ? null : percent("exceptZero").format(value / 100);
    case "percent":
      return percent("auto").format(value / 100);
    case "count":
      return value === 0
        ? null
        : new Intl.NumberFormat(language, { signDisplay: "exceptZero" }).format(value);
    case "value":
      return number.format(value);
    case "split":
      return values.map((share) => percent("auto").format(share / 100)).join(" / ");
  }
}

/** Whether an effect's numbers move with the upgrade. */
export function effectChanges(current: number[], next: number[] | null): boolean {
  return next?.some((value, index) => value !== current[index]) ?? false;
}
