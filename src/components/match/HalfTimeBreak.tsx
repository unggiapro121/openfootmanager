import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GameStateData } from "../../store/gameStore";
import type { PlayerRole } from "../../store/types";
import {
  type MatchSnapshot,
  type MatchEvent,
  FORMATIONS,
  PLAY_STYLES,
  getTeamTalkOptions,
  type TeamTalkTone,
} from "./types";
import { getEventDisplay, getPlayerName, makeTeamFallback } from "./helpers";
import { getTalkIcon } from "./TeamTalkIcons";
import { SubPanel } from "./SubPanel";
import { FormationPitch } from "./FormationPitch";
import {
  changeMatchFormation,
  changeMatchPlayStyle,
  giveTeamTalk,
  substituteMatchPlayer,
  swapMatchPositions,
} from "../../services/liveMatchService";
import { createMatchRoleChange } from "./matchRoleChange";
import { MatchRolePicker } from "./MatchRolePicker";
import { Badge, TeamLogo, ThemeToggle } from "../ui";
import { Play, RefreshCw, Shield, Zap, Target, Crosshair, Flag, MessageCircle } from "lucide-react";

interface HalfTimeBreakProps {
  snapshot: MatchSnapshot;
  gameState: GameStateData;
  userSide: "Home" | "Away";
  isSpectator: boolean;
  importantEvents: MatchEvent[];
  onResume: () => void;
  onUpdateSnapshot: (snap: MatchSnapshot) => void;
}

const PLAY_STYLE_ICONS: Record<string, React.ReactNode> = {
  Balanced: <Target className="w-3.5 h-3.5" />,
  Attacking: <Zap className="w-3.5 h-3.5" />,
  Defensive: <Shield className="w-3.5 h-3.5" />,
  Possession: <RefreshCw className="w-3.5 h-3.5" />,
  Counter: <Crosshair className="w-3.5 h-3.5" />,
  HighPress: <Flag className="w-3.5 h-3.5" />,
};

