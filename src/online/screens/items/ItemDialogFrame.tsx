import { type ReactNode, type RefObject, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useBackAction } from "../../../hooks/useBackAction";
import { usePhoneLayout } from "../../../hooks/usePhoneLayout";
import { ItemIcon } from "./itemLook";

/** Tab and Shift+Tab go round the dialog's own controls, never to the page behind it. */
export function keepFocusInside(dialog: HTMLElement | null, event: KeyboardEvent) {
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
      className={`inline-flex rounded-md px-2 py-0.5 font-heading text-xs font-semibold uppercase tracking-wider max-md:px-1.5 max-md:text-[11px] ${colours}`}
    >
      {children}
    </span>
  );
}

interface FrameProps {
  /** The item whose icon heads the dialog; `icon` heads one that is not an item's. */
  code?: string;
  icon?: ReactNode;
  title: string;
  badges?: ReactNode;
  busy?: boolean;
  describedBy?: string;
  onClose: () => void;
  /** The dialog's buttons and what must sit beside them (an error): a sheet's fixed foot. */
  footer?: ReactNode;
  /** On a phone, a whole page instead of a sheet from the bottom (the account's deletion, M3c1). */
  fullPage?: boolean;
  children: ReactNode;
}

/**
 * The frame of the shop's and the inventory's dialogs (designs cua-hang.html, kho-do.html), and
 * of the coins', the academy's and the crest editor's: the item's icon (or another), badges and
 * name over a close button, the body, then the buttons. It takes the focus when it opens, closes
 * on Escape unless busy, and keeps Tab inside. On a phone it is a sheet from the bottom instead
 * (m-cua-hang, m-kho-do; analysis-mobile-shop-ui-gap D-S9).
 */
export default function ItemDialogFrame(props: FrameProps) {
  const { busy = false, onClose } = props;
  const phone = usePhoneLayout();
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
  // Back is held the whole time the sheet is open: while busy it does nothing, so a purchase on
  // its way never sends the coach back a page (D-S9).
  useBackAction(phone, () => {
    if (!busy) onClose();
  });

  return phone ? (
    <PhoneSheetFrame {...props} busy={busy} dialogRef={dialogRef} />
  ) : (
    <ModalFrame {...props} busy={busy} dialogRef={dialogRef} />
  );
}

type FrameParts = FrameProps & {
  busy: boolean;
  dialogRef: RefObject<HTMLDivElement | null>;
};

function ModalFrame({
  code,
  icon,
  title,
  badges,
  busy,
  describedBy,
  onClose,
  footer,
  children,
  dialogRef,
}: FrameParts) {
  const titleId = useId();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        data-layout="modal"
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
          <CloseButton onClose={onClose} busy={busy} />
        </div>
        <div className="flex flex-col gap-5 p-6">
          {children}
          {footer}
        </div>
      </div>
    </div>
  );
}

function PhoneSheetFrame({
  code,
  icon,
  title,
  badges,
  busy,
  describedBy,
  onClose,
  footer,
  fullPage = false,
  children,
  dialogRef,
}: FrameParts) {
  const titleId = useId();
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="sheet-backdrop"
        className="absolute inset-0 bg-black/60"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        data-layout={fullPage ? "page" : "sheet"}
        className={`relative flex flex-col bg-white outline-none dark:bg-navy-700 ${
          fullPage
            ? "h-full pt-[var(--safe-top)]"
            : "max-h-[88vh] rounded-t-[20px] border-t border-gray-200 motion-safe:animate-sheet-up dark:border-navy-600"
        }`}
      >
        <div className={`flex flex-col gap-3 px-4 pb-3 ${fullPage ? "pt-4" : "pt-2"}`}>
          {!fullPage && (
            <span
              aria-hidden="true"
              className="mx-auto block h-1 w-10 rounded-full bg-gray-300 dark:bg-navy-600"
            />
          )}
          <div className="flex items-center gap-3">
            {icon ?? (code !== undefined && <ItemIcon code={code} size="lg" />)}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {badges && <span className="flex flex-wrap gap-1.5">{badges}</span>}
              <h2
                id={titleId}
                className="font-heading text-[22px] font-bold uppercase leading-tight tracking-wide text-gray-900 dark:text-white"
              >
                {title}
              </h2>
            </div>
            <CloseButton onClose={onClose} busy={busy} />
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 pb-4">
          {children}
        </div>
        {footer && (
          <footer className="flex flex-col gap-2.5 border-t border-gray-200 bg-gray-50 px-4 pb-[calc(0.875rem+var(--safe-bottom))] pt-3 dark:border-navy-600 dark:bg-navy-800">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

function CloseButton({ onClose, busy }: { onClose: () => void; busy: boolean }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClose}
      disabled={busy}
      aria-label={t("common.close")}
      className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 max-md:m-0 max-md:h-10 max-md:w-10 max-md:rounded-full max-md:bg-gray-100 dark:text-gray-300 dark:hover:bg-navy-600 max-md:dark:bg-navy-600"
    >
      <X className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}

/**
 * The dialogs' row of buttons. On a phone the buttons fill the sheet's foot instead of wrapping:
 * one button takes the whole width; `row` puts a narrow secondary button before a wide main one
 * (m-kho-do).
 */
export function FrameButtons({ row = false, children }: { row?: boolean; children: ReactNode }) {
  return (
    <div
      className={`flex flex-wrap gap-3 max-md:grid max-md:gap-2.5 ${
        row ? "max-md:grid-cols-[auto_minmax(0,1fr)]" : "max-md:grid-cols-1"
      }`}
    >
      {children}
    </div>
  );
}

/**
 * The dialogs' secondary button: close or cancel. A phone's sheet closes by its X, a tap outside
 * or Back, so a button that only closes is left out there unless the design draws it
 * (`keepOnPhone`, D-S8).
 */
export function FrameCancel({
  onClick,
  disabled,
  keepOnPhone = false,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  keepOnPhone?: boolean;
  children: ReactNode;
}) {
  const phone = usePhoneLayout();
  if (phone && !keepOnPhone) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-12 flex-[1_1_120px] rounded-lg border border-gray-300 font-heading text-base font-bold uppercase tracking-wider text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 max-md:px-4.5 dark:border-navy-600 dark:text-gray-300 dark:hover:bg-navy-600 dark:focus:ring-offset-navy-800"
    >
      {children}
    </button>
  );
}

/** The dialogs' main button. */
export const FRAME_ACTION =
  "flex h-12 min-w-0 flex-[2_1_200px] items-center justify-center gap-2 rounded-lg bg-primary-700 px-4 font-heading text-base font-bold uppercase tracking-wider text-white shadow-md transition-all hover:bg-primary-800 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-primary-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary-700 dark:focus:ring-offset-navy-800";
