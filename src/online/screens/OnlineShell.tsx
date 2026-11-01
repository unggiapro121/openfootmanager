import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { WifiOff } from "lucide-react";
import { Button } from "../../components/ui";
import { resolveBackendError } from "../../utils/backendI18n";
import { OnlineClockProvider, useOnlineNow } from "../clock";
import { refreshClub, refreshLeague, refreshSeason, useOnlineStore } from "../store/onlineStore";
import { AccountWatcher } from "./AccountWatcher";
import { LeagueWatcher } from "./LeagueWatcher";
import { PlayerPictureSync } from "./PlayerPictureSync";
import { RecoveryWatcher } from "./RecoveryWatcher";
import { LeaveGuardProvider } from "./leaveGuard";
import OnlineGateScreen from "./OnlineGateScreen";
import OnlineHeader from "./OnlineHeader";
import OnlineSidebar from "./OnlineSidebar";
import OnlineNotices from "./OnlineNotices";

/**
 * Routes a coach without a club may still open; every other one sends them to take a club. The
 * account's pages are the person's, not the club's (C-7 C7-1).
 */
const OPEN_WITHOUT_CLUB = [
  "/online/takeover",
  "/online/profile",
  "/online/coins",
  "/online/inventory",
  "/online/shop",
  "/online/events",
];
/** Public pages of the world, open to anyone signed in: other clubs, fixtures, any match. */
const PUBLIC_PREFIXES = ["/online/clubs/", "/online/fixtures/", "/online/match/"];

function openWithoutClub(pathname: string): boolean {
  return (
    OPEN_WITHOUT_CLUB.includes(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

async function refreshShared(): Promise<void> {
  // One by one would leave the header half-read for a moment; together they settle at once.
  const results = await Promise.allSettled([refreshSeason(), refreshClub(), refreshLeague()]);
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw (failed as PromiseRejectedResult).reason;
}

/**
 * The online mode's frame (C2-2, C2-4): sidebar, header and the page. It reads the views every
 * page shares, closes the whole mode when the revision gate does, and warns when the server
 * cannot be reached.
 */
export default function OnlineShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const gate = useOnlineStore((state) => state.gate);
  const network = useOnlineStore((state) => state.network);
  const club = useOnlineStore((state) => state.club);
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = useCallback(() => {
    setLoadError(null);
    refreshShared().catch(setLoadError);
  }, []);

  useEffect(() => {
    useOnlineStore.getState().reset();
    load();
  }, [load]);

  if (gate !== "open") return <OnlineGateScreen gate={gate} />;

  if (club === null && !openWithoutClub(location.pathname)) {
    return <Navigate to="/online/takeover" replace />;
  }

  return (
    <OnlineClockProvider>
      <LeaveGuardProvider>
        <DayTurnWatcher />
        <RecoveryWatcher />
        <AccountWatcher />
        <LeagueWatcher />
        <PlayerPictureSync />
        <OnlineNotices />
        <div className="flex min-h-screen bg-gray-100 dark:bg-navy-900">
          <OnlineSidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            {/* The header and the offline line stay at the top of the window while the page scrolls. */}
            <div className="sticky top-0 z-20 bg-white dark:bg-navy-800">
              <OnlineHeader />
              {network === "offline" && (
                <div
                  role="status"
                  className="flex items-center gap-2 border-b border-accent-400/40 bg-accent-50 px-6 py-2 text-sm text-gray-800 dark:bg-accent-500/10 dark:text-gray-100"
                >
                  <WifiOff className="h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400" />
                  {t("online.offlineBanner")}
                </div>
              )}
            </div>
            <main className="flex-1 p-6 xl:p-8">
              {loadError !== null && club === undefined ? (
                <div className="flex flex-col items-start gap-3">
                  <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                    {resolveBackendError(loadError)}
                  </p>
                  <Button variant="outline" size="sm" onClick={load}>
                    {t("online.retry")}
                  </Button>
                </div>
              ) : club === undefined ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">{t("online.loading")}</p>
              ) : (
                <Outlet />
              )}
            </main>
          </div>
        </div>
      </LeaveGuardProvider>
    </OnlineClockProvider>
  );
}

/**
 * Reads the season and the club again when the region's day turns: the daily job changes the
 * players' condition and injuries, and the season its day (C-2 §3.2).
 */
function DayTurnWatcher() {
  const now = useOnlineNow();
  const nextDayAt = useOnlineStore((state) => state.season?.nextDayAt);
  const [handled, setHandled] = useState<string | null>(null);

  useEffect(() => {
    if (!nextDayAt || handled === nextDayAt) return;
    const turn = Date.parse(nextDayAt);
    if (Number.isNaN(turn) || now < turn) return;
    setHandled(nextDayAt);
    // A failure shows through the store (offline banner, gate); the next turn tries again.
    refreshShared().catch(() => undefined);
  }, [now, nextDayAt, handled]);

  return null;
}
