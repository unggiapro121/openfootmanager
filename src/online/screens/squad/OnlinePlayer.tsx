import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { Shield } from "lucide-react";
import { formatPlayerPhysique } from "../../../components/playerProfile/PlayerProfile.helpers";
import { HeroStat, WeakFootRating } from "../../../components/playerProfile/PlayerProfileHeroCard";
import { TraitList } from "../../../components/TraitBadge";
import PlayerProfileAttributesCard from "../../../components/playerProfile/PlayerProfileAttributesCard";
import PlayerProfileInjuryBanner from "../../../components/playerProfile/PlayerProfileInjuryBanner";
import {
  buildPlayerAttributeGroups,
  isGoalkeeper,
} from "../../../components/playerProfile/PlayerProfile.attributes";
import { PlayerPositionBadges } from "../../../components/squad/PlayerPositionBadges";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CountryFlag,
  JerseyIcon,
  PlayerAvatar,
  ProgressBar,
} from "../../../components/ui";
import { countryName } from "../../../lib/countries";
import { formatVal, formatWeeklyAmount } from "../../../lib/valueFormatting";
import type { KitPattern } from "../../../store/types";
import type { MyClubView, SquadPlayerView } from "../../api";
import { useOnlineStore } from "../../store/onlineStore";
import { avatarOf } from "./playerLook";
import ListingDialog from "../market/ListingDialog";
import PotentialStars from "../PotentialStars";
import ItemShortcuts from "../items/ItemShortcuts";
import RenamePlayerDialog from "../RenamePlayerDialog";
import PlayerAvatarPicker from "./PlayerAvatarPicker";
import PlayerNationalityDialog from "./PlayerNationalityDialog";
import ReleaseDialog from "./ReleaseDialog";
import ShirtNumberPicker from "./ShirtNumberPicker";
import { usePhoneLayout } from "../../../hooks/usePhoneLayout";
import HealAction from "./HealAction";
import PhonePlayer from "./PhonePlayer";
import { KeeperDrillBadge } from "../training/KeeperDrillBadge";
import { trainsKeeperDrill } from "../training/keeperDrill";

/**
 * One player of the club on his own page, laid out as the offline player profile is: the hero card
 * (who he is, where, his condition and morale), his injury, his condition in three meters and his
 * attributes, then his season. The ways to put him up for auction and to rename him are here too.
 */
export default function OnlinePlayer() {
  const { t } = useTranslation();
  const { playerId = "" } = useParams();
  const club = useOnlineStore((state) => state.club);
  const player = club?.players.find((one) => one.id === playerId);
  const phone = usePhoneLayout();
  if (!club) return null;
  if (phone && player) return <PhonePlayer player={player} club={club} />;
  return (
    <div className="flex flex-col gap-5">
      <Link
        to="/online/squad"
        className="self-start rounded text-sm text-primary-600 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-primary-400"
      >
        {t("online.squad.back")}
      </Link>
      {player ? (
        <Profile player={player} club={club} />
      ) : (
        <p className="text-sm text-gray-600 dark:text-gray-300">{t("online.squad.notFound")}</p>
      )}
    </div>
  );
}

function Profile({ player, club }: { player: SquadPlayerView; club: MyClubView }) {
  const { t } = useTranslation();
  const profile = {
    attributes: player.attributes,
    natural_position: player.naturalPosition,
    position: player.position,
  };
  return (
    <>
      <Hero player={player} club={club} />
      {player.injury && (
        <PlayerProfileInjuryBanner
          injury={{ name: player.injury.name, days_remaining: player.injury.daysRemaining }}
          t={t}
          action={<HealAction player={player} />}
        />
      )}
      {player.suspendedMatches !== undefined && (
        <p
          role="status"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
        >
          {t("online.squad.suspended", { count: player.suspendedMatches })}
        </p>
      )}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader>{t("online.squad.state")}</CardHeader>
          <CardBody className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
            <Meter label={t("common.condition")} value={player.condition} />
            {!player.injury && (
              <ItemShortcuts
                codes={["energyDrinkSmall", "energyDrinkLarge"]}
                target={{ kind: "player", playerId: player.id }}
              />
            )}
            <Meter label={t("online.squad.fitness")} value={player.fitness} />
            <Meter label={t("common.morale")} value={player.morale} />
            <div className="flex flex-wrap gap-2 pt-1">
              <ListingAction playerId={player.id} playerName={player.fullName} />
              <ReleaseAction player={player} />
              <ShirtAction player={player} />
              <LookActions player={player} />
              <RenameAction player={player} />
            </div>
          </CardBody>
        </Card>
        <PlayerProfileAttributesCard
          attrGroups={buildPlayerAttributeGroups(profile, t)}
          player={profile}
          isOwnClub
          isGk={isGoalkeeper(profile)}
          title={t("playerProfile.attributes")}
          ovr={player.ovr}
          ovrLabel={t("common.ovr")}
          averageLabel={t("common.average")}
          hiddenTitle={t("playerProfile.attributesHidden")}
          hiddenBody={t("playerProfile.scoutToView")}
          listLabel={t("common.listView")}
          radarLabel={t("common.radarView")}
        />
      </div>
      <SeasonCard season={player.season} />
    </>
  );
}

