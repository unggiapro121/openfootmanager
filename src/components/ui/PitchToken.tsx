import type { ReactNode } from "react";
import type { PositionFit, TeamMatchRolesData } from "../../store/types";
import { getPositionColor } from "../../lib/positionColors";
import { PlayerAvatar } from "./PlayerAvatar";

/** How well a player fits the slot they occupy — drives the avatar ring colour. */
export type PitchFitTone = "exact" | "adapted" | "out" | "empty";

const FIT_TONE: Record<PositionFit, PitchFitTone> = {
  Natural: "exact",
  Adapted: "adapted",
  Unfamiliar: "out",
};

/** The backend's familiarity with a slot, as the token's fit ring draws it. */
export function fitToneOf(fit: PositionFit): PitchFitTone {
  return FIT_TONE[fit];
}

/** A small role marker chip (Captain, Penalty taker, etc.) stacked top-left. */
export interface PitchTokenMarker {
  key: string;
  shortLabel: string;
  /** Tailwind classes for the chip background/border/text. */
  toneClassName: string;
  /** Background + text only, for the stacked token's role dot and chips. */
  fillClassName: string;
}

export interface PitchTokenProps {
  /** Display name (already formatted/uppercased by the caller if desired). */
  name: string;
  /** Short position label shown top-right (e.g. "ST", "GK"). */
  positionAbbr: string;
  /** Raw position enum (e.g. "CenterBack"); colours the position badge. */
  position?: string;
  ovr: number;
  /** 0–100 short-term condition; drives the bar at the bottom. */
  condition: number;
  fitTone?: PitchFitTone;
  /** When present, renders a face/generated avatar; otherwise initials from name. */
  avatar?: { full_name: string; match_name: string; media?: { face?: string } };
  /** Role markers stacked at the top-left (max 3 shown). */
  markers?: PitchTokenMarker[];
  /** Optional slot below the name — e.g. a tactical-role combobox. */
  children?: ReactNode;
  /** "sm" for a pitch that must fit a dialog, such as the substitution panel. */
  size?: "md" | "sm";
  /**
   * "badges" (default): position and OVR on the avatar's corners, markers
   * stacked top-left. "stacked": the tactics board's compact token — one role
   * dot on the avatar, a position | OVR pill, the name and the condition bar
   * underneath.
   */
  layout?: "badges" | "stacked";
  /** The stacked token's selected look: a white ring with a halo. */
  selected?: boolean;
}

/**
 * The duties a player carries on a pitch — captain, vice-captain, penalties,
 * free kicks, corners — as marker chips, in that order. The one definition the
 * tactics board and the match screens share.
 */
export function pitchRoleMarkers(
  roles: Partial<TeamMatchRolesData> | undefined,
  playerId: string,
): PitchTokenMarker[] {
  if (!roles) {
    return [];
  }
  const duties: [keyof TeamMatchRolesData, string, string, string][] = [
    ["captain", "C", "border-accent-500 bg-accent-500 text-white", "bg-accent-500 text-navy-900"],
    ["vice_captain", "VC", "border-white/60 bg-gray-800/85 text-white", "bg-gray-800 text-white"],
    [
      "penalty_taker",
      "PK",
      "border-primary-500 bg-primary-500 text-white",
      "bg-primary-500 text-navy-900",
    ],
    [
      "free_kick_taker",
      "FK",
      "border-success-600 bg-success-600 text-white",
      "bg-success-600 text-white",
    ],
    [
      "corner_taker",
      "CK",
      "border-orange-500 bg-orange-500 text-white",
      "bg-orange-500 text-white",
    ],
  ];
  return duties
    .filter(([key]) => roles[key] === playerId)
    .map(([key, shortLabel, toneClassName, fillClassName]) => ({
      key,
      shortLabel,
      toneClassName,
      fillClassName,
    }));
}

function fitRingClass(fitTone: PitchFitTone): string {
  switch (fitTone) {
    case "exact":
      return "ring-2 ring-success-400";
    case "adapted":
      return "ring-2 ring-accent-400";
    case "out":
      return "ring-2 ring-red-400";
    default:
      return "ring-1 ring-white/25";
  }
}

function stackedRingClass(fitTone: PitchFitTone, selected: boolean): string {
  if (selected) {
    // The design's halo: a soft white band just outside the white ring.
    return "shadow-lg outline-4 outline-offset-3 outline-white/35 ring-3 ring-white";
  }
  switch (fitTone) {
    case "exact":
      return "shadow-md ring-3 ring-success-400";
    case "adapted":
      return "shadow-md ring-3 ring-accent-400";
    case "out":
      return "shadow-md ring-3 ring-red-400";
    default:
      return "shadow-md ring-2 ring-white/25";
  }
}

/** One dot for the duties: the duty's own chip when single, "+N" otherwise. */
function RoleDot({ markers, isSmall }: { markers: PitchTokenMarker[]; isSmall: boolean }) {
  if (markers.length === 0) {
    return null;
  }
  const single = markers.length === 1 ? markers[0] : null;
  return (
    <span
      data-testid="pitch-token-role-dot"
      className={`absolute -right-1.5 -top-1 z-10 flex items-center justify-center rounded-full border-2 border-primary-700 font-heading font-bold ${
        isSmall ? "h-3.5 min-w-3.5 px-0.5 text-[8px]" : "h-4.5 min-w-4.5 px-1 text-[10px]"
      } ${single ? single.fillClassName : "bg-white text-navy-900"}`}
    >
      {single ? single.shortLabel : `+${markers.length}`}
    </span>
  );
}

