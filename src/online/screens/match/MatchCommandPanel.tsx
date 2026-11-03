import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Crosshair, Flag, RefreshCw, Shield, Target, Zap } from "lucide-react";
import { FORMATIONS, PLAY_STYLES } from "../../../components/match/types";
import { resolveBackendError } from "../../../utils/backendI18n";
import type { MineView, SentCommand } from "../../api";
import type { MatchCommand, PlayStyle } from "../../api/engine";
import { openInMatch } from "../../convert/licence";
import type { OnlineMatchState } from "../../convert/matchState";
import { withCurrent } from "./matchOptions";
import { OnlineSubPanel } from "./OnlineSubPanel";
import { SECTION_HEADING, SideOwnOrders } from "./SideOwnOrders";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** A command as the coach reads it in the list of what they sent. */
function describeCommand(
  command: MatchCommand,
  nameOf: (id: string) => string,
  t: Translate,
): string {
  if ("Substitute" in command) {
    const { player_on_id, player_off_id } = command.Substitute;
    return t("online.match.order.substitute", {
      on: nameOf(player_on_id),
      off: nameOf(player_off_id),
    });
  }
  if ("SwapPositions" in command) {
    const { player_a_id, player_b_id } = command.SwapPositions;
    return t("online.match.order.swap", { a: nameOf(player_a_id), b: nameOf(player_b_id) });
  }
  if ("ChangeFormation" in command) {
    return t("online.match.order.formation", { formation: command.ChangeFormation.formation });
  }
  if ("ChangePlayStyle" in command) {
    const style = t(`common.playStyles.${command.ChangePlayStyle.play_style}`);
    return t("online.match.order.playStyle", { style });
  }
  if ("ChangePlayerRole" in command) {
    const { player_id, role } = command.ChangePlayerRole;
    return t("online.match.order.role", {
      player: nameOf(player_id),
      role: t(`tactics.playerRoles.${role}`),
    });
  }
  if ("SetCaptain" in command) {
    return t("online.match.order.captain", { player: nameOf(command.SetCaptain.player_id) });
  }
  if ("SetFreeKickTaker" in command) {
    return t("online.match.order.freeKickTaker", {
      player: nameOf(command.SetFreeKickTaker.player_id),
    });
  }
  if ("SetCornerTaker" in command) {
    return t("online.match.order.cornerTaker", {
      player: nameOf(command.SetCornerTaker.player_id),
    });
  }
  if ("SetPenaltyTaker" in command) {
    return t("online.match.order.penaltyTaker", {
      player: nameOf(command.SetPenaltyTaker.player_id),
    });
  }
  return t("online.match.order.other");
}

function SentLine({
  line,
  outcome,
  nameOf,
}: {
  line: SentCommand;
  outcome: string | undefined;
  nameOf: (id: string) => string;
}) {
  const { t } = useTranslation();
  const status = line.status === "pending" && outcome ? outcome : line.status;
  const text =
    status === "applied"
      ? t("online.match.sent.applied")
      : status === "refused"
        ? line.refusal
          ? t("online.match.sent.refusedWhy", { reason: resolveBackendError(line.refusal) })
          : t("online.match.sent.refused")
        : t("online.match.sent.pending");
  const tone =
    status === "applied"
      ? "text-primary-700 dark:text-primary-400"
      : status === "refused"
        ? "text-red-600 dark:text-red-400"
        : "text-gray-500 dark:text-gray-400";
  return (
    <li className="text-xs">
      <span className="text-gray-800 dark:text-gray-100">
        {describeCommand(line.command, nameOf, t)}
      </span>{" "}
      <span className={tone}>{text}</span>
    </li>
  );
}

const HEADING = SECTION_HEADING;

/** The orders the coach sent this match, newest first, with what became of each. */
function SentOrders({
  sent,
  state,
  nameOf,
}: {
  sent: SentCommand[];
  state: OnlineMatchState;
  nameOf: (id: string) => string;
}) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="online-match-sent">
      <h3 id="online-match-sent" className={HEADING}>
        {t("online.match.sent.title")}
      </h3>
      <ul className="flex flex-col gap-1">
        {[...sent].reverse().map((line) => (
          <SentLine
            key={line.commandId}
            line={line}
            outcome={state.outcomes[line.commandId]}
            nameOf={nameOf}
          />
        ))}
      </ul>
    </section>
  );
}

const CHIP =
  "rounded px-2 py-1 font-heading text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50";
const CHIP_ON =
  "bg-primary-500/20 text-primary-600 ring-1 ring-primary-500/50 dark:text-primary-400";
const CHIP_OFF =
  "bg-gray-100 text-gray-600 hover:text-gray-900 dark:bg-navy-700 dark:text-gray-400 dark:hover:text-gray-300";

/** The play styles the side may set, each with the icon the game's own match screen gives it. */
const STYLE_ICONS: Record<PlayStyle, ReactNode> = {
  Balanced: <Target className="h-3 w-3" />,
  Attacking: <Zap className="h-3 w-3" />,
  Defensive: <Shield className="h-3 w-3" />,
  Possession: <RefreshCw className="h-3 w-3" />,
  Counter: <Crosshair className="h-3 w-3" />,
  HighPress: <Flag className="h-3 w-3" />,
};

/**
 * The team controls of the game's own match screen: the substitutions panel, and the formation and
 * the play style as buttons, each change sent to the match as it is chosen. What the buttons grey
 * out is a hint of the side's licence (S-9); the server's check is the rule.
 */
