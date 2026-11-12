import { type ReactNode, useEffect, useId, useRef } from "react";
import DashboardModalFrame from "../../../components/dashboard/DashboardModalFrame";
import { usePhoneLayout } from "../../../hooks/usePhoneLayout";
import { FOCUS, PhoneSheet } from "../mobile/PhoneSheet";

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A facilities dialog (c-27 §5.5): a modal over the page on the desktop, a bottom sheet on a
 * phone. Focus moves in and stays in, Escape closes it, and focus goes back to what opened it.
 */
export function FacilityDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const phone = usePhoneLayout();
  if (phone) {
    return (
      <PhoneSheet title={title} onClose={onClose}>
        <div className="flex flex-col gap-4 pb-2">{children}</div>
      </PhoneSheet>
    );
  }
  return (
    <DesktopDialog title={title} onClose={onClose}>
      {children}
    </DesktopDialog>
  );
}

function DesktopDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    return () => opener?.focus();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      latestClose.current();
      return;
    }
    if (event.key !== "Tab" || !panel.current) return;
    const stops = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (stops.length === 0) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === panel.current)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <DashboardModalFrame maxWidthClassName="max-w-lg">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`flex max-h-[80vh] flex-col gap-4 overflow-y-auto rounded-lg ${FOCUS}`}
      >
        <h2
          id={titleId}
          className="font-heading text-lg font-bold uppercase tracking-wider text-gray-900 dark:text-gray-100"
        >
          {title}
        </h2>
        {children}
      </div>
    </DashboardModalFrame>
  );
}

/** The figures of a dialog: a label and its value on each row. */
export function DialogFigures({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-gray-500 dark:text-gray-400">{row.label}</dt>
          <dd className="text-right font-semibold tabular-nums text-gray-900 dark:text-gray-100">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A refused write, in one line (T3). */
export function DialogError({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200"
    >
      {text}
    </p>
  );
}
