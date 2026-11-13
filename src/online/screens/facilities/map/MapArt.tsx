import type { KeyboardEvent } from "react";
import { useOnlineStore } from "../../../store/onlineStore";
import { useClubArt } from "../art/ClubArt";
import type { ArtKey } from "../art/artKeys";
import { artBox, type MapSlot, RING } from "./layout";
import { cranePlace, type MapStatus, ringPath, slotPoint } from "./mapView";

/** One piece of art in the club's colours, at its own origin; nothing until it has loaded. */
function ArtImage({ art, dimmed = false }: { art: ArtKey; dimmed?: boolean }) {
  const profile = useOnlineStore((state) => state.club?.club);
  const url = useClubArt(art, profile);
  if (!url) return null;
  const box = artBox(art);
  return (
    <image
      href={url}
      x={box.x}
      y={box.y}
      width={box.w}
      height={box.h}
      preserveAspectRatio="none"
      opacity={dimmed ? 0.55 : 1}
    />
  );
}

/** The campus ground under every building. */
export function MapGround() {
  return <ArtImage art="ground" />;
}

/**
 * A building drawn on its slot with its footprint ring: gold when picked, white while its label
 * has the keyboard's focus. The picture is for the pointer and carries no role or name; the
 * keyboard and screen readers reach the building through its label.
 */
export function MapBuilding({
  slot,
  art,
  dimmed,
  picked,
  focused,
  onPick,
}: {
  slot: MapSlot;
  art: ArtKey;
  dimmed: boolean;
  picked: boolean;
  focused: boolean;
  onPick: () => void;
}) {
  const [x, y] = slotPoint(slot);
  const ring = picked ? "stroke-accent-400" : focused ? "stroke-white" : "stroke-transparent";
  return (
    <g
      transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}
      onClick={onPick}
      className="cursor-pointer hover:brightness-110"
      data-slot={slot}
    >
      <ArtImage art={art} dimmed={dimmed} />
      <path
        d={ringPath(RING[slot])}
        fill="none"
        className={ring}
        strokeWidth={slot === "stands" ? 3 : 2.2}
      />
    </g>
  );
}

/** The crane over the building being built. */
export function MapCrane({ slot }: { slot: MapSlot }) {
  const { x, y, scale } = cranePlace(slot);
  const scaled = scale === 1 ? "" : ` scale(${scale})`;
  return (
    <g transform={`translate(${x.toFixed(1)},${y.toFixed(1)})${scaled}`} pointerEvents="none">
      <ArtImage art="crane" />
    </g>
  );
}

const DOT: Record<MapStatus | "none", string> = {
  building: "fill-primary-400",
  upgradable: "fill-accent-400",
  waiting: "fill-slate-500",
  top: "fill-violet-400",
  none: "fill-slate-400",
};

/**
 * A building's label over the map (c-27 §6.1–6.2): its name, level and state dot, the same size
 * on screen at every zoom. It is the building's control for the keyboard: focusable in the List's
 * order, named "<name>, <level>[, building]", picked with Enter or Space.
 */
export function MapLabel({
  slot,
  x,
  y,
  zoom,
  name,
  level,
  status,
  ariaLabel,
  isNew,
  newText,
  picked,
  onPick,
  onFocusChange,
}: {
  slot: MapSlot;
  x: number;
  y: number;
  /** Map units per CSS px at the current zoom. */
  zoom: number;
  name: string;
  level: string;
  status: MapStatus | "none";
  ariaLabel: string;
  isNew: boolean;
  newText: string;
  picked: boolean;
  onPick: () => void;
  onFocusChange: (focused: boolean) => void;
}) {
  const width = Math.round(name.length * 7 + level.length * 6.2 + 34);
  const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onPick();
  };
  return (
    <g
      transform={`translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${zoom.toFixed(3)})`}
      data-label={slot}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-pressed={picked}
      onClick={onPick}
      onKeyDown={onKeyDown}
      onFocus={() => onFocusChange(true)}
      onBlur={() => onFocusChange(false)}
      className="group cursor-pointer outline-none"
    >
      <path d="M-6,-1L0,7L6,-1Z" className="fill-navy-900/90" />
      <rect
        x={-width / 2}
        y={-24}
        width={width}
        height={24}
        rx={12}
        strokeWidth={1.2}
        className={`fill-navy-900/90 ${picked ? "stroke-accent-400" : "stroke-navy-600"} group-focus-visible:stroke-white group-focus-visible:[stroke-width:2.5]`}
      />
      <circle cx={-width / 2 + 14} cy={-12} r={4} className={DOT[status]} />
      <text
        x={-width / 2 + 24}
        y={-8}
        fontSize={12}
        fontWeight={700}
        className="fill-white font-sans"
      >
        {name}{" "}
        <tspan fontSize={11} fontWeight={600} className="fill-gray-400">
          {level}
        </tspan>
      </text>
      {isNew && (
        <g transform={`translate(${width / 2 - 12},-28)`}>
          <rect x={0} y={-8} width={30} height={14} rx={7} className="fill-accent-400" />
          <text
            x={15}
            y={2.5}
            textAnchor="middle"
            fontSize={9}
            fontWeight={800}
            className="fill-navy-900 font-sans uppercase"
          >
            {newText}
          </text>
        </g>
      )}
    </g>
  );
}

/** The dot classes, for the legend to match the map. */
export const STATUS_DOT_BG: Record<MapStatus, string> = {
  building: "bg-primary-400",
  upgradable: "bg-accent-400",
  waiting: "bg-slate-500",
  top: "bg-violet-400",
};
