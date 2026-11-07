import { type ReactNode, useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { FOCUS, PhoneSheet } from "./PhoneSheet";

/** One choice of a phone picker. */
export interface PickerOption {
  value: string;
  label: string;
  /** A line under the label: what the choice means, or the player's role. */
  detail?: ReactNode;
  /** Drawn before the label: a shirt number, an icon, a small pitch on a tile. */
  lead?: ReactNode;
  /** A small badge after the label, e.g. the player's position. */
  tag?: string;
  /** A choice that defers to another (no focus of his own, nobody): its label is softer. */
  muted?: boolean;
  disabled?: boolean;
}

const FIELD =
  "relative flex w-full items-center gap-2 rounded-[10px] border bg-white pr-9 text-left text-gray-900 transition-colors disabled:opacity-50 dark:bg-navy-900 dark:text-white";
const FIELD_SIZE = { md: "h-12 pl-3 text-base", sm: "h-11 pl-2.5 text-sm font-semibold" };
const ROW_PICKED = "bg-primary-50 dark:bg-primary-900/35";
const TILE_PICKED =
  "border-primary-500 bg-primary-50 text-gray-900 dark:bg-primary-900/35 dark:text-white";
const TILE_IDLE =
  "border-gray-200 bg-gray-50 text-gray-700 dark:border-navy-700 dark:bg-navy-900 dark:text-gray-200";

/** A shirt number in a ring, the lead of a player's row (design m-thay-nguoi, the bench). */
export function ShirtLead({ number, picked }: { number?: number; picked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-9 w-9 items-center justify-center rounded-full border-2 bg-gray-100 font-heading text-[13px] font-bold text-gray-900 dark:bg-navy-600 dark:text-white ${picked ? "border-primary-500" : "border-transparent"}`}
    >
      {number ?? "–"}
    </span>
  );
}

/** An icon in a rounded square, the lead of a focus or a region. */
export function IconLead({ children, soft = false }: { children: ReactNode; soft?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-9 w-9 items-center justify-center rounded-[10px] bg-gray-100 dark:bg-navy-600 [&>svg]:h-5 [&>svg]:w-5 ${soft ? "text-gray-500 dark:text-gray-300" : "text-primary-700 dark:text-primary-400"}`}
    >
      {children}
    </span>
  );
}

function OptionRow({
  option,
  picked,
  onPick,
}: {
  option: PickerOption;
  picked: boolean;
  onPick: () => void;
}) {
  const row = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (picked) row.current?.scrollIntoView?.({ block: "center" });
  }, [picked]);
  return (
    <button
      ref={row}
      type="button"
      role="option"
      aria-selected={picked}
      disabled={option.disabled}
      onClick={onPick}
      className={`grid min-h-14 w-full ${option.lead ? "grid-cols-[auto_minmax(0,1fr)_20px]" : "grid-cols-[minmax(0,1fr)_20px] pl-4"} items-center gap-2.5 border-t border-gray-100 py-2 pr-3 text-left transition-colors first:border-t-0 active:bg-gray-100 disabled:opacity-50 dark:border-navy-600 dark:active:bg-navy-600 ${option.lead ? "pl-3" : ""} ${picked ? ROW_PICKED : ""} ${FOCUS}`}
    >
      {option.lead}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={`truncate text-[15px] font-semibold ${option.muted ? "text-gray-600 dark:text-gray-300" : "text-gray-900 dark:text-white"}`}
          >
            {option.label}
          </span>
          {option.tag && " "}
          {option.tag && (
            <span className="shrink-0 rounded bg-gray-100 px-1 text-[10px] font-bold leading-[15px] text-gray-600 dark:bg-navy-600 dark:text-gray-200">
              {option.tag}
            </span>
          )}
        </span>
        {option.detail && " "}
        {option.detail && (
          <span className="truncate text-xs text-gray-500 dark:text-gray-400">{option.detail}</span>
        )}
      </span>
      {picked ? (
        <Check className="h-5 w-5 text-primary-600 dark:text-primary-400" aria-hidden="true" />
      ) : (
        <span />
      )}
    </button>
  );
}

/**
 * A phone's dropdown (analysis-mobile-dropdowns bản 2): a field drawn like the designs' `.sel`
 * that opens a sheet of its choices, a list (with a lead, a tag and a detail line) or tiles. A
 * tap on a choice reports it and slides the sheet away. Opened from another sheet, it opens over
 * it and leaves it as it was. The phone's own picker is never shown.
 */
export function PhonePicker({
  label,
  title,
  aside,
  value,
  options,
  onChange,
  layout = "list",
  columns = 2,
  size = "md",
  caption,
  display,
  emphasis = false,
  disabled = false,
  className = "",
}: {
  /** The field's name, read with its value, and the sheet's title unless `title` is given. */
  label: string;
  title?: string;
  aside?: ReactNode;
  value: string;
  options: readonly PickerOption[];
  onChange: (value: string) => void;
  layout?: "list" | "tiles";
  columns?: 2 | 3;
  size?: "md" | "sm";
  /** The field's name drawn small inside it, above the value (the substitutions' shape, style). */
  caption?: string;
  /** How the value reads on the closed field, when the option's label is not enough. */
  display?: ReactNode;
  /** A field being edited (the coach's region): drawn in the green of a choice. */
  emphasis?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLButtonElement>(null);
  const chosen = options.find((option) => option.value === value);
  const sheetTitle = title ?? label;

  const pick = (next: string, close: () => void) => {
    if (next !== value) onChange(next);
    close();
  };
  const closed = () => {
    setOpen(false);
    field.current?.focus();
  };

  return (
    <>
      <button
        ref={field}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`${FIELD} ${FIELD_SIZE[size]} ${caption ? "pt-3.5" : ""} ${open || emphasis ? "border-primary-500" : "border-gray-300 dark:border-navy-600"} ${FOCUS} ${className}`}
      >
        {caption ? (
          <span className="pointer-events-none absolute left-2.5 top-1 text-[10px] font-normal uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {caption}
          </span>
        ) : (
          <span className="sr-only">{label}</span>
        )}
        {/* Keeps the name and the value two words when they are read together. */}{" "}
        <span className="min-w-0 flex-1 truncate">{display ?? chosen?.label ?? ""}</span>
        <ChevronDown
          aria-hidden="true"
          className={`pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <PhoneSheet title={sheetTitle} aside={aside} stacked onClose={closed}>
          {(close) =>
            layout === "tiles" ? (
              <div
                role="radiogroup"
                aria-label={sheetTitle}
                className={`grid gap-2 ${columns === 3 ? "grid-cols-3" : "grid-cols-2"}`}
              >
                {options.map((option) => {
                  const on = option.value === value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={option.label}
                      disabled={option.disabled}
                      onClick={() => pick(option.value, close)}
                      className={`flex min-h-11 flex-col items-center justify-center gap-1 rounded-[10px] border px-1.5 py-2 text-[13px] font-semibold transition-colors disabled:opacity-50 ${on ? TILE_PICKED : TILE_IDLE} ${FOCUS}`}
                    >
                      {option.lead}
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div
                role="listbox"
                aria-label={sheetTitle}
                className="overflow-hidden rounded-xl border border-gray-200 dark:border-navy-600"
              >
                {options.map((option) => (
                  <OptionRow
                    key={option.value}
                    option={option}
                    picked={option.value === value}
                    onPick={() => pick(option.value, close)}
                  />
                ))}
              </div>
            )
          }
        </PhoneSheet>
      )}
    </>
  );
}