function Hero({ player, club }: { player: SquadPlayerView; club: MyClubView }) {
  const { t, i18n } = useTranslation();
  const { ovr } = player;
  const pictures = useOnlineStore((state) => state.playerPictures);
  const avatarTone =
    ovr >= 75
      ? "bg-primary-500/20 text-primary-400 border-primary-500/30"
      : ovr >= 55
        ? "bg-accent-500/20 text-accent-400 border-accent-500/30"
        : "bg-gray-500/20 text-gray-400 border-gray-500/30";
  return (
    <Card accent="primary">
      <div className="rounded-t-xl bg-linear-to-r from-navy-700 to-navy-800 p-8">
        <div className="flex items-start gap-6">
          <PlayerAvatar
            player={avatarOf(player, pictures)}
            className={`flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border-2 font-heading text-4xl font-bold ${avatarTone}`}
            fallback={<span>{ovr}</span>}
          />
          {player.shirtNumber !== undefined && (
            <JerseyIcon
              primaryColor={club.club.colors.primary}
              secondaryColor={club.club.colors.secondary}
              pattern={(club.club.kitPattern || "Solid") as KitPattern}
              number={player.shirtNumber}
              size="lg"
              className="shrink-0 self-center"
            />
          )}
          <div className="flex-1">
            <h2 className="font-heading text-3xl font-bold uppercase tracking-wide text-white">
              {player.fullName}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <PlayerPositionBadges
                primaryPosition={player.naturalPosition}
                alternatePositions={player.alternatePositions}
              />
              {trainsKeeperDrill(
                player.naturalPosition || player.position,
                club.trainingDay?.keeperDrill,
              ) && <KeeperDrillBadge />}
              <span className="text-sm text-gray-400">
                <CountryFlag
                  code={player.nationality}
                  locale={i18n.language}
                  className="mr-1 text-sm leading-none"
                />
                {countryName(player.nationality, i18n.language)}
              </span>
              <span className="text-gray-500">•</span>
              <span className="text-sm text-gray-400">
                {t("common.age")} {player.age}
              </span>
            </div>
            {/* Feet and build, as the offline profile shows them. */}
            <dl className="mt-3 grid max-w-xl grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
              <HeroStat label={t("common.footednessLabel")}>
                {t(`common.footedness.${player.footedness}`)}
              </HeroStat>
              <HeroStat label={t("common.weakFoot")}>
                <WeakFootRating value={player.weakFoot} />
              </HeroStat>
              <HeroStat label={t("common.height")}>
                {formatPlayerPhysique(player.heightCm, "centimeter", i18n.language)}
              </HeroStat>
              <HeroStat label={t("common.weight")}>
                {formatPlayerPhysique(player.weightKg, "kilogram", i18n.language)}
              </HeroStat>
            </dl>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-gray-400">
              <Shield className="h-4 w-4" aria-hidden />
              {club.club.name}
            </p>
            {player.traits.length > 0 && (
              <div className="mt-3">
                <TraitList traits={player.traits} size="sm" />
              </div>
            )}
            <div className="mt-3">
              <PotentialStars stars={player.potentialStars} />
            </div>
          </div>
          <div className="hidden grid-cols-2 gap-3 md:grid">
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
            <QuickStat label={t("common.ovr")} value={String(ovr)} color="text-white" />
            <QuickStat
              label={t("common.wage")}
              value={
                player.wage === undefined
                  ? "–"
                  : formatWeeklyAmount(formatVal(player.wage), t("finances.perWeekSuffix"))
              }
              color="text-white"
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

function QuickStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="min-w-25 rounded-xl bg-white/5 px-5 py-3 text-center">
      <p className="font-heading text-xs uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`mt-0.5 font-heading text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function SeasonCard({ season }: { season: SquadPlayerView["season"] }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>{t("playerProfile.seasonStats")}</CardHeader>
      <CardBody>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatBox label={t("playerProfile.apps")} value={season.appearances} />
          <StatBox label={t("playerProfile.goals")} value={season.goals} />
          <StatBox label={t("playerProfile.assists")} value={season.assists} />
          <StatBox
            label={t("playerProfile.avgRating")}
            value={season.avgRating > 0 ? season.avgRating.toFixed(1) : "-"}
          />
        </div>
      </CardBody>
    </Card>
  );
}