function TeamControls({
  state,
  mine,
  disabled,
  open,
  onOpen,
  onSend,
  initialOff,
  send,
  sent,
}: {
  state: OnlineMatchState;
  mine: MineView;
  disabled: boolean;
  /** The orders sent this match: a substitution still waiting keeps its players spoken for. */
  sent: SentCommand[];
  open: boolean;
  onOpen: (open: boolean) => void;
  onSend: (command: MatchCommand) => Promise<void>;
  initialOff?: string;
  send: (command: MatchCommand, after: () => void) => Promise<void>;
}) {
  const { t } = useTranslation();
  const side = mine.side;
  const own = side === "Home" ? state.home : state.away;
  const formations = withCurrent(openInMatch(mine.licence, "formation", FORMATIONS), own.formation);
  const styles = withCurrent(openInMatch(mine.licence, "playStyle", PLAY_STYLES), own.playStyle);
  return (
    <section aria-labelledby="online-match-shape" className="flex flex-col gap-2">
      <h3 id="online-match-shape" className={HEADING}>
        {t("match.teamControls")}
      </h3>
      <button
        type="button"
        onClick={() => onOpen(!open)}
        disabled={disabled}
        className="flex items-center gap-2 rounded-lg bg-gray-200 px-3 py-2 font-heading text-sm uppercase tracking-wider text-gray-700 transition-colors hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 dark:bg-navy-700 dark:text-gray-300 dark:hover:bg-navy-600"
      >
        <RefreshCw className="h-4 w-4" aria-hidden />
        {t("match.subs")} ({own.subsMade}/{state.maxSubs})
      </button>
      <div>
        <p className="mb-1 font-heading text-[10px] uppercase tracking-widest text-gray-600 dark:text-gray-500">
          {t("match.formation")}
        </p>
        <div className="flex flex-wrap gap-1">
          {formations.map((formation) => (
            <button
              type="button"
              key={formation}
              aria-pressed={own.formation === formation}
              disabled={disabled}
              onClick={() => void send({ ChangeFormation: { side, formation } }, () => {})}
              className={`${CHIP} ${own.formation === formation ? CHIP_ON : CHIP_OFF}`}
            >
              {formation}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 font-heading text-[10px] uppercase tracking-widest text-gray-600 dark:text-gray-500">
          {t("match.playStyle")}
        </p>
        <div className="flex flex-wrap gap-1">
          {styles.map((style) => (
            <button
              type="button"
              key={style}
              aria-pressed={own.playStyle === style}
              disabled={disabled}
              onClick={() => void send({ ChangePlayStyle: { side, play_style: style } }, () => {})}
              className={`flex items-center gap-1 ${CHIP} ${own.playStyle === style ? CHIP_ON : CHIP_OFF}`}
            >
              {STYLE_ICONS[style]}
              {t(`common.playStyles.${style}`)}
            </button>
          ))}
        </div>
      </div>
      {open && (
        <OnlineSubPanel
          state={state}
          mine={mine}
          onSend={onSend}
          sent={sent}
          formations={formations}
          playStyles={styles}
          initialOff={initialOff}
          onClose={() => onOpen(false)}
        />
      )}
    </section>
  );
}

/**
 * The coach's touchline during a live match (C-2 §3.6, C2-11): substitutions, swaps, the shape
 * and the style; the roles, the captain and the set-piece takers, which only the coach sees; each
 * sent to the match and decided in its next gap. What the panel greys out is a hint; the server's
 * check is the rule. The orders sent are listed with what became of them.
 */
export function MatchCommandPanel({
  state,
  mine,
  sent,
  onSend,
  initialOff,
  disabled,
}: {
  state: OnlineMatchState;
  /** The coach's own side of the match: which side, its roles and takers (S8-15). */
  mine: MineView;
  sent: SentCommand[];
  onSend: (command: MatchCommand) => Promise<void>;
  /** A hurt player to have chosen to take off already. */
  initialOff?: string;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const side = mine.side;
  const own = side === "Home" ? state.home : state.away;
  const [error, setError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);
  // A hurt player to take off opens the panel with him chosen, once per player.
  const [panelOpen, setPanelOpen] = useState(initialOff !== undefined);
  const [chosenOff, setChosenOff] = useState(initialOff);
  if (initialOff !== chosenOff) {
    setChosenOff(initialOff);
    if (initialOff) setPanelOpen(true);
  }

  const playing = own.eleven.filter((player) => !state.sentOff.includes(player.id));
  const names = new Map(
    [...own.eleven, ...own.bench].map((player) => [player.id, player.matchName]),
  );
  const nameOf = (id: string) => names.get(id) ?? t("online.tactics.unknownPlayer");
  const blocked = disabled || sending || state.isFinished;

  const send = async (command: MatchCommand, after: () => void) => {
    setSending(true);
    setError(null);
    try {
      await onSend(command);
      after();
    } catch (failure) {
      setError(failure);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      {error !== null && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {resolveBackendError(error)}
        </p>
      )}
      <TeamControls
        state={state}
        mine={mine}
        disabled={blocked}
        open={panelOpen}
        onOpen={setPanelOpen}
        onSend={onSend}
        initialOff={initialOff}
        send={send}
        sent={sent}
      />
      <SideOwnOrders
        mine={mine}
        playing={playing}
        disabled={blocked}
        send={(command, after) => void send(command, after)}
      />
      {sent.length > 0 && <SentOrders sent={sent} state={state} nameOf={nameOf} />}
    </div>
  );
}
