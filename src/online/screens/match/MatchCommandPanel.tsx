import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Select } from "../../../components/ui";
import { FORMATIONS, PLAY_STYLES } from "../../../components/match/types";
import { resolveBackendError } from "../../../utils/backendI18n";
import type { ProjectedPlayer, SentCommand } from "../../api";
import type { MatchCommand, PlayStyle, Side } from "../../api/engine";
import { type OnlineMatchState, substitutedOff } from "../../convert/matchState";

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

const HEADING =
  "mb-2 text-xs font-heading font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400";

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

/** The side's shape and style, each change sent as it is chosen. */
function ShapeSection({
  formation,
  playStyle,
  disabled,
  onFormation,
  onPlayStyle,
}: {
  formation: string;
  playStyle: string;
  disabled: boolean;
  onFormation: (formation: string) => void;
  onPlayStyle: (style: PlayStyle) => void;
}) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="online-match-shape" className="flex flex-col gap-2">
      <h3 id="online-match-shape" className={HEADING}>
        {t("match.teamControls")}
      </h3>
      <Select
        selectSize="sm"
        fullWidth
        aria-label={t("match.formation")}
        value={formation}
        onChange={(event) => onFormation(event.target.value)}
        disabled={disabled}
      >
        {FORMATIONS.map((one) => (
          <option key={one} value={one}>
            {one}
          </option>
        ))}
      </Select>
      <Select
        selectSize="sm"
        fullWidth
        aria-label={t("match.playStyle")}
        value={playStyle}
        onChange={(event) => {
          const style = PLAY_STYLES.find((one) => one === event.target.value);
          if (style) onPlayStyle(style);
        }}
        disabled={disabled}
      >
        {PLAY_STYLES.map((style) => (
          <option key={style} value={style}>
            {t(`common.playStyles.${style}`)}
          </option>
        ))}
      </Select>
    </section>
  );
}

const optionsOf = (players: ProjectedPlayer[]) =>
  players.map((player) => (
    <option key={player.id} value={player.id}>
      {player.shirtNumber !== undefined
        ? `${player.shirtNumber}. ${player.matchName}`
        : player.matchName}
    </option>
  ));

/**
 * The coach's touchline during a live match (C-2 §3.6, C2-11): substitutions, swaps, the shape
 * and the style, each sent to the match and decided in its next gap. What the panel greys out is
 * a hint; the server's check is the rule. The orders sent are listed with what became of them.
 */
export function MatchCommandPanel({
  state,
  side,
  sent,
  onSend,
  initialOff,
  disabled,
}: {
  state: OnlineMatchState;
  side: Side;
  sent: SentCommand[];
  onSend: (command: MatchCommand) => Promise<void>;
  /** A hurt player to have chosen to take off already. */
  initialOff?: string;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const own = side === "Home" ? state.home : state.away;
  const [off, setOff] = useState(initialOff ?? "");
  const [on, setOn] = useState("");
  const [swapA, setSwapA] = useState("");
  const [swapB, setSwapB] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);
  const [chosenOff, setChosenOff] = useState(initialOff);
  if (initialOff !== chosenOff) {
    setChosenOff(initialOff);
    if (initialOff) setOff(initialOff);
  }

  const gone = substitutedOff(state, side);
  const playing = own.eleven.filter((player) => !state.sentOff.includes(player.id));
  const bench = own.bench.filter((player) => !gone.has(player.id));
  const subsLeft = own.subsMade < state.maxSubs;
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
      <section aria-labelledby="online-match-subs">
        <h3 id="online-match-subs" className={HEADING}>
          {t("match.substitutions")}{" "}
          <span className="font-sans normal-case tracking-normal">
            {t("match.subsUsed", { used: own.subsMade, max: state.maxSubs })}
          </span>
        </h3>
        <div className="flex flex-col gap-2">
          <Select
            selectSize="sm"
            fullWidth
            aria-label={t("online.match.playerOff")}
            value={off}
            onChange={(event) => setOff(event.target.value)}
            disabled={blocked || !subsLeft}
          >
            <option value="">{t("online.match.playerOff")}</option>
            {optionsOf(playing)}
          </Select>
          <Select
            selectSize="sm"
            fullWidth
            aria-label={t("online.match.playerOn")}
            value={on}
            onChange={(event) => setOn(event.target.value)}
            disabled={blocked || !subsLeft}
          >
            <option value="">{t("online.match.playerOn")}</option>
            {optionsOf(bench)}
          </Select>
          <Button
            size="sm"
            disabled={blocked || !subsLeft || off === "" || on === ""}
            onClick={() =>
              void send({ Substitute: { side, player_off_id: off, player_on_id: on } }, () => {
                setOff("");
                setOn("");
              })
            }
          >
            {subsLeft ? t("match.makeSubstitution") : t("match.allSubsUsed")}
          </Button>
        </div>
      </section>

      <section aria-labelledby="online-match-swap">
        <h3 id="online-match-swap" className={HEADING}>
          {t("online.match.swapTitle")}
        </h3>
        <div className="flex flex-col gap-2">
          <Select
            selectSize="sm"
            fullWidth
            aria-label={t("online.match.swapFirst")}
            value={swapA}
            onChange={(event) => setSwapA(event.target.value)}
            disabled={blocked}
          >
            <option value="">{t("online.match.swapFirst")}</option>
            {optionsOf(own.eleven)}
          </Select>
          <Select
            selectSize="sm"
            fullWidth
            aria-label={t("online.match.swapSecond")}
            value={swapB}
            onChange={(event) => setSwapB(event.target.value)}
            disabled={blocked}
          >
            <option value="">{t("online.match.swapSecond")}</option>
            {optionsOf(own.eleven)}
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={blocked || swapA === "" || swapB === "" || swapA === swapB}
            onClick={() =>
              void send({ SwapPositions: { side, player_a_id: swapA, player_b_id: swapB } }, () => {
                setSwapA("");
                setSwapB("");
              })
            }
          >
            {t("online.match.swap")}
          </Button>
        </div>
      </section>

      <ShapeSection
        formation={own.formation}
        playStyle={own.playStyle}
        disabled={blocked}
        onFormation={(formation) => void send({ ChangeFormation: { side, formation } }, () => {})}
        onPlayStyle={(play_style) => void send({ ChangePlayStyle: { side, play_style } }, () => {})}
      />
      {sent.length > 0 && <SentOrders sent={sent} state={state} nameOf={nameOf} />}
    </div>
  );
}
