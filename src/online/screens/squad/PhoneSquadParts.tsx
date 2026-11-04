import { type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Cross, X } from "lucide-react";
import { TraitList } from "../../../components/TraitBadge";
import { translatePositionAbbreviation } from "../../../components/squad/SquadTab.helpers";
import { CountryFlag, PlayerAvatar } from "../../../components/ui";
import { condBgColor, condColor } from "../../../lib/playerConditionDisplay";
import { positionBadgeVariant } from "../../../lib/playerRating";
import type { SquadPlayerView } from "../../api";
import { useOnlineStore } from "../../store/onlineStore";
import PotentialStars from "../PotentialStars";
import { PlayerActions } from "./PhoneSquadActions";
import { avatarOf, ovrTone } from "./playerLook";
import type { PlayerFit } from "./squadFit";

const KEY = "online.squad.phone";
export const FOCUS =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-navy-800";

/** What the two columns of the list show (design m-doi-hinh's four lenses). */
export type Lens = "form" | "fit" | "growth" | "stats";

export const LENSES: Array<{ id: Lens; label: string; columns: [string, string] }> = [
  { id: "form", label: `${KEY}.lensForm`, columns: ["common.condition", "common.morale"] },
  { id: "fit", label: `${KEY}.lensFit`, columns: ["match.formation", "match.playStyle"] },
  { id: "growth", label: `${KEY}.lensGrowth`, columns: ["common.age", "online.squad.potential"] },
  { id: "stats", label: `${KEY}.lensStats`, columns: ["online.squad.apps", "online.squad.goals"] },
];

const TONE = {
  accent: "bg-accent-100 text-accent-800 dark:bg-accent-900/50 dark:text-accent-300",
  primary: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300",
  success: "bg-primary-100 text-primary-800 dark:bg-primary-900/50 dark:text-primary-300",
  danger: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300",
  neutral: "bg-gray-100 text-gray-600 dark:bg-navy-700 dark:text-gray-300",
};

