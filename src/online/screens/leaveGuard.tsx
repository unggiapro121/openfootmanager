import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import DashboardModalFrame from "../../components/dashboard/DashboardModalFrame";
import { Button } from "../../components/ui";

/**
 * Asking a coach before they leave their own live match (C-2 §3.6, C2-13): away for
 * `absentGraceSteps` steps, the AI takes their side. The app's router keeps no history a page
 * could block (`BrowserRouter`), so the online mode's own navigation asks instead: every way out
 * of a page in the mode's frame goes through `useGuardedNavigate`. Closing the app cannot be
 * asked about; the server's absence rule covers it.
 */
interface LeaveGuard {
  /** Leave by `go`, after asking when a page holds the coach. */
  leave: (go: () => void) => void;
  /** Whether the page shown holds the coach. */
  hold: (holding: boolean) => void;
}

const LeaveGuardContext = createContext<LeaveGuard>({
  leave: (go) => go(),
  hold: () => {},
});

function LeaveDialog({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDivElement>(null);
  // Staying is the safe choice: it has the focus, as Escape stays too.
  useEffect(() => dialog.current?.querySelector("button")?.focus(), []);
  return (
    <DashboardModalFrame maxWidthClassName="max-w-sm">
      <div
        ref={dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="online-leave-title"
        aria-describedby="online-leave-body"
        onKeyDown={(event) => {
          if (event.key === "Escape") onStay();
        }}
      >
        <h2
          id="online-leave-title"
          className="font-heading text-lg font-bold uppercase tracking-wide text-gray-900 dark:text-white"
        >
          {t("online.leave.title")}
        </h2>
        <p id="online-leave-body" className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          {t("online.leave.body")}
        </p>
        <div className="mt-6 flex gap-3">
          <Button className="flex-1" onClick={onStay}>
            {t("online.leave.stay")}
          </Button>
          <Button className="flex-1" variant="outline" onClick={onLeave}>
            {t("online.leave.go")}
          </Button>
        </div>
      </div>
    </DashboardModalFrame>
  );
}

/** The online frame's guard: asks before a page that holds the coach is left. */
export function LeaveGuardProvider({ children }: { children: ReactNode }) {
  const holding = useRef(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const guard = useMemo<LeaveGuard>(
    () => ({
      leave: (go) => {
        if (holding.current) setPending(() => go);
        else go();
      },
      hold: (value) => {
        holding.current = value;
      },
    }),
    [],
  );
  return (
    <LeaveGuardContext.Provider value={guard}>
      {children}
      {pending && (
        <LeaveDialog
          onStay={() => setPending(null)}
          onLeave={() => {
            setPending(null);
            holding.current = false;
            pending();
          }}
        />
      )}
    </LeaveGuardContext.Provider>
  );
}

/** Hold the coach on this page while `holding`: leaving it asks first. */
export function useLeaveGuard(holding: boolean): void {
  const { hold } = useContext(LeaveGuardContext);
  useEffect(() => {
    hold(holding);
    return () => hold(false);
  }, [hold, holding]);
}

/** `navigate`, asking first when the page shown holds the coach. Going nowhere new asks nothing. */
export function useGuardedNavigate(): (to: string) => void {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { leave } = useContext(LeaveGuardContext);
  return useCallback(
    (to: string) => {
      if (to === pathname) return;
      leave(() => navigate(to));
    },
    [leave, navigate, pathname],
  );
}
