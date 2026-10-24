import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Select } from "../../../components/ui";
import { getRoleOptions } from "../../../lib/playerRoles";
import type { MineView, PlayerRoleLine, ProjectedPlayer } from "../../api";
import type { MatchCommand, PlayerRole, SetPieceTakers, Side } from "../../api/engine";

/** The heading style of the touchline's sections, as `MatchCommandPanel` draws them. */
export const SECTION_HEADING =
  "mb-2 text-xs font-heading font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400";

/** A player as the touchline lists him: his shirt number, when he has one, and his name. */
export const playerOptions = (players: ProjectedPlayer[]) =>
  players.map((player) => (
    <option key={player.id} value={player.id}>
      {player.shirtNumber !== undefined
        ? `${player.shirtNumber}. ${player.matchName}`
        : player.matchName}
    </option>
  ));

type Send = (command: MatchCommand, after: () => void) => void;

/**
 * A player's role (C-2 §3.6, C2-11), among the roles of the position he plays in this match: the
 * match refuses any other (`be.error.roleNotValidForPosition`), as the desktop's table
 * mirrors (`lib/playerRoles.ts`). Only the coach's own side reads its roles (S8-15).
 */
function RoleSection({
  playing,
  roles,
  side,
  disabled,
  send,
}: {
  playing: ProjectedPlayer[];
  roles: PlayerRoleLine[];
  side: Side;
  disabled: boolean;
  send: Send;
}) {
  const { t } = useTranslation();
  const [playerId, setPlayerId] = useState("");
  const [chosen, setChosen] = useState<PlayerRole | "">("");
  const player = playing.find((one) => one.id === playerId);
  const current = roles.find((line) => line.playerId === playerId)?.role;
  const role = chosen || current || "";
  const options = player ? getRoleOptions(player.position, current) : [];

  return (
    <section aria-labelledby="online-match-roles" className="flex flex-col gap-2">
      <h3 id="online-match-roles" className={SECTION_HEADING}>
        {t("online.match.rolesTitle")}
      </h3>
      <Select
        selectSize="sm"
        fullWidth
        aria-label={t("online.match.rolePlayer")}
        value={playerId}
        onChange={(event) => {
          setPlayerId(event.target.value);
          setChosen("");
        }}
        disabled={disabled}
      >
        <option value="">{t("online.match.rolePlayer")}</option>
        {playerOptions(playing)}
      </Select>
      <Select
        selectSize="sm"
        fullWidth
        aria-label={t("online.match.roleChoice")}
        value={role}
        onChange={(event) => {
          const next = options.find((one) => one === event.target.value);
          if (next) setChosen(next);
        }}
        disabled={disabled || !player}
      >
        <option value="">{t("online.match.roleChoice")}</option>
        {options.map((one) => (
          <option key={one} value={one}>
            {t(`tactics.playerRoles.${one}`)}
          </option>
        ))}
      </Select>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || !player || role === "" || role === current}
        onClick={() => {
          if (!player || role === "") return;
          send({ ChangePlayerRole: { side, player_id: player.id, role } }, () => setChosen(""));
        }}
      >
        {t("online.match.changeRole")}
      </Button>
    </section>
  );
}

/** Who takes each set piece, and the captain: each one a command of its own. */
const TAKERS = [
  { key: "captain", label: "match.captain" },
  { key: "free_kick_taker", label: "match.freeKickTaker" },
  { key: "corner_taker", label: "match.cornerTaker" },
  { key: "penalty_taker", label: "match.penaltyTaker" },
] as const satisfies readonly { key: keyof SetPieceTakers; label: string }[];

function takerCommand(key: keyof SetPieceTakers, side: Side, player_id: string): MatchCommand {
  switch (key) {
    case "captain":
      return { SetCaptain: { side, player_id } };
    case "free_kick_taker":
      return { SetFreeKickTaker: { side, player_id } };
    case "corner_taker":
      return { SetCornerTaker: { side, player_id } };
    case "penalty_taker":
      return { SetPenaltyTaker: { side, player_id } };
  }
}

/**
 * The captain and the set-piece takers, chosen among the players on the pitch (the match takes
 * no other). A change is sent as soon as it is chosen; the choice shown is the match's own until
 * the order is applied, read again from the coach's side.
 */
function TakersSection({
  playing,
  takers,
  side,
  disabled,
  send,
}: {
  playing: ProjectedPlayer[];
  takers: SetPieceTakers;
  side: Side;
  disabled: boolean;
  send: Send;
}) {
  const { t } = useTranslation();
  const onPitch = new Set(playing.map((player) => player.id));
  return (
    <section aria-labelledby="online-match-takers" className="flex flex-col gap-2">
      <h3 id="online-match-takers" className={SECTION_HEADING}>
        {t("match.setPiecesCaptain")}
      </h3>
      {TAKERS.map(({ key, label }) => {
        const current = takers[key];
        return (
          <Select
            key={key}
            selectSize="sm"
            fullWidth
            aria-label={t(label)}
            value={current && onPitch.has(current) ? current : ""}
            onChange={(event) => {
              const playerId = event.target.value;
              if (playerId !== "" && playerId !== current) {
                send(takerCommand(key, side, playerId), () => {});
              }
            }}
            disabled={disabled}
          >
            <option value="">{`${t(label)} —`}</option>
            {playerOptions(playing)}
          </Select>
        );
      })}
    </section>
  );
}

/**
 * The part of the side only its coach sees (S8-15): every player's role, the captain and the
 * set-piece takers, as the match holds them at its last step (`/mine`).
 */
export function SideOwnOrders({
  mine,
  playing,
  disabled,
  send,
}: {
  mine: MineView;
  /** The eleven still on the pitch: not sent off. */
  playing: ProjectedPlayer[];
  disabled: boolean;
  send: Send;
}) {
  return (
    <>
      <RoleSection
        playing={playing}
        roles={mine.roles}
        side={mine.side}
        disabled={disabled}
        send={send}
      />
      <TakersSection
        playing={playing}
        takers={mine.setPieces}
        side={mine.side}
        disabled={disabled}
        send={send}
      />
    </>
  );
}
