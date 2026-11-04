import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MatchRadar2D } from "../../../../components/match/radar/MatchRadar2D";
import type { RadarPacing } from "../../../../components/match/radar/useRadarDirector";
import { useSettingsStore } from "../../../../store/settingsStore";
import type { MatchCommand } from "../../../api/engine";
import {
  type OnlineMatchState,
  toRadarDials,
  toRadarMatch,
  toRadarRoster,
} from "../../../convert/matchState";
import { useOnlineStore } from "../../../store/onlineStore";
import { useRadarKits } from "../MatchBoard";
import type { LiveMatchData } from "../useLiveMatch";
import { PhoneMatchDock } from "./PhoneMatchDock";
import { PhoneMatchHeader } from "./PhoneMatchHeader";
import { PhoneMatchPanels } from "./PhoneMatchPanels";

/**
 * A live match on a phone (design m-tran-dau), over the whole screen: the score at the top, what
 * to know now (a hurt player to replace, the connection), the radar, the events, stats and
 * line-ups, and for the coach the dock of controls at the foot.
 */
export function PhoneLiveMatch({
  data,
  shown,
  strip,
  send,
  pacing,
  radarOpen,
  onToggleRadar,
  onPlayed,
  replacing,
  disabled,
}: {
  data: LiveMatchData;
  /** The match as far as the radar has played it. */
  shown: OnlineMatchState;
  strip: ReactNode;
  send: (command: MatchCommand) => Promise<void>;
  pacing: RadarPacing;
  radarOpen: boolean;
  onToggleRadar: () => void;
  onPlayed: (played: number) => void;
  /** A hurt player of the coach's to replace now. */
  replacing?: string;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const { state, mine } = data;
  const showCommentary = useSettingsStore((store) => store.settings.show_match_commentary);
  const squad = useOnlineStore((store) => store.club?.players);
  const pictures = useOnlineStore((store) => store.playerPictures);
  const kits = useRadarKits(mine);
  const roster = useMemo(() => toRadarRoster(state, squad, pictures), [state, squad, pictures]);
  const radar = useMemo(() => {
    const dials = mine
      ? { [mine.side === "Home" ? "home" : "away"]: toRadarDials(mine.tactics) }
      : {};
    return toRadarMatch(state, dials);
  }, [state, mine]);
  const coaching = mine !== null && !state.isFinished;

  return (
    <section
      aria-label={t("online.match.phone.title")}
      className={`fixed inset-0 z-40 overflow-y-auto bg-gray-100 dark:bg-navy-900 ${coaching ? "pb-[calc(8.5rem+var(--safe-bottom))]" : "pb-[var(--safe-bottom)]"}`}
    >
      <PhoneMatchHeader data={data} shown={shown} />
      <div className="px-3 pt-2.5 empty:hidden">{strip}</div>
      <div className="mx-3 mt-2.5 overflow-hidden rounded-[14px] border border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800">
        <MatchRadar2D
          roster={roster}
          snapshot={radar}
          kits={kits}
          isOpen={radarOpen}
          onToggle={onToggleRadar}
          paused={false}
          onPlayed={onPlayed}
          showCommentary={showCommentary}
          pacing={pacing}
        />
      </div>
      <PhoneMatchPanels state={shown} mine={mine} roster={roster} />
      {coaching && (
        <PhoneMatchDock
          state={state}
          mine={mine}
          sent={data.sent}
          onSend={send}
          initialOff={replacing}
          disabled={disabled}
        />
      )}
    </section>
  );
}