export default function HalfTimeBreak({
  snapshot,
  gameState,
  userSide,
  isSpectator,
  importantEvents,
  onResume,
  onUpdateSnapshot,
}: HalfTimeBreakProps) {
  const { t } = useTranslation();
  const teamTalkOptions = getTeamTalkOptions(t);
  const [selectedTalk, setSelectedTalk] = useState<TeamTalkTone | null>(null);
  const [showSubPanel, setShowSubPanel] = useState(false);
  const [talkDelivered, setTalkDelivered] = useState(false);
  const [talkResults, setTalkResults] = useState<TalkResult[]>([]);

  const homeFullTeam = gameState.teams.find((t) => t.id === snapshot.home_team.id);
  const awayFullTeam = gameState.teams.find((t) => t.id === snapshot.away_team.id);
  const homeTeamColor = homeFullTeam?.colors?.primary || "#10b981";
  const awayTeamColor = awayFullTeam?.colors?.primary || "#6366f1";

  const userTeam = userSide === "Home" ? snapshot.home_team : snapshot.away_team;

  // First half key events
  const firstHalfEvents = importantEvents.filter((e) =>
    [
      "Goal",
      "PenaltyGoal",
      "YellowCard",
      "RedCard",
      "SecondYellow",
      "Injury",
      "PenaltyMiss",
    ].includes(e.event_type),
  );

  const handleFormationChange = async (formation: string) => {
    try {
      const snap = await changeMatchFormation(userSide, formation);
      onUpdateSnapshot(snap);
    } catch (err) {
      console.error("Formation change failed:", err);
    }
  };

  const handlePlayStyleChange = async (playStyle: string) => {
    try {
      const snap = await changeMatchPlayStyle(userSide, playStyle);
      onUpdateSnapshot(snap);
    } catch (err) {
      console.error("Play style change failed:", err);
    }
  };

  const handleSubstitution = async (playerOffId: string, playerOnId: string) => {
    try {
      const snap = await substituteMatchPlayer(userSide, playerOffId, playerOnId);
      onUpdateSnapshot(snap);
      // The panel stays open for the next change; Done closes it.
      return true;
    } catch (err) {
      console.error("Substitution failed:", err);
      return false;
    }
  };

  const handleSwapPositions = async (playerAId: string, playerBId: string) => {
    try {
      onUpdateSnapshot(await swapMatchPositions(userSide, playerAId, playerBId));
    } catch (err) {
      console.error("Position swap failed:", err);
    }
  };

  const handleRoleChange = createMatchRoleChange(userSide, onUpdateSnapshot);

  const handleDeliverTalk = async () => {
    if (!selectedTalk) return;
    const userScore = userSide === "Home" ? snapshot.home_score : snapshot.away_score;
    const oppScore = userSide === "Home" ? snapshot.away_score : snapshot.home_score;
    const context = userScore > oppScore ? "winning" : userScore < oppScore ? "losing" : "drawing";
    try {
      const results = await giveTeamTalk(selectedTalk, context);
      setTalkResults(results);
    } catch (err) {
      console.error("Team talk failed:", err);
    }
    setTalkDelivered(true);
  };

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900 dark:bg-navy-900 dark:text-white flex flex-col transition-colors duration-300">
      <HalfTimeHeader
        snapshot={snapshot}
        homeTeam={homeFullTeam}
        awayTeam={awayFullTeam}
        homeTeamColor={homeTeamColor}
        awayTeamColor={awayTeamColor}
        isSpectator={isSpectator}
        onResume={onResume}
      />

      {/* Review on the left, the lineup in the middle, tactics on the right;
          the columns stack on a narrow screen. */}
      <main className="flex-1 overflow-auto">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-start gap-6 px-4 py-6 sm:px-6">
          <div className="flex min-w-0 max-w-[420px] flex-[1_1_340px] flex-col gap-6">
            <FirstHalfCard snapshot={snapshot} events={firstHalfEvents} />
            {isSpectator ? (
              <div className={`${CARD} flex flex-col items-center justify-center py-8`}>
                <p className="text-xs font-heading uppercase tracking-widest text-gray-600 dark:text-gray-500 mb-1">
                  {t("match.spectatorMode")}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
                  {t("match.spectatorHT")}
                </p>
              </div>
            ) : (
              <TeamTalkCard
                options={teamTalkOptions}
                selectedTalk={selectedTalk}
                onSelect={setSelectedTalk}
                delivered={talkDelivered}
                results={talkResults}
                onDeliver={handleDeliverTalk}
              />
            )}
          </div>

          {!isSpectator && (
            <LineupCard
              snapshot={snapshot}
              userSide={userSide}
              onOpenSubstitutions={() => setShowSubPanel(true)}
              onSwapPositions={handleSwapPositions}
              onRoleChange={(playerId, role) => void handleRoleChange(playerId, role)}
            />
          )}

          {!isSpectator && (
            <TacticsColumn
              formation={userTeam.formation}
              playStyle={userTeam.play_style}
              onFormationChange={handleFormationChange}
              onPlayStyleChange={handlePlayStyleChange}
            />
          )}
        </div>
      </main>

      {/* Substitution Modal — reuses the full SubPanel from MatchLive */}
      {showSubPanel && (
        <SubPanel
          snapshot={snapshot}
          side={userSide}
          onSubstitute={handleSubstitution}
          onSwapPositions={handleSwapPositions}
          onRoleChange={(playerId, role) => void handleRoleChange(playerId, role)}
          onFormationChange={handleFormationChange}
          onPlayStyleChange={handlePlayStyleChange}
          onClose={() => setShowSubPanel(false)}
        />
      )}
    </div>
  );
}

const CARD =
  "bg-white dark:bg-navy-800 rounded-xl border border-gray-200 dark:border-navy-700 shadow-sm p-4 transition-colors duration-300";
const CARD_TITLE =
  "text-xs font-heading font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400";
const OPTION =
  "rounded-lg text-xs font-heading font-bold transition-all focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800";
const OPTION_ON =
  "bg-primary-500/20 text-primary-700 ring-1 ring-primary-500/50 dark:text-primary-400";
const OPTION_OFF =
  "bg-gray-100 text-gray-600 hover:text-gray-900 dark:bg-navy-700 dark:text-gray-400 dark:hover:text-gray-300";

interface LineupCardProps {
  snapshot: MatchSnapshot;
  userSide: "Home" | "Away";
  onOpenSubstitutions: () => void;
  onSwapPositions: (playerAId: string, playerBId: string) => void;
  onRoleChange: (playerId: string, role: PlayerRole) => void;
}