/** A short position or fit label on a tinted chip. */
function Tag({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 font-heading text-[11px] font-bold uppercase leading-4 tracking-wide ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

/** A player's position, tinted by its line. */
export function PositionTag({ position }: { position: string }) {
  const { t } = useTranslation();
  return (
    <Tag tone={positionBadgeVariant(position)}>{translatePositionAbbreviation(t, position)}</Tag>
  );
}

const TACTICAL_TONE = { natural: "success", adapted: "accent", out: "danger" } as const;
const STYLE_TONE = { strong: "success", good: "accent", risky: "danger" } as const;

/** The slot a player stands in (his best one off the pitch), tinted by how well he fits it. */
function SlotTag({ fit }: { fit: PlayerFit }) {
  const { t } = useTranslation();
  return (
    <Tag tone={fit.starter ? TACTICAL_TONE[fit.tactical] : "neutral"}>
      {translatePositionAbbreviation(t, fit.starter ? fit.slot : fit.bestRole)}
    </Tag>
  );
}

function StyleTag({ fit }: { fit: PlayerFit }) {
  const { t } = useTranslation();
  return <Tag tone={STYLE_TONE[fit.style]}>{t(`squad.styleFitValues.${fit.style}`)}</Tag>;
}

/** A value with a thin bar under it. */
function Gauge({
  value,
  label,
  tone,
  bar,
}: {
  value: number;
  label: string;
  tone: string;
  bar: string;
}) {
  return (
    <span className="flex flex-col items-center gap-[3px]">
      <span className={`text-[13px] font-bold tabular-nums ${tone}`}>{label}</span>
      <span
        className="h-1 w-10 overflow-hidden rounded-full bg-gray-200 dark:bg-navy-700"
        aria-hidden="true"
      >
        <span className={`block h-full ${bar}`} style={{ width: `${value}%` }} />
      </span>
    </span>
  );
}

const PLAIN = "text-[13px] font-bold tabular-nums";

/** The two cells of a row under `lens`. */
export function lensCells(
  lens: Lens,
  player: SquadPlayerView,
  fit: PlayerFit | undefined,
): [ReactNode, ReactNode] {
  switch (lens) {
    case "form":
      return [
        <Gauge
          key="condition"
          value={player.condition}
          label={`${player.condition}%`}
          tone={condColor(player.condition)}
          bar={condBgColor(player.condition)}
        />,
        <Gauge
          key="morale"
          value={player.morale}
          label={String(player.morale)}
          tone="text-blue-700 dark:text-blue-300"
          bar="bg-blue-400"
        />,
      ];
    case "fit":
      return fit
        ? [<SlotTag key="slot" fit={fit} />, <StyleTag key="style" fit={fit} />]
        : [null, null];
    case "growth":
      return [
        <span
          key="age"
          className={`${PLAIN} ${player.age <= 21 ? "text-primary-700 dark:text-primary-300" : "text-gray-700 dark:text-gray-200"}`}
        >
          {player.age}
        </span>,
        <span key="stars" className={`${PLAIN} text-accent-700 dark:text-accent-400`}>
          {player.potentialStars}★
        </span>,
      ];
    default:
      return [
        <span key="apps" className={`${PLAIN} text-gray-900 dark:text-white`}>
          {player.season.appearances}
        </span>,
        <span
          key="goals"
          className={`${PLAIN} ${player.season.goals > 0 ? "text-accent-700 dark:text-accent-400" : "text-gray-500 dark:text-gray-400"}`}
        >
          {player.season.goals}
        </span>,
      ];
  }
}

export const ROW_GRID = "grid-cols-[4px_44px_minmax(0,1fr)_56px_56px_36px]";

/** One player as a row to tap: his face and number, name and positions, the lens, his overall. */
export function PlayerRow({
  player,
  starter,
  fit,
  lens,
  onOpen,
}: {
  player: SquadPlayerView;
  starter: boolean;
  fit: PlayerFit | undefined;
  lens: Lens;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const pictures = useOnlineStore((state) => state.playerPictures);
  const [first, second] = lensCells(lens, player, fit);
  const position = translatePositionAbbreviation(t, player.naturalPosition);
  const others = player.alternatePositions
    .filter((one) => one !== player.naturalPosition)
    .map((one) => translatePositionAbbreviation(t, one));
  const label = t(starter ? `${KEY}.rowStarter` : `${KEY}.rowBench`, {
    name: player.matchName,
    position,
    ovr: player.ovr,
  });
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className={`grid min-h-[60px] w-full ${ROW_GRID} items-center gap-1.5 overflow-hidden rounded-[10px] bg-white py-2 pr-2.5 text-left active:bg-gray-100 dark:bg-navy-800 dark:active:bg-navy-700 ${FOCUS}`}
    >
      <span
        aria-hidden="true"
        className={`-my-2 self-stretch ${starter ? "bg-primary-500" : player.injury ? "bg-amber-400" : ""}`}
      />
      <span className="relative h-10 w-10 justify-self-center">
        <PlayerAvatar
          player={avatarOf(player, pictures)}
          className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-gray-200 font-heading text-sm font-bold text-gray-700 dark:bg-navy-700 dark:text-white"
        />
        <span className="absolute -bottom-[3px] -right-[5px] flex h-4 min-w-[18px] items-center justify-center rounded border border-gray-200 bg-white px-[3px] text-[10px] font-bold text-gray-600 dark:border-navy-600 dark:bg-navy-900 dark:text-gray-300">
          {player.shirtNumber ?? "—"}
        </span>
      </span>
      <span className="flex min-w-0 flex-col gap-[3px] pl-1">
        <span className="flex min-w-0 items-center gap-[5px]">
          <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">
            {player.matchName}
          </span>
          <CountryFlag code={player.nationality} className="shrink-0 text-[13px] leading-none" />
          {player.injury && (
            <Cross
              className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400"
              aria-hidden="true"
            />
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap">
          <PositionTag position={player.naturalPosition} />
          <span className="truncate text-[11px] text-gray-500 dark:text-gray-400">
            {others.join(" · ")}
          </span>
        </span>
      </span>
      <span className="flex justify-center">{first}</span>
      <span className="flex justify-center">{second}</span>
      <span
        className={`text-right font-heading text-xl font-bold tabular-nums ${ovrTone(player.ovr)}`}
      >
        {player.ovr}
      </span>
    </button>
  );
}

/** A labelled bar in the sheet: condition or morale. */
function SheetGauge({
  label,
  value,
  text,
  tone,
  bar,
}: {
  label: string;
  value: number;
  text: string;
  tone: string;
  bar: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] bg-gray-100 p-2.5 dark:bg-navy-900/60">
      <span className="text-[11px] text-gray-500 dark:text-gray-400">{label}</span>
      <span className="flex items-center gap-2">
        <span
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-navy-700"
          aria-hidden="true"
        >
          <span className={`block h-full ${bar}`} style={{ width: `${value}%` }} />
        </span>
        <strong className={`tabular-nums ${tone}`}>{text}</strong>
      </span>
    </div>
  );
}

/**
 * One player risen from the bottom: his number, age and status, condition and morale, positions,
 * fits, potential, season and traits; then his full page, or what can be done with him.
 */
export function PlayerSheet({
  player,
  starter,
  fit,
  formation,
  onClose,
}: {
  player: SquadPlayerView;
  starter: boolean;
  fit: PlayerFit | undefined;
  formation: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const pictures = useOnlineStore((state) => state.playerPictures);
  const selling = useOnlineStore((state) =>
    state.market?.selling.some((auction) => auction.playerId === player.id),
  );
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  const titleId = `phone-squad-sheet-${player.id}`;
  const positions = [
    player.naturalPosition,
    ...player.alternatePositions.filter((one) => one !== player.naturalPosition),
  ];
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-end">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 bg-navy-900/60"
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        className="relative max-h-[88vh] w-full max-w-[560px] overflow-y-auto rounded-t-[20px] border border-b-0 border-gray-200 bg-white px-4 pb-[calc(1rem+var(--safe-bottom))] pt-2 focus:outline-none motion-safe:animate-sheet-up dark:border-navy-600 dark:bg-navy-800"
      >
        <span
          className="mx-auto mb-3 block h-1 w-10 rounded-full bg-gray-300 dark:bg-navy-600"
          aria-hidden="true"
        />
        <div className="flex items-center gap-3 pt-1">
          <PlayerAvatar
            player={avatarOf(player, pictures)}
            className={`flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 font-heading text-xl font-bold text-gray-700 ring-3 dark:bg-navy-700 dark:text-white ${starter ? "ring-primary-500" : "ring-gray-200 dark:ring-navy-600"}`}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <h2 className="flex items-center gap-1.5 font-heading text-2xl font-bold uppercase leading-none tracking-wide text-gray-900 dark:text-white">
              <span id={titleId} className="truncate">
                {player.matchName}
              </span>
              <CountryFlag code={player.nationality} className="shrink-0 text-lg leading-none" />
            </h2>
            <span className="flex flex-wrap items-center gap-x-1 text-xs text-gray-600 dark:text-gray-400">
              <span>
                {t(`${KEY}.sheetLine`, { number: player.shirtNumber ?? "—", age: player.age })}
              </span>
              <span aria-hidden="true">·</span>
              <span className={starter ? "text-primary-700 dark:text-primary-400" : ""}>
                {t(starter ? "squad.starter" : "squad.benchOption")}
              </span>
              {player.injury && (
                <span className="text-red-600 dark:text-red-400">· {t("common.injured")}</span>
              )}
              {player.suspendedMatches !== undefined && (
                <span className="text-red-600 dark:text-red-400">
                  · {t("online.squad.suspended", { count: player.suspendedMatches })}
                </span>
              )}
              {selling && (
                <span className="text-accent-700 dark:text-accent-400">
                  · {t("online.market.selling")}
                </span>
              )}
            </span>
          </div>
          <div className="flex flex-col items-center rounded-[10px] border border-gray-200 bg-gray-50 px-2.5 py-1 dark:border-navy-600 dark:bg-navy-900">
            <span className="text-[10px] tracking-widest text-gray-500 dark:text-gray-400">
              {t("common.ovr")}
            </span>
            <span
              className={`font-heading text-[28px] font-bold leading-none ${ovrTone(player.ovr)}`}
            >
              {player.ovr}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className={`-mr-1 flex h-10 w-10 shrink-0 items-center justify-center self-start rounded-full text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-navy-700 ${FOCUS}`}
          >
            <X className="h-4.5 w-4.5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-3.5 grid grid-cols-2 gap-2">
          <SheetGauge
            label={t("common.condition")}
            value={player.condition}
            text={`${player.condition}%`}
            tone={condColor(player.condition)}
            bar={condBgColor(player.condition)}
          />
          <SheetGauge
            label={t("common.morale")}
            value={player.morale}
            text={String(player.morale)}
            tone="text-blue-700 dark:text-blue-300"
            bar="bg-blue-400"
          />
        </div>

        <dl className="mt-3 grid grid-cols-[110px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-[13px]">
          <dt className="text-gray-500 dark:text-gray-400">{t("common.position")}</dt>
          <dd className="flex flex-wrap gap-1">
            {positions.map((one) => (
              <PositionTag key={one} position={one} />
            ))}
          </dd>
          {fit && (
            <>
              <dt className="text-gray-500 dark:text-gray-400">{t("squad.formationFit")}</dt>
              <dd className="text-gray-900 dark:text-white">
                {t(fit.starter ? `${KEY}.playsIn` : `${KEY}.bestIn`, {
                  slot: translatePositionAbbreviation(t, fit.starter ? fit.slot : fit.bestRole),
                  formation,
                })}
              </dd>
              <dt className="text-gray-500 dark:text-gray-400">{t("squad.styleFit")}</dt>
              <dd>
                <StyleTag fit={fit} />
              </dd>
            </>
          )}
          <dt className="text-gray-500 dark:text-gray-400">{t("online.squad.potential")}</dt>
          <dd>
            <PotentialStars stars={player.potentialStars} />
          </dd>
          <dt className="text-gray-500 dark:text-gray-400">{t(`${KEY}.season`)}</dt>
          <dd className="text-gray-900 dark:text-white">
            {t(`${KEY}.seasonLine`, {
              apps: player.season.appearances,
              goals: player.season.goals,
            })}
          </dd>
        </dl>

        <div className="mt-3.5 flex flex-col gap-2">
          <span className="font-heading text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
            {t(`${KEY}.traitsTitle`, { count: player.traits.length })}
          </span>
          {player.traits.length === 0 ? (
            <span className="text-[13px] text-gray-500 dark:text-gray-400">
              {t(`${KEY}.noTraits`)}
            </span>
          ) : (
            <TraitList traits={player.traits} size="sm" />
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link
            to={`/online/squad/${player.id}`}
            className={`flex h-11 items-center justify-center rounded-[10px] border border-gray-300 text-[13px] font-semibold text-gray-700 dark:border-navy-600 dark:text-gray-200 ${FOCUS}`}
          >
            {t(`${KEY}.fullProfile`)}
          </Link>
          <PlayerActions player={player} />
        </div>
      </div>
    </div>
  );
}
