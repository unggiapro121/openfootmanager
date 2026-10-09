import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { formatMatchDate } from "../../lib/dateFormatting";
import { type FixtureDetailData, getFixtureDetail } from "../../services/matchDetailService";
import { useGameStore } from "../../store/gameStore";
import { lineupFor, localizeDetailNames } from "./MatchDetail.helpers";
import {
  MatchDetailLineups,
  MatchDetailOverview,
  MatchDetailPlayers,
  MatchDetailStats,
} from "./MatchDetailSections";

type Tab = "overview" | "stats" | "lineups" | "players";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; detail: FixtureDetailData };

interface MatchDetailDialogProps {
  fixtureId: string;
  onClose: () => void;
  onSelectPlayer?: (playerId: string) => void;
  onSelectTeam?: (teamId: string) => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Escape closes; Tab stays inside the dialog; focus moves to Close when it opens
 * and goes back to whatever had it when it closes. `aria-modal` alone enforces
 * none of this, so the page behind the overlay would stay tabbable.
 */
function useDialogFocus(
  dialogRef: RefObject<HTMLDivElement | null>,
  initialFocusRef: RefObject<HTMLButtonElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    initialFocusRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, [initialFocusRef]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      const dialog = dialogRef.current;
      if (event.key !== "Tab" || dialog === null) return;
      const focusable = dialog.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const outside = !dialog.contains(active);
      if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        last.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialogRef, onClose]);
}

function availableTabs(detail: FixtureDetailData): Tab[] {
  const tabs: Tab[] = ["overview"];
  if (detail.result?.report) tabs.push("stats");
  if (lineupFor(detail, "home") || lineupFor(detail, "away")) tabs.push("lineups");
  if (detail.playerStats.length > 0) tabs.push("players");
  return tabs;
}

function scoreline(detail: FixtureDetailData, penaltiesLabel: string): string {
  const result = detail.result;
  if (!result) return `${detail.homeTeamName} – ${detail.awayTeamName}`;
  const penalties =
    result.home_penalties != null && result.away_penalties != null
      ? ` (${penaltiesLabel} ${result.home_penalties}–${result.away_penalties})`
      : "";
  return `${detail.homeTeamName} ${result.home_goals} – ${result.away_goals} ${detail.awayTeamName}${penalties}`;
}

interface MatchDetailTabsProps {
  tabs: Tab[];
  selected: Tab;
  labels: Record<Tab, string>;
  label: string;
  panelId: string;
  tabId: (key: Tab) => string;
  onSelect: (key: Tab) => void;
}

/** The tab pattern: one tab stop, and the arrows, Home and End move between tabs. */
function MatchDetailTabs({
  tabs,
  selected,
  labels,
  label,
  panelId,
  tabId,
  onSelect,
}: MatchDetailTabsProps) {
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.indexOf(selected);
    const next: Record<string, number> = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    if (!(event.key in next)) return;
    event.preventDefault();
    const key = tabs[next[event.key]];
    onSelect(key);
    document.getElementById(tabId(key))?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className="mb-4 flex gap-1 border-b border-gray-200 dark:border-navy-700"
    >
      {tabs.map((key) => (
        <button
          key={key}
          type="button"
          role="tab"
          id={tabId(key)}
          aria-selected={selected === key}
          aria-controls={panelId}
          tabIndex={selected === key ? 0 : -1}
          onClick={() => onSelect(key)}
          onKeyDown={onKeyDown}
          className={`-mb-px border-b-2 px-3 py-2 text-xs font-heading font-bold uppercase tracking-wider focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
            selected === key
              ? "border-primary-500 text-primary-600 dark:text-primary-400"
              : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
          }`}
        >
          {labels[key]}
        </button>
      ))}
    </div>
  );
}

