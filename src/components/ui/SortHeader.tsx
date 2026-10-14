import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * One sortable column heading of a table (the squad roster, the transfer market).
 *
 * Must stay a module-level component. Declared inside the table's component it would be a new
 * component type on every render, so React would unmount and remount every header cell each time
 * the sort or a filter changed — which `noNestedComponentDefinitions` exists to catch.
 */
export function SortHeader<K extends string>({
  col,
  label,
  ariaLabel,
  sortKey,
  sortDir,
  onSort,
  paddingClassName = "py-2.5 px-4",
}: {
  col: K;
  label: string;
  /**
   * Accessible name when the visible label is a symbol that reads ambiguously, such as `#`. Set on
   * the header as well as the button: the header's name is what a screen reader announces for
   * each cell in the column, and it does not inherit a label from the button inside it.
   */
  ariaLabel?: string;
  /** The column the table is sorted by; `null` when it keeps its own order. */
  sortKey: K | null;
  sortDir: "asc" | "desc";
  onSort: (col: K) => void;
  /** The cell padding, matching the table's other header cells. */
  paddingClassName?: string;
}) {
  const active = sortKey === col;

  // The <th> stays the column header and carries the sort state; the control inside it is a real
  // button, so it is in the tab order and Enter and Space work. The ring is inset rather than
  // offset because the table scrolls inside an `overflow-x-auto` box, which clips anything drawn
  // outside the cell — an offset ring would be cut off along the header row.
  return (
    <th
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
      aria-label={ariaLabel}
      className="p-0"
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        aria-label={ariaLabel}
        className={`flex w-full items-center gap-1 ${paddingClassName} font-heading font-bold uppercase tracking-wider cursor-pointer select-none transition-colors hover:text-primary-400 dark:hover:text-primary-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600 dark:focus-visible:ring-primary-400 ${active ? "text-primary-500 dark:text-primary-400" : "text-gray-500 dark:text-gray-400"}`}
      >
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ChevronUp className="w-3 h-3" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-3 h-3" aria-hidden="true" />
          )
        ) : null}
      </button>
    </th>
  );
}