/** The user's lineup on the pitch: drag to swap, a role on each token, and the substitutions. */
function LineupCard({
  snapshot,
  userSide,
  onOpenSubstitutions,
  onSwapPositions,
  onRoleChange,
}: LineupCardProps) {
  const { t } = useTranslation();
  const lineupTitleId = useId();
  const userTeam = userSide === "Home" ? snapshot.home_team : snapshot.away_team;
  const subsMade = userSide === "Home" ? snapshot.home_subs_made : snapshot.away_subs_made;
  return (
    <section
      aria-labelledby={lineupTitleId}
      className={`${CARD} flex min-w-0 flex-[2_1_520px] flex-col gap-4`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2 id={lineupTitleId} className={CARD_TITLE}>
              {t("match.lineups")}
            </h2>
            <span className="text-xs font-heading font-bold tracking-wider text-gray-500 dark:text-gray-400">
              · {userTeam.formation}
            </span>
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {t("match.dragToSwapPositions")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenSubstitutions()}
            className="flex items-center gap-2 rounded-lg bg-gray-200 px-3 py-2 text-sm font-heading uppercase tracking-wider text-gray-700 transition-colors hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:bg-navy-700 dark:text-gray-300 dark:hover:bg-navy-600 dark:focus:ring-offset-navy-800"
          >
            <RefreshCw className="w-4 h-4" />
            {t("match.makeSubstitution")}
          </button>
          <Badge variant="neutral" size="sm">
            {subsMade}/{snapshot.max_subs}
          </Badge>
        </div>
      </div>
      <FormationPitch
        formation={userTeam.formation}
        players={userTeam.players}
        sentOff={snapshot.sent_off}
        onPlayerDrop={onSwapPositions}
        renderTokenExtra={(player, slotPosition) => (
          <MatchRolePicker
            position={slotPosition ?? player.position}
            role={player.role}
            onChange={(role) => onRoleChange(player.id, role)}
          />
        )}
        roles={userSide === "Home" ? snapshot.home_set_pieces : snapshot.away_set_pieces}
        className="w-full"
      />
    </section>
  );
}

interface TacticsColumnProps {
  formation: string;
  playStyle: string;
  onFormationChange: (formation: string) => void;
  onPlayStyleChange: (playStyle: string) => void;
}

/** The formation and the play style for the second half. */
function TacticsColumn({
  formation,
  playStyle,
  onFormationChange,
  onPlayStyleChange,
}: TacticsColumnProps) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 max-w-[380px] flex-[1_1_300px] flex-col gap-6">
      <OptionCard title={t("match.formation")}>
        <div className="grid grid-cols-3 gap-1.5">
          {FORMATIONS.map((f) => (
            <button
              type="button"
              key={f}
              aria-pressed={formation === f}
              onClick={() => onFormationChange(f)}
              className={`${OPTION} py-2 ${formation === f ? OPTION_ON : OPTION_OFF}`}
            >
              {f}
            </button>
          ))}
        </div>
      </OptionCard>
      <OptionCard title={t("match.playStyle")}>
        <div className="grid grid-cols-2 gap-1.5">
          {PLAY_STYLES.map((style) => (
            <button
              type="button"
              key={style}
              aria-pressed={playStyle === style}
              onClick={() => onPlayStyleChange(style)}
              className={`${OPTION} flex items-center gap-1.5 py-2 px-3 ${playStyle === style ? OPTION_ON : OPTION_OFF}`}
            >
              {PLAY_STYLE_ICONS[style]}
              {t(`common.playStyles.${style}`)}
            </button>
          ))}
        </div>
      </OptionCard>
    </div>
  );
}

/** A titled card on the break, named by its title for assistive technology. */
function OptionCard({ title, children }: { title: string; children: React.ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={CARD}>
      <h2 id={titleId} className={`${CARD_TITLE} mb-3`}>
        {title}
      </h2>
      {children}
    </section>
  );
}

interface HalfTimeHeaderProps {
  snapshot: MatchSnapshot;
  homeTeam: GameStateData["teams"][number] | undefined;
  awayTeam: GameStateData["teams"][number] | undefined;
  homeTeamColor: string;
  awayTeamColor: string;
  isSpectator: boolean;
  onResume: () => void;
}

