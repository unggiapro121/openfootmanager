import { useId, type ReactNode } from "react";

const LINE = "rgba(255,255,255,0.55)";

interface PitchSurfaceProps {
  className?: string;
  /** Extra SVG drawn over the markings, in the 100×140 pitch coordinates. */
  overlay?: ReactNode;
  /** What stands on the pitch — tokens positioned in % of this surface. */
  children?: ReactNode;
}

/**
 * The one pitch every lineup is drawn on: the tactics board, the pre-match
 * screen, the substitution panel and the half-time break. Size it with
 * `className`; the markings stretch to fit (viewBox 100×140).
 */
export function PitchSurface({ className = "", overlay, children }: PitchSurfaceProps) {
  const uid = useId();
  const surfaceId = `pitch-surface-${uid}`;
  const stripesId = `pitch-stripes-${uid}`;
  return (
    <div
      className={`relative overflow-hidden rounded-[1.5rem] border border-primary-500/20 bg-linear-to-b from-primary-500 to-primary-700 shadow-inner ${className}`}
    >
      {/* Decoration: everything a screen reader needs is in the tokens on top. */}
      <svg
        viewBox="0 0 100 140"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={surfaceId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(63, 172, 99, 0.94)" />
            <stop offset="100%" stopColor="rgba(31, 109, 61, 0.98)" />
          </linearGradient>
          <pattern id={stripesId} width="100" height="20" patternUnits="userSpaceOnUse">
            <rect width="100" height="10" fill="rgba(255,255,255,0.04)" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="100" height="140" fill={`url(#${surfaceId})`} />
        <rect x="0" y="0" width="100" height="140" fill={`url(#${stripesId})`} />
        <rect x="4" y="4" width="92" height="132" fill="none" stroke={LINE} strokeWidth="0.6" />
        <line x1="4" y1="70" x2="96" y2="70" stroke={LINE} strokeWidth="0.6" />
        <circle cx="50" cy="70" r="11" fill="none" stroke={LINE} strokeWidth="0.6" />
        <circle cx="50" cy="70" r="0.8" fill="rgba(255,255,255,0.75)" />
        <rect x="18" y="4" width="64" height="18" fill="none" stroke={LINE} strokeWidth="0.6" />
        <rect x="31" y="4" width="38" height="8" fill="none" stroke={LINE} strokeWidth="0.6" />
        <rect x="18" y="118" width="64" height="18" fill="none" stroke={LINE} strokeWidth="0.6" />
        <rect x="31" y="128" width="38" height="8" fill="none" stroke={LINE} strokeWidth="0.6" />
        <path d="M 38 22 A 12 12 0 0 0 62 22" fill="none" stroke={LINE} strokeWidth="0.6" />
        <path d="M 38 118 A 12 12 0 0 1 62 118" fill="none" stroke={LINE} strokeWidth="0.6" />
        {overlay}
      </svg>
      {children}
    </div>
  );
}
