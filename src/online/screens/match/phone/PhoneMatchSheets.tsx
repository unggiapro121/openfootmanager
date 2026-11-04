import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { buildPitchRows } from "../../../../components/squad/SquadTab.helpers";
import { getSlotXCoordinates } from "../../../../components/tactics/TacticsTab.helpers";
import { getRoleOptions } from "../../../../lib/playerRoles";
import type { MineView, ProjectedPlayer, SentCommand } from "../../../api";
import type { MatchCommand, PlayerRole, PlayStyle, Side } from "../../../api/engine";
import { openInMatch } from "../../../convert/licence";
import { describeCommand, sentStatus, STYLE_ICONS } from "../MatchCommandPanel";
import { TAKERS, takerCommand } from "../SideOwnOrders";
import { FOCUS, PhoneSheet } from "../../mobile/PhoneSheet";

const KEY = "online.match.phone";
/** Sends an order; `stay` keeps the sheet open for the next (the set-piece takers). */
type Send = (command: MatchCommand, stay?: boolean) => Promise<boolean>;

const PICKED =
  "border-primary-500 bg-primary-50 text-gray-900 dark:bg-primary-900/35 dark:text-white";
const IDLE =
  "border-gray-200 bg-gray-50 text-gray-700 dark:border-navy-700 dark:bg-navy-900 dark:text-gray-200";
const SEND =
  "h-12 rounded-[10px] font-heading text-[17px] font-bold uppercase tracking-wider disabled:bg-gray-200 disabled:text-gray-500 dark:disabled:bg-navy-700 dark:disabled:text-gray-400 bg-primary-700 text-white";
const SELECT =
  "h-11 w-full rounded-[10px] border border-gray-300 bg-white px-3 text-base text-gray-900 dark:border-navy-600 dark:bg-navy-900 dark:text-white";

/** A shape drawn small, attacking to the right: one dot a slot. */
function ShapeThumb({ formation, picked }: { formation: string; picked: boolean }) {
  const rows = buildPitchRows(formation);
  const dots = rows.flatMap((row) => {
    const depth = Number.parseFloat(row.y);
    return getSlotXCoordinates(row.positions.length).map((across) => ({
      x: 4 + ((100 - depth) / 100) * 52,
      y: 3 + (across / 100) * 34,
    }));
  });
  return (
    <svg viewBox="0 0 60 40" className="block w-full rounded bg-primary-800" aria-hidden="true">
      <path d="M30 0V40" className="stroke-white/25" strokeWidth="0.6" />
      {dots.map((dot) => (
        <circle
          key={`${dot.x}-${dot.y}`}
          cx={dot.x}
          cy={dot.y}
          r="2.2"
          className={picked ? "fill-primary-300" : "fill-gray-300"}
        />
      ))}
    </svg>
  );
}