function StatBox({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg bg-gray-50 p-2.5 text-center dark:bg-navy-700">
      <p className="font-heading text-lg font-bold tabular-nums text-gray-800 dark:text-gray-100">
        {value}
      </p>
      <p className="font-heading text-xs uppercase tracking-wider text-gray-400 dark:text-gray-500">
        {label}
      </p>
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span>{label}</span>
        <span className="font-semibold">{value}%</span>
      </div>
      <ProgressBar value={value} variant="auto" size="sm" />
    </div>
  );
}

/** The player's auction, when he is up for one, or the way to put him up (C5-9). */
function ListingAction({ playerId, playerName }: { playerId: string; playerName: string }) {
  const { t } = useTranslation();
  const market = useOnlineStore((state) => state.market);
  const [open, setOpen] = useState(false);
  if (!market) return null;
  const listed = market.selling.find((auction) => auction.playerId === playerId);
  if (listed) {
    return (
      <Link
        to={`/online/auctions/${listed.id}`}
        className="inline-block rounded font-semibold text-primary-600 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-primary-400"
      >
        {t("online.market.listed")}
      </Link>
    );
  }
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t("online.market.list")}
      </Button>
      {open && (
        <ListingDialog playerId={playerId} playerName={playerName} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

/**
 * The way to let the player go for his severance (the offline "terminate contract"), unless he is
 * up for auction: a listed player stays until his auction is over, as the server would refuse it.
 */
function ReleaseAction({ player }: { player: SquadPlayerView }) {
  const { t } = useTranslation();
  const listed = useOnlineStore((state) =>
    state.market?.selling.some((auction) => auction.playerId === player.id),
  );
  const [open, setOpen] = useState(false);
  if (listed) return null;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {t("online.player.release")}
      </Button>
      {open && <ReleaseDialog player={player} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The ways to change how the player looks and where he is from: his photo and his nationality. */
function LookActions({ player }: { player: SquadPlayerView }) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState<"avatar" | "nationality" | null>(null);
  const listed = useOnlineStore((state) =>
    state.market?.selling.some((auction) => auction.playerId === player.id),
  );
  // A listed player keeps his picture and nationality until his auction is over, as the server
  // would refuse it.
  if (listed) return null;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setPicking("avatar")}>
        {t("online.player.avatarChange")}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setPicking("nationality")}>
        {t("online.player.nationalityChange")}
      </Button>
      {picking === "avatar" && (
        <PlayerAvatarPicker player={player} onClose={() => setPicking(null)} />
      )}
      {picking === "nationality" && (
        <PlayerNationalityDialog player={player} onClose={() => setPicking(null)} />
      )}
    </>
  );
}

/** The way to change the player's shirt number, as the offline squad's picker does. */
function ShirtAction({ player }: { player: SquadPlayerView }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {t("squad.jerseyPickerAction")}
      </Button>
      {open && <ShirtNumberPicker player={player} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The way to rename the player (S-14), unless he is up for auction: a listed player keeps his
 * name until the auction is over, as the server would refuse it.
 */
function RenameAction({ player }: { player: SquadPlayerView }) {
  const { t } = useTranslation();
  const listed = useOnlineStore((state) =>
    state.market?.selling.some((auction) => auction.playerId === player.id),
  );
  const [open, setOpen] = useState(false);
  if (listed) return null;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {t("online.rename.open")}
      </Button>
      {open && <RenamePlayerDialog player={player} onClose={() => setOpen(false)} />}
    </>
  );
}
