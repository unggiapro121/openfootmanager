import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { useBackAction } from "../../../hooks/useBackAction";
import { prefersReducedMotion } from "../../../hooks/usePrefersReducedMotion";
import { settleSheet, slideSheetAway } from "./sheetMotion";

export const FOCUS =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-navy-800";

/** How far a sheet must be dragged down by its top before letting go closes it. */
export const DRAG_CLOSE_PX = 80;

/**
 * A sheet risen from the bottom of a phone (designs m-tran-dau, m-hop-thu): its title,
 * then what it holds. A tap on the dimmed page, Escape, the phone's Back or a drag down by its
 * top closes it; it slides away first where the webview can animate.
 *
 * `stacked` opens it over another sheet (a picker from a sheet's field): on the page body, a
 * layer higher, so the sheet under it stays as it was.
 */
export function PhoneSheet({
  title,
  kicker,
  aside,
  stacked = false,
  onClose,
  children,
}: {
  title: string;
  /** A small line above the title, e.g. what the sheet answers, or whose it is with its state. */
  kicker?: ReactNode;
  /** A note beside the title, e.g. the formation in use. */
  aside?: ReactNode;
  stacked?: boolean;
  onClose: () => void;
  /** What it holds; a function is handed the close that slides the sheet away first. */
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const dim = useRef<HTMLButtonElement>(null);
  const leaving = useRef(false);
  const drag = useRef<{ from: number; by: number } | null>(null);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;

  useEffect(() => {
    panel.current?.focus();
  }, []);

  const close = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    slideSheetAway(panel.current, dim.current, prefersReducedMotion(), () => latestClose.current());
  }, []);
  useBackAction(true, close);

  const dragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { from: event.clientY, by: 0 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const dragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || !panel.current) return;
    drag.current.by = Math.max(0, event.clientY - drag.current.from);
    panel.current.style.transform = `translateY(${drag.current.by}px)`;
  };
  const dragEnd = () => {
    const by = drag.current?.by ?? 0;
    drag.current = null;
    if (by > DRAG_CLOSE_PX) close();
    else settleSheet(panel.current, by, prefersReducedMotion());
  };

  const sheet = (
    <div
      className={`fixed inset-0 flex flex-col justify-end ${stacked ? "z-[80]" : "z-[60]"}`}
      // A stacked sheet sits in another sheet's React tree: its taps and keys are its own.
      onClick={stacked ? (event) => event.stopPropagation() : undefined}
      onKeyDown={stacked ? (event) => event.stopPropagation() : undefined}
      role="presentation"
    >
      <button
        ref={dim}
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 bg-navy-900/60 motion-safe:animate-dim-in"
        onClick={close}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          close();
        }}
        className="relative flex max-h-[86vh] flex-col gap-3 overflow-y-auto *:shrink-0 rounded-t-[20px] border-t border-gray-200 bg-white px-4 pb-[calc(0.875rem+var(--safe-bottom))] pt-2 focus:outline-none motion-safe:animate-sheet-up dark:border-navy-600 dark:bg-navy-800"
      >
        <div
          data-testid="sheet-grip"
          className="-mx-4 -mt-2 flex touch-none flex-col gap-3 px-4 pt-2"
          onPointerDown={dragStart}
          onPointerMove={dragMove}
          onPointerUp={dragEnd}
          onPointerCancel={dragEnd}
        >
          <span
            className="mx-auto block h-1 w-10 shrink-0 rounded-full bg-gray-300 dark:bg-navy-600"
            aria-hidden="true"
          />
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              {kicker && (
                <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                  {kicker}
                </span>
              )}
              <h2
                id={titleId}
                className="font-heading text-xl font-bold uppercase tracking-wider text-gray-900 dark:text-white"
              >
                {title}
              </h2>
            </div>
            {aside && <span className="text-xs text-gray-500 dark:text-gray-400">{aside}</span>}
          </div>
        </div>
        {typeof children === "function" ? children(close) : children}
      </div>
    </div>
  );
  return stacked ? createPortal(sheet, document.body) : sheet;
}