/** The scoreboard: what the break is for, the score and possession, and the way back. */
function HalfTimeHeader({
  snapshot,
  homeTeam,
  awayTeam,
  homeTeamColor,
  awayTeamColor,
  isSpectator,
  onResume,
}: HalfTimeHeaderProps) {
  const { t } = useTranslation();
  const logo = (team: HalfTimeHeaderProps["homeTeam"], name: string, color: string) => (
    <TeamLogo
      team={team ?? makeTeamFallback(name)}
      className="w-10 h-10 shrink-0 rounded-lg flex items-center justify-center font-heading font-bold overflow-hidden"
      imageClassName="h-8 w-8 object-contain drop-shadow"
      style={{ backgroundColor: `${color}30`, borderColor: color, borderWidth: 2 }}
    />
  );
  return (
    <header className="bg-white dark:bg-navy-800 border-b border-gray-200 dark:border-navy-700 transition-colors duration-300">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
        <div className="flex flex-[1_1_200px] flex-col gap-0.5">
          <span className="text-xs font-heading font-bold uppercase tracking-widest text-accent-700 dark:text-accent-400">
            {snapshot.phase === "ExtraTimeHalfTime"
              ? t("match.extraTimeHalfTime")
              : t("match.halfTime")}
          </span>
          {!isSpectator && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t("match.halfTimeHint")}
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-[0_1_560px] flex-col items-center gap-2.5">
          <div className="flex w-full items-center justify-center gap-4">
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2.5">
              <p className="truncate text-right font-heading font-bold text-gray-800 dark:text-gray-200">
                {snapshot.home_team.name}
              </p>
              {logo(homeTeam, snapshot.home_team.name, homeTeamColor)}
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-1 dark:border-navy-600 dark:bg-navy-900">
              <span className="text-4xl font-heading font-bold tabular-nums">
                {snapshot.home_score}
              </span>
              <span className="text-xs font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {t("match.ht")}
              </span>
              <span className="text-4xl font-heading font-bold tabular-nums">
                {snapshot.away_score}
              </span>
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              {logo(awayTeam, snapshot.away_team.name, awayTeamColor)}
              <p className="truncate font-heading font-bold text-gray-800 dark:text-gray-200">
                {snapshot.away_team.name}
              </p>
            </div>
          </div>
          <div className="flex w-full max-w-md items-center gap-2 text-xs">
            <span className="w-10 text-right font-heading font-bold text-primary-700 dark:text-primary-400">
              {snapshot.home_possession_pct.toFixed(0)}%
            </span>
            <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-gray-300 dark:bg-navy-700">
              <div
                className="h-full bg-primary-500 transition-all"
                style={{ width: `${snapshot.home_possession_pct}%` }}
              />
              <div
                className="h-full bg-indigo-500 transition-all"
                style={{ width: `${snapshot.away_possession_pct}%` }}
              />
            </div>
            <span className="w-10 font-heading font-bold text-indigo-600 dark:text-indigo-400">
              {snapshot.away_possession_pct.toFixed(0)}%
            </span>
          </div>
          <span className="-mt-1.5 text-[11px] font-heading uppercase tracking-widest text-gray-500 dark:text-gray-400">
            {t("match.possession")}
          </span>
        </div>

        <div className="flex flex-[1_1_200px] items-center justify-end gap-2">
          <ThemeToggle />
          <button
            type="button"
            onClick={onResume}
            className="flex items-center gap-2 rounded-lg bg-primary-700 px-5 py-3 font-heading font-bold uppercase tracking-wider text-sm text-white shadow-md transition-colors hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800"
          >
            <Play className="w-4 h-4" />
            {t("match.resumeMatch")}
          </button>
        </div>
      </div>
    </header>
  );
}

