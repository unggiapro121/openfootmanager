import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, Check, ChevronUp, Dices, Flag, Loader2, X, Zap } from "lucide-react";
import { FORMATIONS, PLAY_STYLES } from "../../../../components/match/types";
import { resolveBackendError } from "../../../../utils/backendI18n";
import type { MineView, SentCommand } from "../../../api";
import type { MatchCommand } from "../../../api/engine";
import { openInMatch } from "../../../convert/licence";
import type { OnlineMatchState } from "../../../convert/matchState";
import { describeCommand, sentStatus } from "../MatchCommandPanel";
import { withCurrent } from "../matchOptions";
import { OnlineSubPanel } from "../OnlineSubPanel";
import { FormationSheet, OrdersSheet, RolesSheet, StyleSheet } from "./PhoneMatchSheets";
import { FOCUS } from "../../mobile/PhoneSheet";

const KEY = "online.match.phone";
type Sheet = "formation" | "style" | "roles" | "orders" | null;
const TOAST_MS = 2400;

/** A control of the dock: its icon, name and what is set now. */
function DockButton({
  icon,
  label,
  value,
  primary = false,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  primary?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-haspopup="dialog"
      aria-label={`${label}: ${value}`}
      className={`flex h-[76px] min-w-0 flex-col items-center justify-center gap-[3px] rounded-xl px-0.5 disabled:opacity-50 ${primary ? "bg-primary-700 text-white" : "border border-gray-200 bg-white text-gray-900 dark:border-navy-700 dark:bg-navy-800 dark:text-white"} ${FOCUS}`}
    >
      <span aria-hidden="true">{icon}</span>
      <span className="text-xs font-bold">{label}</span>
      <span
        className={`max-w-full truncate px-1 text-[11px] ${primary ? "text-primary-100" : "text-gray-500 dark:text-gray-400"}`}
      >
        {value}
      </span>
    </button>
  );
}

/**
 * The coach's controls at the foot of a phone (design m-tran-dau): the last order sent and what
 * became of it (opening them all), then the substitutions, the shape, the style and the roles,
 * each a sheet; an order goes to the match and is decided in its next gap.
 */
