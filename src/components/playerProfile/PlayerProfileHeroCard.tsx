import type { ReactNode } from "react";
import { Shield } from "lucide-react";
import { countryName } from "../../lib/countries";
import type { PlayerData } from "../../store/gameStore";
import ContextMenu from "../ContextMenu";
import { buildViewTeamMenuItem } from "../playerActions/playerContextMenuItems";
import { PlayerPositionBadges } from "../squad/PlayerPositionBadges";
import {
  formatPlayerProfileWage,
  formatPlayerMarketValue,
  formatPlayerPhysique,
} from "./PlayerProfile.helpers";
import type { PlayerProfileScoutStatus, ScoutAvailability } from "./PlayerProfile.scouting";
import PlayerProfileScoutAction from "./PlayerProfileScoutAction";
import { TraitList } from "../TraitBadge";
import { Card, CountryFlag, JerseyIcon, PlayerAvatar } from "../ui";
import type { TeamData } from "../../store/types";

type TranslateFn = (key: string, options?: Record<string, string | number>) => string;

interface PlayerProfileHeroCardProps {
  player: PlayerData;
  /** His traits as the club shows them, Wonderkid only where its read says so. */
  traits: string[];
  ovr: number;
  primaryPosition: string;
  age: number;
  teamName: string;
  footednessLabel: string;
  weakFootValue: number;
  wageSuffix: string;
  language: string;
  isOwnClub: boolean;
  scoutAvailability: ScoutAvailability;
  scoutStatus: PlayerProfileScoutStatus;
  scoutError: string | null;
  onScout: () => void;
  onSelectTeam?: (id: string) => void;
  team?: TeamData;
  t: TranslateFn;
}

/** One cell of the hero's stat strip: a small label over its value. */
function HeroStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-heading font-bold uppercase tracking-widest text-gray-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold text-gray-200">{children}</dd>
    </div>
  );
}

const WEAK_FOOT_MAX = 5;

