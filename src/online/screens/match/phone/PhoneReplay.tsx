import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MatchRadar2D } from "../../../../components/match/radar/MatchRadar2D";
import { useSettingsStore } from "../../../../store/settingsStore";
import type { MatchView } from "../../../api";
import { toRadarDials, toRadarMatch, toRadarRoster } from "../../../convert/matchState";
import { useOnlineStore } from "../../../store/onlineStore";
import { useRadarKits } from "../MatchBoard";
import { type ReplayData, useReplayPlayback } from "../useMatchReplay";
import { PhoneMatchHeader } from "./PhoneMatchHeader";
import { PhoneMatchPanels } from "./PhoneMatchPanels";
import { PhoneReplayDock } from "./PhoneReplayDock";

/**
 * A finished match played again on a phone (analysis-mobile-replay D-RP1): the live match's screen
 * over the whole screen — the score as far as the replay has played, marked as a replay, the radar
 * and the events, stats and line-ups — with the replay's controls at the foot.
 */
export function PhoneReplay({ view, data }: { view: MatchView; data: ReplayData }) {
  const { t } = useTranslation();
  const replay = useReplayPlayback(data.source);
  const { mine } = data;
  const showCommentary = useSettingsStore((store) => store.settings.show_match_commentary);
  const squad = useOnlineStore((store) => store.club?.players);
  const pictures = useOnlineStore((store) => store.playerPictures);
  const kits = useRadarKits(mine);
  const roster = useMemo(
    () => toRadarRoster(replay.ahead, squad, pictures),
    [replay.ahead, squad, pictures],
  );
  const radar = useMemo(() => {
    const dials = mine
      ? { [mine.side === "Home" ? "home" : "away"]: toRadarDials(mine.tactics) }
      : {};
    return toRadarMatch(replay.ahead, dials);
  }, [replay.ahead, mine]);

  return (
    <section
      aria-label={t("online.replay.title")}
      className="fixed inset-0 z-40 overflow-y-auto bg-gray-100 pb-[calc(8.5rem+var(--safe-bottom))] dark:bg-navy-900"
    >
      <PhoneMatchHeader shown={replay.shown} mine={mine} />
      <div className="mx-3 mt-2.5 overflow-hidden rounded-[14px] border border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800">
        <MatchRadar2D
          key={replay.radarKey}
          roster={roster}
          snapshot={radar}
          kits={kits}
          isOpen={replay.radarOpen}
          onToggle={replay.toggleRadar}
          paused={!replay.playing}
          onCaughtUp={replay.onCaughtUp}
          showCommentary={showCommentary}
          commentaryRow
          pacing={replay.pacing}
        />
      </div>
      <PhoneMatchPanels state={replay.shown} mine={mine} roster={roster} />
      <PhoneReplayDock view={view} mine={mine} source={data.source} replay={replay} />
    </section>
  );
}