function conditionFillClass(condition: number, fitTone: PitchFitTone): string {
  // The fit tone caps the bar COLOUR (not its width): an out-of-position
  // player shows a warning-coloured bar even when fully fresh, signalling
  // reduced effectiveness in that slot.
  const capped = Math.min(condition, fitTone === "out" ? 56 : fitTone === "adapted" ? 74 : 100);
  if (capped >= 90) return "bg-success-400";
  if (capped >= 75) return "bg-primary-300";
  if (capped >= 60) return "bg-accent-300";
  return "bg-red-400";
}

/**
 * The pitch token every lineup uses — tactics board, pre-match, substitutions,
 * half-time: the player's face in a fit-tone ring, corner badges (position +
 * OVR), stacked role markers, the name, an optional control slot (e.g. a role
 * combobox), and a condition bar.
 *
 * It renders visuals only — wrap it in a button / drag handle and wire
 * interactions at the call site.
 */
export function PitchToken({
  name,
  positionAbbr,
  position,
  ovr,
  condition,
  fitTone = "empty",
  avatar,
  markers,
  children,
  size = "md",
  layout = "badges",
  selected = false,
}: PitchTokenProps) {
  const isSmall = size === "sm";
  if (layout === "stacked") {
    return (
      <>
        <div className="relative">
          <div
            data-testid="pitch-token-avatar"
            className={`${isSmall ? "h-8 w-8" : "h-13 w-13"} overflow-hidden rounded-full bg-navy-600 transition-shadow ${stackedRingClass(fitTone, selected)}`}
          >
            <PlayerAvatar
              player={avatar ?? { full_name: name, match_name: name }}
              className="h-full w-full"
            />
          </div>
          <RoleDot markers={markers ?? []} isSmall={isSmall} />
        </div>

        <span
          className={`mt-1 inline-flex overflow-hidden rounded-md font-heading font-bold leading-4 shadow-sm ${isSmall ? "text-[9px]" : "text-[11px]"}`}
        >
          <span
            className={`${position ? getPositionColor(position) : "bg-gray-900"} ${isSmall ? "px-1" : "px-1.5"} uppercase tracking-[0.05em] text-white`}
          >
            {positionAbbr}
          </span>
          <span className={`bg-navy-900 ${isSmall ? "px-1" : "px-1.5"} tabular-nums text-white`}>
            {ovr}
          </span>
        </span>

        <div
          className={`max-w-full truncate font-heading font-bold uppercase tracking-[0.05em] text-white text-shadow-md ${isSmall ? "text-[9px]" : "text-xs"}`}
        >
          {name}
        </div>

        {children}

        <div
          className={`${isSmall ? "w-8" : "w-14"} h-1 overflow-hidden rounded-full bg-navy-900/45`}
        >
          <div
            className={`h-full rounded-full ${conditionFillClass(condition, fitTone)}`}
            style={{ width: `${Math.max(0, Math.min(100, condition))}%` }}
          />
        </div>
      </>
    );
  }
  const badge = isSmall ? "px-1.5 text-[10px]" : "px-2 text-xs";
  return (
    <>
      {/* Avatar with overlaid badges */}
      <div className="relative">
        {markers && markers.length > 0 && (
          <div className="absolute -left-1.5 -top-1.5 z-10 flex flex-col gap-0.5">
            {markers.slice(0, 3).map((marker) => (
              <span
                key={marker.key}
                className={`rounded-full border font-heading font-bold ${isSmall ? "px-1 text-[8px] leading-3" : "px-1.5 py-0.5 text-[10px] leading-4"} ${marker.toneClassName}`}
              >
                {marker.shortLabel}
              </span>
            ))}
          </div>
        )}
        <div className="absolute -right-1.5 -top-1.5 z-10">
          <span
            className={`rounded-full ${position ? getPositionColor(position) : "bg-gray-900"} ${badge} py-0.5 font-heading font-bold uppercase leading-4 text-white ring-1 ring-white/40`}
          >
            {positionAbbr}
          </span>
        </div>
        <div
          data-testid="pitch-token-avatar"
          className={`${isSmall ? "h-8 w-8" : "h-11 w-11"} overflow-hidden rounded-full bg-gray-800/60 ${fitRingClass(fitTone)}`}
        >
          <PlayerAvatar
            player={avatar ?? { full_name: name, match_name: name }}
            className="h-full w-full"
          />
        </div>
        <div className="absolute -bottom-1 -right-1.5 z-10">
          <span
            className={`rounded-full bg-gray-900 ${badge} py-0.5 font-heading font-bold leading-4 text-white ring-1 ring-white/30`}
          >
            {ovr}
          </span>
        </div>
      </div>

      <div
        className={`max-w-full truncate font-heading font-bold uppercase text-white drop-shadow-sm ${isSmall ? "text-[9px] tracking-[0.08em]" : "text-xs tracking-[0.12em]"}`}
      >
        {name}
      </div>

      {children}

      <div className="w-full">
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full ${conditionFillClass(condition, fitTone)}`}
            style={{ width: `${Math.max(20, condition)}%` }}
          />
        </div>
      </div>
    </>
  );
}
