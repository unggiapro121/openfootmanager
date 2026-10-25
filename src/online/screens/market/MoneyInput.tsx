import { useId } from "react";
import { useTranslation } from "react-i18next";

/**
 * A whole number of euros as the player types it (C-5 C5-11): grouped the way their language
 * groups digits, sent on as a plain number. Anything but digits is ignored.
 */
export default function MoneyInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const { i18n } = useTranslation();
  const id = useId();
  const shown =
    value === null
      ? ""
      : new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(value);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-gray-600 dark:text-gray-300">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={shown}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "");
          onChange(digits === "" ? null : Number(digits));
        }}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-right text-sm tabular-nums text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-100"
      />
    </div>
  );
}