/** Everything kept about one fixture, played or not, in a modal dialog. */
export default function MatchDetailDialog({
  fixtureId,
  onClose,
  onSelectPlayer,
  onSelectTeam,
}: MatchDetailDialogProps) {
  const { t, i18n } = useTranslation();
  const ids = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [tab, setTab] = useState<Tab>("overview");
  const world = useGameStore((store) => store.gameState);
  useDialogFocus(dialogRef, closeRef, onClose);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    setTab("overview");
    getFixtureDetail(fixtureId)
      .then((detail) => {
        if (!cancelled) setState({ status: "ready", detail });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [fixtureId]);

  const detail = state.status === "ready" ? localizeDetailNames(state.detail, world, t) : null;
  const tabs = detail ? availableTabs(detail) : [];
  const showTabs = tabs.length > 1;
  const titleId = `${ids}-title`;
  const panelId = `${ids}-panel`;
  const tabId = (key: Tab) => `${ids}-tab-${key}`;
  // A national team has no profile page, so only clubs get a link.
  const isClub = (teamId: string) => world?.teams?.some((team) => team.id === teamId) ?? false;

  const tabLabels: Record<Tab, string> = {
    overview: t("match.overview"),
    stats: t("match.stats"),
    lineups: t("match.lineups"),
    players: t("match.playerRatings"),
  };
  const selectPlayer = onSelectPlayer
    ? (playerId: string) => {
        onClose();
        onSelectPlayer(playerId);
      }
    : undefined;
  const panel = detail ? (
    <>
      {tab === "overview" ? (
        <MatchDetailOverview detail={detail} onSelectPlayer={selectPlayer} />
      ) : null}
      {tab === "stats" ? <MatchDetailStats detail={detail} /> : null}
      {tab === "lineups" ? (
        <MatchDetailLineups detail={detail} onSelectPlayer={selectPlayer} />
      ) : null}
      {tab === "players" ? (
        <MatchDetailPlayers detail={detail} onSelectPlayer={selectPlayer} />
      ) : null}
    </>
  ) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-navy-700 dark:bg-navy-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-navy-700">
          <div>
            <p className="text-xs font-heading uppercase tracking-widest text-gray-500 dark:text-gray-400">
              {detail
                ? `${detail.competitionName} · ${formatMatchDate(detail.date, i18n.language)}`
                : t("match.matchDetails")}
            </p>
            <h2
              id={titleId}
              className="text-lg font-heading font-bold text-gray-900 dark:text-white"
            >
              {detail ? scoreline(detail, t("match.pen")) : t("match.matchDetails")}
            </h2>
            {detail && onSelectTeam ? (
              <div className="mt-1 flex gap-3 text-xs">
                {[
                  { id: detail.homeTeamId, name: detail.homeTeamName },
                  { id: detail.awayTeamId, name: detail.awayTeamName },
                ]
                  .filter((team) => isClub(team.id))
                  .map((team) => (
                    <button
                      key={team.id}
                      type="button"
                      onClick={() => {
                        onClose();
                        onSelectTeam(team.id);
                      }}
                      className="rounded text-primary-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-400"
                    >
                      {team.name}
                    </button>
                  ))}
              </div>
            ) : null}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-heading font-bold uppercase tracking-wider text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-400 dark:hover:bg-navy-800 dark:hover:text-white"
          >
            {t("common.close")}
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {state.status === "loading" ? (
            <p role="status" className="text-sm text-gray-500 dark:text-gray-400">
              {t("common.loading")}
            </p>
          ) : null}
          {state.status === "error" ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {t("match.detailsUnavailable")}
            </p>
          ) : null}
          {detail ? (
            <>
              {showTabs ? (
                <MatchDetailTabs
                  tabs={tabs}
                  selected={tab}
                  labels={tabLabels}
                  label={t("match.matchDetails")}
                  panelId={panelId}
                  tabId={tabId}
                  onSelect={setTab}
                />
              ) : null}
              {showTabs ? (
                <div role="tabpanel" id={panelId} aria-labelledby={tabId(tab)}>
                  {panel}
                </div>
              ) : (
                panel
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