export function PhoneMatchDock({
  state,
  mine,
  sent,
  onSend,
  initialOff,
  disabled,
}: {
  state: OnlineMatchState;
  mine: MineView;
  sent: SentCommand[];
  onSend: (command: MatchCommand) => Promise<void>;
  /** A hurt player to take off: the substitutions open with him chosen, once per player. */
  initialOff?: string;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [subsOpen, setSubsOpen] = useState(initialOff !== undefined);
  const [chosenOff, setChosenOff] = useState(initialOff);
  if (initialOff !== chosenOff) {
    setChosenOff(initialOff);
    if (initialOff) setSubsOpen(true);
  }
  const [error, setError] = useState<unknown>(null);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const own = mine.side === "Home" ? state.home : state.away;
  const playing = own.eleven.filter((player) => !state.sentOff.includes(player.id));
  const names = new Map(
    [...own.eleven, ...own.bench].map((player) => [player.id, player.matchName]),
  );
  const nameOf = (id: string) => names.get(id) ?? t("online.tactics.unknownPlayer");
  const formations = withCurrent(openInMatch(mine.licence, "formation", FORMATIONS), own.formation);
  const styles = withCurrent(openInMatch(mine.licence, "playStyle", PLAY_STYLES), own.playStyle);
  const captain = mine.setPieces.captain;
  const last = sent[sent.length - 1];
  const lastStatus = last ? sentStatus(last, state.outcomes[last.commandId]) : null;

  /** Sends an order, closes the sheet (unless `stay`) and says so; false when it was refused. */
  const send = async (command: MatchCommand, stay = false): Promise<boolean> => {
    setError(null);
    try {
      await onSend(command);
    } catch (failure) {
      setError(failure);
      return false;
    }
    if (!stay) setSheet(null);
    clearTimeout(timer.current);
    setToast(t(`${KEY}.sentToast`, { order: describeCommand(command, nameOf, t) }));
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
    return true;
  };

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 px-2 pb-[var(--safe-bottom)] backdrop-blur dark:border-navy-700 dark:bg-navy-800/95">
        <button
          type="button"
          onClick={() => setSheet("orders")}
          className={`flex h-[34px] w-full items-center gap-2 border-b border-gray-100 px-1.5 text-left text-xs dark:border-navy-700 ${FOCUS}`}
        >
          {lastStatus === "applied" ? (
            <Check
              className="h-3.5 w-3.5 shrink-0 text-primary-600 dark:text-primary-400"
              aria-hidden="true"
            />
          ) : lastStatus === "refused" ? (
            <X className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
          ) : lastStatus ? (
            <Loader2
              className="h-3.5 w-3.5 shrink-0 text-accent-600 motion-safe:animate-spin dark:text-accent-400"
              aria-hidden="true"
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-200">
            {last ? describeCommand(last.command, nameOf, t) : t(`${KEY}.noOrders`)}
          </span>
          {lastStatus && (
            <span
              className={`shrink-0 font-semibold ${lastStatus === "applied" ? "text-primary-700 dark:text-primary-400" : lastStatus === "refused" ? "text-red-600 dark:text-red-400" : "text-accent-700 dark:text-accent-400"}`}
            >
              {t(
                `online.match.sent.${lastStatus === "applied" || lastStatus === "refused" ? lastStatus : "pending"}`,
              )}
            </span>
          )}
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
        </button>
        <nav aria-label={t(`${KEY}.dock`)} className="grid grid-cols-4 gap-1.5 pb-2.5 pt-2">
          <DockButton
            primary
            icon={<ArrowLeftRight className="h-5.5 w-5.5" />}
            label={t(`${KEY}.subs`)}
            value={`${own.subsMade}/${state.maxSubs}`}
            disabled={disabled}
            onClick={() => setSubsOpen(true)}
          />
          <DockButton
            icon={<Dices className="h-5.5 w-5.5 text-blue-500 dark:text-blue-300" />}
            label={t(`${KEY}.formation`)}
            value={own.formation}
            disabled={disabled}
            onClick={() => setSheet("formation")}
          />
          <DockButton
            icon={<Zap className="h-5.5 w-5.5 text-accent-600 dark:text-accent-400" />}
            label={t(`${KEY}.style`)}
            value={t(`common.playStyles.${own.playStyle}`)}
            disabled={disabled}
            onClick={() => setSheet("style")}
          />
          <DockButton
            icon={<Flag className="h-5.5 w-5.5 text-violet-500 dark:text-violet-300" />}
            label={t(`${KEY}.roles`)}
            value={
              captain ? t(`${KEY}.captainShort`, { name: nameOf(captain) }) : t(`${KEY}.setPieces`)
            }
            disabled={disabled}
            onClick={() => setSheet("roles")}
          />
        </nav>
      </div>

      {sheet === "formation" && (
        <FormationSheet
          side={mine.side}
          current={own.formation}
          formations={formations}
          minute={state.minute}
          send={send}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "style" && (
        <StyleSheet
          side={mine.side}
          current={own.playStyle}
          styles={styles}
          minute={state.minute}
          send={send}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "roles" && (
        <RolesSheet mine={mine} playing={playing} send={send} onClose={() => setSheet(null)} />
      )}
      {sheet === "orders" && (
        <OrdersSheet
          sent={sent}
          outcomes={state.outcomes}
          nameOf={nameOf}
          onClose={() => setSheet(null)}
        />
      )}
      {subsOpen && (
        <OnlineSubPanel
          state={state}
          mine={mine}
          onSend={onSend}
          sent={sent}
          formations={formations}
          playStyles={styles}
          initialOff={initialOff}
          onClose={() => setSubsOpen(false)}
        />
      )}
      {error !== null && (
        <p
          role="alert"
          className="fixed inset-x-4 top-[calc(6rem+var(--safe-top))] z-[70] rounded-xl border border-red-300 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-800 shadow-xl dark:border-red-800 dark:bg-red-900/80 dark:text-red-100"
        >
          {t("online.match.orderRefused", { reason: resolveBackendError(error) })}
        </p>
      )}
      {toast && (
        <p
          role="status"
          className="fixed inset-x-4 top-[calc(6rem+var(--safe-top))] z-[70] rounded-xl border-l-4 border-l-primary-500 bg-white px-3.5 py-2.5 text-[13px] text-gray-900 shadow-xl dark:bg-navy-700 dark:text-white"
        >
          {toast}
        </p>
      )}
    </>
  );
}
