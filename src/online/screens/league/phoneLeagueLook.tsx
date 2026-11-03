export const FOCUS =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-navy-900";

/** A result's tint wherever a phone list shows one: green won, grey drawn, red lost. */
export const OUTCOME_TONE: Record<"W" | "D" | "L", string> = {
  W: "bg-primary-100 text-primary-800 dark:bg-primary-900/50 dark:text-primary-300",
  D: "bg-gray-100 text-gray-700 dark:bg-navy-600 dark:text-gray-300",
  L: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300",
};

/** Two or three choices side by side, one picked (the table's compact or full view). */
export function SegmentedChoice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex rounded-lg border border-gray-200 bg-white p-[3px] dark:border-navy-700 dark:bg-navy-800"
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.value)}
            className={`h-[30px] rounded-md px-2.5 text-xs font-semibold ${on ? "bg-gray-100 text-gray-900 dark:bg-navy-700 dark:text-white" : "text-gray-500 dark:text-gray-400"} ${FOCUS}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