/** The weaker foot as five dots, the rating read out as "n/5". */
export function WeakFootRating({ value }: { value: number }) {
  return (
    <span className="inline-flex h-5 items-center gap-1">
      {Array.from({ length: WEAK_FOOT_MAX }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${index < value ? "bg-primary-400" : "bg-navy-600"}`}
        />
      ))}
      <span className="sr-only">
        {value}/{WEAK_FOOT_MAX}
      </span>
    </span>
  );
}

export default function PlayerProfileHeroCard({
  player,
  traits,
  ovr,
  primaryPosition,
  age,
  teamName,
  footednessLabel,
  weakFootValue,
  wageSuffix,
  language,
  isOwnClub,
  scoutAvailability,
  scoutStatus,
  scoutError,
  onScout,
  onSelectTeam,
  team,
  t,
}: PlayerProfileHeroCardProps) {
  const teamContextItems =
    player.team_id && onSelectTeam
      ? [buildViewTeamMenuItem(t, () => onSelectTeam(player.team_id!))]
      : [];

  return (
    <Card accent="primary" className="mb-5">
      <div className="bg-linear-to-r from-navy-700 to-navy-800 p-8 rounded-t-xl">
        <div className="flex items-start gap-6">
          <PlayerAvatar
            player={player}
            className={`w-24 h-24 rounded-2xl flex items-center justify-center font-heading font-bold text-4xl border-2 overflow-hidden ${
              ovr >= 75
                ? "bg-primary-500/20 text-primary-400 border-primary-500/30"
                : ovr >= 55
                  ? "bg-accent-500/20 text-accent-400 border-accent-500/30"
                  : "bg-gray-500/20 text-gray-400 border-gray-500/30"
            }`}
            fallback={<span>{ovr}</span>}
          />
          {player.jersey_number != null && team != null && (
            <JerseyIcon
              primaryColor={team.colors.primary}
              secondaryColor={team.colors.secondary}
              pattern={team.kit_pattern ?? "Solid"}
              number={player.jersey_number}
              size="lg"
              className="flex-shrink-0 self-center"
            />
          )}
          <div className="flex-1">
            <h2 className="text-3xl font-heading font-bold text-white uppercase tracking-wide">
              {player.full_name}
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
              <PlayerPositionBadges
                primaryPosition={primaryPosition}
                alternatePositions={player.alternate_positions}
              />
              <span className="text-gray-400 text-sm">
                <CountryFlag
                  code={player.nationality}
                  locale={language}
                  className="mr-1 text-sm leading-none"
                />
                {countryName(player.nationality, language)}
              </span>
              <span className="text-gray-500">•</span>
              <span className="text-gray-400 text-sm">
                {t("common.age")} {age}
              </span>
            </div>
            {/* Feet and build as one strip of label-over-value cells. On a narrow
                screen it folds into two rows, keeping the two feet together and
                height beside weight. */}
            <dl className="mt-3 grid max-w-xl grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
              <HeroStat label={t("common.footednessLabel")}>{footednessLabel}</HeroStat>
              <HeroStat label={t("common.weakFoot")}>
                <WeakFootRating value={weakFootValue} />
              </HeroStat>
              <HeroStat label={t("common.height")}>
                {formatPlayerPhysique(player.height_cm, "centimeter", language)}
              </HeroStat>
              <HeroStat label={t("common.weight")}>
                {formatPlayerPhysique(player.weight_kg, "kilogram", language)}
              </HeroStat>
            </dl>
            <p className="text-gray-400 text-sm mt-2 flex items-center gap-1.5">
              <Shield className="w-4 h-4" />
              {player.team_id && onSelectTeam ? (
                <ContextMenu items={teamContextItems}>
                  <button
                    type="button"
                    data-testid="player-profile-team-link"
                    onClick={() => onSelectTeam(player.team_id!)}
                    className="hover:text-primary-400 transition-colors underline underline-offset-2"
                  >
                    {teamName}
                  </button>
                </ContextMenu>
              ) : (
                <span>{teamName}</span>
              )}
            </p>
            {traits.length > 0 ? (
              <div className="mt-3">
                <TraitList traits={traits} size="sm" />
              </div>
            ) : null}
          </div>

          {!isOwnClub ? (
            <div className="mt-3">
              <PlayerProfileScoutAction
                availability={scoutAvailability}
                scoutStatus={scoutStatus}
                scoutError={scoutError}
                onScout={onScout}
              />
            </div>
          ) : null}

          <div className="hidden md:grid grid-cols-2 gap-3">
            <QuickStat
              label={t("common.condition")}
              value={`${player.condition}%`}
              color={player.condition >= 70 ? "text-primary-400" : "text-red-400"}
            />
            <QuickStat
              label={t("common.morale")}
              value={`${player.morale}%`}
              color={player.morale >= 70 ? "text-primary-400" : "text-accent-400"}
            />
            <QuickStat
              label={t("common.value")}
              value={formatPlayerMarketValue(player.market_value)}
              color="text-white"
            />
            <QuickStat
              label={t("common.wage")}
              value={formatPlayerProfileWage(player, wageSuffix, t)}
              color="text-white"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-px bg-gray-200 dark:bg-navy-600 md:hidden">
        <MobileQuickStat
          label={t("common.condition")}
          value={`${player.condition}%`}
          color={player.condition >= 70 ? "text-primary-500" : "text-red-500"}
        />
        <MobileQuickStat
          label={t("common.morale")}
          value={`${player.morale}%`}
          color={player.morale >= 70 ? "text-primary-500" : "text-accent-500"}
        />
        <MobileQuickStat
          label={t("common.value")}
          value={formatPlayerMarketValue(player.market_value)}
          color="text-gray-700 dark:text-gray-200"
        />
        <MobileQuickStat
          label={t("common.wage")}
          value={formatPlayerProfileWage(player, wageSuffix, t)}
          color="text-gray-700 dark:text-gray-200"
        />
      </div>
    </Card>
  );
}

function QuickStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white/5 rounded-xl px-5 py-3 text-center min-w-25">
      <p className="text-xs text-gray-400 font-heading uppercase tracking-wider">{label}</p>
      <p className={`font-heading font-bold text-xl mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}

function MobileQuickStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white dark:bg-navy-800 p-3 text-center">
      <p className="text-xs text-gray-400 dark:text-gray-500 font-heading uppercase tracking-wider">
        {label}
      </p>
      <p className={`font-heading font-bold text-lg mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}
