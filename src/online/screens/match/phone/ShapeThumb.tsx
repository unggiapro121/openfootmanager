import { buildPitchRows } from "../../../../components/squad/SquadTab.helpers";
import { getSlotXCoordinates } from "../../../../components/tactics/TacticsTab.helpers";

/** A shape drawn small, attacking to the right: one dot a slot. */
export function ShapeThumb({ formation, picked }: { formation: string; picked: boolean }) {
  const rows = buildPitchRows(formation);
  const dots = rows.flatMap((row) => {
    const depth = Number.parseFloat(row.y);
    return getSlotXCoordinates(row.positions.length).map((across) => ({
      x: 4 + ((100 - depth) / 100) * 52,
      y: 3 + (across / 100) * 34,
    }));
  });
  return (
    <svg viewBox="0 0 60 40" className="block w-full rounded bg-primary-800" aria-hidden="true">
      <path d="M30 0V40" className="stroke-white/25" strokeWidth="0.6" />
      {dots.map((dot) => (
        <circle
          key={`${dot.x}-${dot.y}`}
          cx={dot.x}
          cy={dot.y}
          r="2.2"
          className={picked ? "fill-primary-300" : "fill-gray-300"}
        />
      ))}
    </svg>
  );
}
