import { type ReactNode, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { ItemIcon } from "./itemLook";

/** Tab and Shift+Tab go round the dialog's own controls, never to the page behind it. */
function keepFocusInside(dialog: HTMLElement | null, event: KeyboardEvent) {
  if (!dialog) return;
  const controls = Array.from(
    dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input, a[href]"),
  );
  if (controls.length === 0) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === dialog)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

/** A small uppercase badge of the dialog's head: green, gold or plain. */
export function HeadBadge({
  tone,
  children,
}: {
  tone: "green" | "gold" | "plain";
  children: ReactNode;
}) {
  const colours = {
    green: "bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300",
    gold: "bg-accent-100 text-accent-800 dark:bg-accent-900/40 dark:text-accent-300",
    plain: "bg-gray-100 text-gray-600 dark:bg-navy-600 dark:text-gray-400",
  }[tone];
  return (
    <span
      className={`inline-flex rounded-md px-2 py-0.5 font-heading text-xs font-semibold uppercase tracking-wider ${colours}`}
    >
      {children}
    </span>
  );
}

/**
 * The frame of the shop's and the inventory's dialogs (designs cua-hang.html, kho-do.html), and
 * of the overview's crest editor: the item's icon (or another), badges and name over a close
 * button, the body below. It takes the focus when it
 * opens, closes on Escape unless busy, and keeps Tab inside.
 */
export default function ItemDialogFrame({
  code,
  icon,
  title,
  badges,
  busy = false,
  describedBy,
  onClose,
  children,
}: {
  /** The item whose icon heads the dialog; `icon` heads one that is not an item's. */
  code?: string;
  icon?: ReactNode;
  title: string;
  badges?: ReactNode;
  busy?: boolean;
  describedBy?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key === "Tab") keepFocusInside(dialogRef.current, event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        className="max-h-[calc(100vh-32px)] w-full max-w-120 overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-2xl outline-none dark:border-navy-600 dark:bg-navy-700"
      >
        <div className="flex items-start gap-4 border-b border-gray-200 bg-gradient-to-b from-white to-gray-50 px-6 py-5 dark:border-navy-600 dark:from-navy-700 dark:to-navy-800">
          {icon ?? (code !== undefined && <ItemIcon code={code} size="lg" />)}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {badges && <span className="flex flex-wrap gap-1.5">{badges}</span>}
            <h2
              id={titleId}
              className="font-heading text-3xl font-bold uppercase leading-tight tracking-wider text-gray-900 dark:text-gray-100"
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t("common.close")}
            className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-navy-600"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-col gap-5 p-6">{children}</div>
      </div>
    </div>
  );
}

/** The dialogs' secondary button: close or cancel. */
export function FrameCancel({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-12 flex-[1_1_120px] rounded-lg border border-gray-300 font-heading text-base font-bold uppercase tracking-wider text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 dark:border-navy-600 dark:text-gray-300 dark:hover:bg-navy-600 dark:focus:ring-offset-navy-800"
    >
      {children}
    </button>
  );
}

/** The dialogs' main button. */
export const FRAME_ACTION =
  "flex h-12 flex-[2_1_200px] items-center justify-center gap-2 rounded-lg bg-primary-700 px-4 font-heading text-base font-bold uppercase tracking-wider text-white shadow-md transition-all hover:bg-primary-800 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary-700 dark:focus:ring-offset-navy-800";
