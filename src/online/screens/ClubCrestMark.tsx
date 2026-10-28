import {
  CREST_PATTERNS,
  type CrestPattern,
  crestPatternOf,
  GeneratedCrest,
} from "../../components/ui/GeneratedCrest";
import type { ClubCrest, ClubProfileView } from "../api";

/** A pattern the server sent, when this build knows it; none draws the name's own. */
export function knownPattern(pattern: string): CrestPattern | undefined {
  return CREST_PATTERNS.find((known) => known === pattern);
}

/** `#rrggbb` for a kit colour (`#fff` widened); none for one a colour input cannot hold. */
function inputColour(colour: string): string | undefined {
  const hex = colour.trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`;
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return `#${[...hex.toLowerCase()].map((digit) => digit + digit).join("")}`;
  }
  return undefined;
}

/** Colours a crest editor starts from when the kit's cannot be read: black on white. */
const FALLBACK = { primary: "#111827", secondary: "#ffffff" };

/**
 * The crest a club's crest editor starts from: the one its coach drew, or else the one the game
 * draws from the club's kit and name, so saving it unchanged keeps the look.
 */
export function crestDraftOf(profile: ClubProfileView): ClubCrest {
  if (profile.crest) return { ...profile.crest };
  return {
    primary: inputColour(profile.colors.primary) ?? FALLBACK.primary,
    secondary: inputColour(profile.colors.secondary) ?? FALLBACK.secondary,
    pattern: crestPatternOf(profile.name),
    label: profile.shortName.slice(0, 3).toUpperCase(),
  };
}

/** A crest drawn from `crest`, for its club's `name`. */
export function CrestOf({
  name,
  crest,
  className = "h-full w-full",
}: {
  name: string;
  crest: ClubCrest;
  className?: string;
}) {
  return (
    <GeneratedCrest
      name={name}
      label={crest.label}
      colors={{ primary: crest.primary, secondary: crest.secondary }}
      pattern={knownPattern(crest.pattern)}
      className={className}
    />
  );
}

/**
 * A club's crest online: the one its coach drew, or the one the game draws from its kit
 * (C-2s; club crest, 2026-10-29).
 */
export default function ClubCrestMark({
  profile,
  className = "h-full w-full",
}: {
  profile: ClubProfileView;
  className?: string;
}) {
  if (profile.crest) {
    return <CrestOf name={profile.name} crest={profile.crest} className={className} />;
  }
  return (
    <GeneratedCrest
      name={profile.name}
      label={profile.shortName}
      colors={profile.colors}
      className={className}
    />
  );
}