/** The first half's goals, cards and injuries. */
function FirstHalfCard({ snapshot, events }: { snapshot: MatchSnapshot; events: MatchEvent[] }) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={CARD}>
      <h2 id={titleId} className={`${CARD_TITLE} mb-3`}>
        {t("match.firstHalfEvents")}
      </h2>
      {events.length === 0 ? (
        <p className="text-xs text-gray-600 dark:text-gray-500">{t("match.noMajorEvents")}</p>
      ) : (
        <ol className="flex flex-col divide-y divide-gray-200 dark:divide-navy-700">
          {events.map((evt, i) => {
            const display = getEventDisplay(evt);
            return (
              <li key={i} className="flex min-h-9 items-center gap-2 text-xs">
                <span className="text-gray-600 dark:text-gray-500 tabular-nums w-6 text-right font-heading">
                  {evt.minute}'
                </span>
                <span>{display.icon}</span>
                <span className={`${display.color} flex-1 font-medium truncate`}>
                  {getPlayerName(snapshot, evt.player_id)}
                </span>
                <Badge variant={evt.side === "Home" ? "primary" : "accent"} size="sm">
                  {evt.side === "Home"
                    ? snapshot.home_team.name.substring(0, 3)
                    : snapshot.away_team.name.substring(0, 3)}
                </Badge>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

interface TalkResult {
  player_id: string;
  player_name: string;
  old_morale: number;
  new_morale: number;
  delta: number;
}

interface TeamTalkCardProps {
  options: ReturnType<typeof getTeamTalkOptions>;
  selectedTalk: TeamTalkTone | null;
  onSelect: (tone: TeamTalkTone) => void;
  delivered: boolean;
  results: TalkResult[];
  onDeliver: () => void;
}

/** The team talk: pick a tone and give it once; then each player's morale after it. */
function TeamTalkCard({
  options,
  selectedTalk,
  onSelect,
  delivered,
  results,
  onDeliver,
}: TeamTalkCardProps) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={CARD}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-accent-700 dark:text-accent-400" />
          <h2 id={titleId} className={CARD_TITLE}>
            {t("match.teamTalk")}
          </h2>
        </div>
        {delivered && (
          <Badge variant="success" size="sm">
            {t("match.delivered")}
          </Badge>
        )}
      </div>

      {!delivered ? (
        <>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            {t("match.teamTalkPrompt")}
          </p>
          <div className="flex flex-col gap-2">
            {options.map((opt) => (
              <button
                type="button"
                key={opt.id}
                aria-pressed={selectedTalk === opt.id}
                onClick={() => onSelect(opt.id)}
                className={`flex items-center gap-3 p-3 rounded-lg text-left transition-all focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800 ${
                  selectedTalk === opt.id
                    ? "bg-primary-500/20 ring-2 ring-primary-500/50"
                    : "bg-gray-100 hover:bg-gray-200 dark:bg-navy-700/50 dark:hover:bg-navy-700"
                }`}
              >
                <span className="text-xl">{getTalkIcon(opt.icon)}</span>
                <div>
                  <p
                    className={`text-sm font-heading font-bold ${
                      selectedTalk === opt.id
                        ? "text-primary-700 dark:text-primary-400"
                        : "text-gray-800 dark:text-gray-200"
                    }`}
                  >
                    {opt.label}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{opt.description}</p>
                </div>
              </button>
            ))}
          </div>
          {selectedTalk && (
            <button
              type="button"
              onClick={onDeliver}
              className="w-full mt-3 py-2.5 bg-primary-500/20 hover:bg-primary-500/30 text-primary-700 dark:text-primary-400 rounded-lg font-heading font-bold text-sm uppercase tracking-wider transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-navy-800"
            >
              {t("match.deliverTeamTalk")}
            </button>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 mb-1">
            {getTalkIcon(selectedTalk || "")}
            <p className="text-sm font-heading font-bold text-primary-700 dark:text-primary-400">
              {options.find((o) => o.id === selectedTalk)?.label}
            </p>
          </div>
          {results.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {results.map((r) => (
                <li key={r.player_id} className="flex items-center gap-2 px-2 py-1 text-xs">
                  <span className="text-gray-500 dark:text-gray-400 flex-1 truncate">
                    {r.player_name}
                  </span>
                  <span
                    className={`font-heading font-bold tabular-nums ${r.delta > 0 ? "text-green-600 dark:text-green-400" : r.delta < 0 ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400"}`}
                  >
                    {r.delta > 0 ? "+" : ""}
                    {r.delta}
                  </span>
                  <div className="w-12 h-1.5 bg-gray-300 dark:bg-navy-600 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${r.new_morale >= 70 ? "bg-green-500" : r.new_morale >= 40 ? "bg-yellow-500" : "bg-red-500"}`}
                      style={{ width: `${r.new_morale}%` }}
                    />
                  </div>
                  <span className="text-gray-500 dark:text-gray-400 tabular-nums w-6 text-right">
                    {r.new_morale}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
