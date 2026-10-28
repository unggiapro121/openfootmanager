import type { ReactNode } from "react";

/** One tab of a page's tab list (the market's, the inventory's): selected, or not. */
export default function TabButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={`rounded-lg px-4 py-2 font-heading text-sm font-bold uppercase tracking-wider transition-all focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-900 ${
        selected
          ? "bg-primary-700 text-white shadow-md shadow-primary-700/20"
          : "border border-gray-200 bg-white text-gray-500 hover:text-gray-700 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-400 dark:hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}
