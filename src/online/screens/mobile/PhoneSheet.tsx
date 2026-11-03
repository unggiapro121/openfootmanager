import { type ReactNode, useEffect, useId, useRef } from "react";

export const FOCUS =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-navy-800";

/**
 * A sheet risen from the bottom of a phone (designs m-tran-dau, m-hop-thu): its title,
 * then what it holds. A tap on the dimmed page or Escape closes it.
 */
export function PhoneSheet({
  title,
  aside,
  onClose,
  children,
}: {
  title: string;
  /** A note beside the title, e.g. the formation in use. */
  aside?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 bg-navy-900/60"
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        className="relative flex max-h-[86vh] flex-col gap-3 overflow-y-auto rounded-t-[20px] border-t border-gray-200 bg-white px-4 pb-[calc(0.875rem+var(--safe-bottom))] pt-2 focus:outline-none motion-safe:animate-sheet-up dark:border-navy-600 dark:bg-navy-800"
      >
        <span
          className="mx-auto block h-1 w-10 shrink-0 rounded-full bg-gray-300 dark:bg-navy-600"
          aria-hidden="true"
        />
        <div className="flex items-baseline justify-between gap-2">
          <h2
            id={titleId}
            className="font-heading text-xl font-bold uppercase tracking-wider text-gray-900 dark:text-white"
          >
            {title}
          </h2>
          {aside && <span className="text-xs text-gray-500 dark:text-gray-400">{aside}</span>}
        </div>
        {children}
      </div>
    </div>
  );
}
