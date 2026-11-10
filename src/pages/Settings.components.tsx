/**
 * The presentational pieces of the settings page.
 *
 * Split out when the page crossed the size threshold: these four are pure presentation with no
 * state and no dependency on the page itself, so they are the seam that costs nothing to cut.
 */
import type { ReactNode } from "react";

export function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-navy-800 rounded-2xl border border-gray-200 dark:border-navy-700 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-6 py-4 max-md:px-4 border-b border-gray-100 dark:border-navy-700">
        <span className="text-primary-500">{icon}</span>
        <h2 className="text-sm font-heading font-bold uppercase tracking-wider text-gray-800 dark:text-gray-200">
          {title}
        </h2>
      </div>
      <div className="px-6 py-4 max-md:px-4 flex flex-col gap-5">{children}</div>
    </div>
  );
}

export function SettingRow({
  label,
  description,
  danger,
  children,
}: {
  label: string;
  description: string;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    // On a phone the label goes above and the control below, across the row (M2a-4).
    <div className="flex items-center justify-between gap-4 max-md:flex-col max-md:items-stretch max-md:gap-2">
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm font-medium ${danger ? "text-red-500" : "text-gray-800 dark:text-gray-200"}`}
        >
          {label}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
      </div>
      <div className="flex-shrink-0 max-md:flex max-md:flex-col max-md:items-start">{children}</div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      // On a phone the tap area reaches 44 px above and below the 24 px switch (M2a-4, C1).
      className={`relative w-11 h-6 max-md:before:absolute max-md:before:inset-x-0 max-md:before:-inset-y-2.5 max-md:before:content-[''] rounded-full transition-colors duration-200 ${
        checked ? "bg-primary-500" : "bg-gray-300 dark:bg-navy-600"
      }`}
    >
      <div
        className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200 ${
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: string; label?: string; icon?: ReactNode }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex max-md:w-full rounded-lg bg-gray-100 dark:bg-navy-700 p-0.5 border border-gray-200 dark:border-navy-600">
      {options.map((opt) => (
        <button
          type="button"
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex items-center gap-1.5 px-3 py-1.5 max-md:min-h-11 max-md:flex-1 max-md:justify-center rounded-md text-xs font-heading font-bold uppercase tracking-wider transition-all ${
            value === opt.value
              ? "bg-white dark:bg-navy-500 text-primary-600 dark:text-primary-400 shadow-sm"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
          }`}
        >
          {opt.icon}
          {opt.label || opt.value}
        </button>
      ))}
    </div>
  );
}