/** The shapes the side may take, as small pitches; the pick is sent with the button. */
export function FormationSheet({
  side,
  current,
  formations,
  minute,
  send,
  onClose,
}: {
  side: Side;
  current: string;
  formations: readonly string[];
  minute: number;
  send: Send;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState(current);
  return (
    <PhoneSheet
      title={t("match.formation")}
      aside={t(`${KEY}.inUse`, { formation: current })}
      onClose={onClose}
    >
      <div role="radiogroup" aria-label={t("match.formation")} className="grid grid-cols-3 gap-2">
        {formations.map((formation) => {
          const on = formation === picked;
          return (
            <button
              key={formation}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={formation}
              onClick={() => setPicked(formation)}
              className={`flex flex-col items-center gap-1 rounded-[10px] border px-1.5 pb-1.5 pt-2 ${on ? PICKED : IDLE} ${FOCUS}`}
            >
              <ShapeThumb formation={formation} picked={on} />
              <span className="font-heading text-[15px] font-bold">{formation}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {t(`${KEY}.effectiveFrom`, { minute })}
      </p>
      <button
        type="button"
        disabled={picked === current}
        onClick={() => void send({ ChangeFormation: { side, formation: picked } })}
        className={`${SEND} ${FOCUS}`}
      >
        {picked === current
          ? t(`${KEY}.pickOther`)
          : t(`${KEY}.sendFormation`, { formation: picked })}
      </button>
    </PhoneSheet>
  );
}

/** The styles the side may play, each with what it asks of the team; a tap sends it. */
export function StyleSheet({
  side,
  current,
  styles,
  minute,
  send,
  onClose,
}: {
  side: Side;
  current: string;
  styles: readonly PlayStyle[];
  minute: number;
  send: Send;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <PhoneSheet title={t("match.playStyle")} onClose={onClose}>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {t(`${KEY}.tapToSend`, { minute })}
      </p>
      <div role="radiogroup" aria-label={t("match.playStyle")} className="flex flex-col gap-1.5">
        {styles.map((style) => {
          const on = style === current;
          return (
            <button
              key={style}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() =>
                on ? onClose() : void send({ ChangePlayStyle: { side, play_style: style } })
              }
              className={`flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2 text-left ${on ? PICKED : IDLE} ${FOCUS}`}
            >
              <span
                aria-hidden="true"
                className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] ${on ? "bg-primary-200 text-primary-800 dark:bg-primary-800 dark:text-primary-200" : "bg-gray-200 text-gray-600 dark:bg-navy-700 dark:text-gray-300"}`}
              >
                {STYLE_ICONS[style]}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px] font-bold">{t(`common.playStyles.${style}`)}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t(`squad.playStyleDescriptions.${style}`)}
                </span>
              </span>
              {on && (
                <Check
                  className="h-5 w-5 shrink-0 text-primary-600 dark:text-primary-400"
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>
    </PhoneSheet>
  );
}

/** A player's role: him, then one of the roles of where he plays that the licence opens. */
function RoleTab({
  mine,
  playing,
  send,
}: {
  mine: MineView;
  playing: ProjectedPlayer[];
  send: Send;
}) {
  const { t } = useTranslation();
  const [playerId, setPlayerId] = useState(playing[0]?.id ?? "");
  const [chosen, setChosen] = useState<PlayerRole | "">("");
  const player = playing.find((one) => one.id === playerId);
  const current = mine.roles.find((line) => line.playerId === playerId)?.role;
  const role = chosen || current || "";
  const options = player
    ? openInMatch(mine.licence, "role", getRoleOptions(player.position, current))
    : [];
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-gray-400">
        {t("online.match.rolePlayer")}
        <select
          aria-label={t("online.match.rolePlayer")}
          value={playerId}
          onChange={(event) => {
            setPlayerId(event.target.value);
            setChosen("");
          }}
          className={`${SELECT} ${FOCUS}`}
        >
          {playing.map((one) => {
            const own = mine.roles.find((line) => line.playerId === one.id)?.role;
            const number = one.shirtNumber !== undefined ? `#${one.shirtNumber} ` : "";
            return (
              <option key={one.id} value={one.id}>
                {`${number}${one.matchName}${own ? ` — ${t(`tactics.playerRoles.${own}`)}` : ""}`}
              </option>
            );
          })}
        </select>
      </label>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {t("online.match.roleChoice")}
      </span>
      <div
        role="radiogroup"
        aria-label={t("online.match.roleChoice")}
        className="grid grid-cols-2 gap-1.5"
      >
        {options.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === role}
            onClick={() => setChosen(option)}
            className={`h-11 rounded-[10px] border text-[13px] font-semibold ${option === role ? PICKED : IDLE} ${FOCUS}`}
          >
            {t(`tactics.playerRoles.${option}`)}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={!player || role === "" || role === current}
        onClick={() => {
          if (!player || role === "") return;
          void send({ ChangePlayerRole: { side: mine.side, player_id: player.id, role } });
        }}
        className={`mt-1 ${SEND} ${FOCUS}`}
      >
        {t("online.match.changeRole")}
      </button>
    </div>
  );
}

/** The captain and the set-piece takers: a change is sent as soon as it is chosen. */
function SetPiecesTab({
  mine,
  playing,
  send,
}: {
  mine: MineView;
  playing: ProjectedPlayer[];
  send: Send;
}) {
  const { t } = useTranslation();
  const onPitch = new Set(playing.map((one) => one.id));
  return (
    <div className="flex flex-col gap-2">
      {TAKERS.map(({ key, label }) => {
        const current = mine.setPieces[key];
        return (
          <label
            key={key}
            className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-2.5 text-[13px] text-gray-700 dark:text-gray-200"
          >
            {t(label)}
            <select
              aria-label={t(label)}
              value={current && onPitch.has(current) ? current : ""}
              onChange={(event) => {
                const id = event.target.value;
                if (id !== "" && id !== current) void send(takerCommand(key, mine.side, id), true);
              }}
              className={`${SELECT} ${FOCUS}`}
            >
              <option value="">{t(`${KEY}.nobody`)}</option>
              {playing.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.shirtNumber !== undefined
                    ? `#${one.shirtNumber} ${one.matchName}`
                    : one.matchName}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      <p className="text-xs text-gray-500 dark:text-gray-400">{t(`${KEY}.takerSends`)}</p>
    </div>
  );
}

/** The roles of the eleven, and the captain and takers, under two tabs. */
export function RolesSheet({
  mine,
  playing,
  send,
  onClose,
}: {
  mine: MineView;
  playing: ProjectedPlayer[];
  send: Send;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"role" | "set">("role");
  const tabs = [
    { id: "role" as const, label: t("online.match.rolesTitle") },
    { id: "set" as const, label: t(`${KEY}.setPieces`) },
  ];
  return (
    <PhoneSheet title={t(`${KEY}.rolesTitle`)} onClose={onClose}>
      <div
        role="tablist"
        aria-label={t(`${KEY}.rolesTitle`)}
        className="grid grid-cols-2 rounded-[10px] border border-gray-200 bg-gray-50 p-[3px] dark:border-navy-700 dark:bg-navy-900"
      >
        {tabs.map((one) => (
          <button
            key={one.id}
            type="button"
            role="tab"
            aria-selected={tab === one.id}
            onClick={() => setTab(one.id)}
            className={`h-[38px] rounded-lg text-[13px] font-semibold ${tab === one.id ? "bg-white text-gray-900 dark:bg-navy-700 dark:text-white" : "text-gray-500 dark:text-gray-400"} ${FOCUS}`}
          >
            {one.label}
          </button>
        ))}
      </div>
      {tab === "role" ? (
        <RoleTab mine={mine} playing={playing} send={send} />
      ) : (
        <SetPiecesTab mine={mine} playing={playing} send={send} />
      )}
    </PhoneSheet>
  );
}

const STATUS_TONE: Record<string, string> = {
  applied: "bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-300",
  refused: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  pending: "bg-accent-100 text-accent-800 dark:bg-accent-900/30 dark:text-accent-300",
};

/** The orders sent this match, newest first, each with what became of it. */
export function OrdersSheet({
  sent,
  outcomes,
  nameOf,
  onClose,
}: {
  sent: SentCommand[];
  outcomes: Record<string, string>;
  nameOf: (id: string) => string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <PhoneSheet title={t(`${KEY}.ordersTitle`, { count: sent.length })} onClose={onClose}>
      {sent.length === 0 ? (
        <p className="text-[13px] text-gray-500 dark:text-gray-400">{t(`${KEY}.noOrders`)}</p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {[...sent].reverse().map((line) => {
            const status = sentStatus(line, outcomes[line.commandId]);
            return (
              <li
                key={line.commandId}
                className="flex items-center gap-2.5 rounded-[10px] bg-gray-50 px-3 py-2.5 dark:bg-navy-900"
              >
                <span className="min-w-0 flex-1 text-[13px] text-gray-900 dark:text-white">
                  {describeCommand(line.command, nameOf, t)}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 text-[11px] font-bold ${STATUS_TONE[status] ?? STATUS_TONE.pending}`}
                >
                  {t(
                    `online.match.sent.${status === "applied" || status === "refused" ? status : "pending"}`,
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </PhoneSheet>
  );
}
