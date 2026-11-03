import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SubPanel } from "../../../components/match/SubPanel";
import { usePhoneLayout } from "../../../hooks/usePhoneLayout";
import type { PlayerRole } from "../../../store/types";
import { resolveBackendError } from "../../../utils/backendI18n";
import type { MineView, SentCommand } from "../../api";
import type { MatchCommand, PlayStyle } from "../../api/engine";
import { toSubPanelSnapshot } from "../../convert/subPanel";
import { type OnlineMatchState, toRadarRoster } from "../../convert/matchState";
import { useOnlineStore } from "../../store/onlineStore";
import { PhoneSubPanel } from "./PhoneSubPanel";
import { substitutionsInFlight, swapsInFlight } from "./phoneSubs";

/**
 * The game's own substitution panel over a live online match (the offline `SubPanel`): the pitch
 * with the bench, a change, two players swapping slots, a role, the shape and the style, each sent
 * to the match as a command and decided in its next gap. A refusal is shown over the panel, which
 * stays open for the next try. On a phone, the phone's own full screen (PhoneSubPanel) takes the
 * panel's place.
 */
export function OnlineSubPanel({
  state,
  mine,
  onSend,
  sent,
  formations,
  playStyles,
  initialOff,
  onClose,
}: {
  state: OnlineMatchState;
  mine: MineView;
  onSend: (command: MatchCommand) => Promise<void>;
  /** The orders sent this match, with those the match has not decided yet. */
  sent: SentCommand[];
  /** The shapes and styles the side may pick (its licence), the current ones among them. */
  formations: string[];
  playStyles: PlayStyle[];
  /** A hurt player to have chosen to take off already. */
  initialOff?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const phone = usePhoneLayout();
  const squad = useOnlineStore((store) => store.club?.players);
  const pictures = useOnlineStore((store) => store.playerPictures);
  const [error, setError] = useState<unknown>(null);
  const side = mine.side;
  const snapshot = useMemo(
    () => toSubPanelSnapshot(state, mine, squad ?? []),
    [state, mine, squad],
  );
  const roster = useMemo(() => toRadarRoster(state, squad, pictures), [state, squad, pictures]);

  /** Sends `command`; false when the match refused it, with the reason shown. */
  const send = async (command: MatchCommand): Promise<boolean> => {
    setError(null);
    try {
      await onSend(command);
      return true;
    } catch (failure) {
      setError(failure);
      return false;
    }
  };

  return (
    <>
      {error !== null && (
        <p
          role="alert"
          className="fixed left-1/2 top-4 z-[70] max-w-xl -translate-x-1/2 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 shadow-lg dark:border-red-800 dark:bg-red-900/80 dark:text-red-100"
        >
          {t("online.match.orderRefused", { reason: resolveBackendError(error) })}
        </p>
      )}
      {phone ? (
        <PhoneSubPanel
          snapshot={snapshot}
          roster={roster}
          side={side}
          booked={state.booked}
          inFlight={substitutionsInFlight(sent, state.outcomes)}
          swapsInFlight={swapsInFlight(sent, state.outcomes)}
          formations={formations}
          playStyles={playStyles}
          licence={mine.licence}
          send={send}
          initialOff={initialOff}
          onClose={onClose}
        />
      ) : (
        <SubPanel
          roster={roster}
          snapshot={snapshot}
          side={side}
          initialOff={initialOff}
          onSubstitute={(off, on) =>
            send({ Substitute: { side, player_off_id: off, player_on_id: on } })
          }
          onSwapPositions={(a, b) =>
            void send({ SwapPositions: { side, player_a_id: a, player_b_id: b } })
          }
          onRoleChange={(playerId: string, role: PlayerRole) =>
            void send({ ChangePlayerRole: { side, player_id: playerId, role } })
          }
          onFormationChange={(formation) => void send({ ChangeFormation: { side, formation } })}
          onPlayStyleChange={(style) =>
            void send({ ChangePlayStyle: { side, play_style: style as PlayStyle } })
          }
          onClose={onClose}
        />
      )}
    </>
  );
}
