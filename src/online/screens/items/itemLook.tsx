import type { LucideIcon } from "lucide-react";
import {
  Bandage,
  BookOpen,
  BriefcaseMedical,
  CupSoda,
  HeartPulse,
  Hourglass,
  Package,
  Shield,
  Sparkles,
  Telescope,
  UserPen,
  Zap,
} from "lucide-react";

/**
 * How an item looks in the shop (design cua-hang.html): its icon, what it is used on as a short
 * badge, and for a tactical note the mastery band it is for. Looks only; every rule is the
 * server's.
 */
export type ItemScope = "player" | "eleven" | "injured" | "style" | "coach" | "club" | "trip";

export interface ItemLook {
  icon: LucideIcon;
  /** Gold rather than green: the items about the coach, not the squad. */
  gold?: boolean;
  scope?: ItemScope;
  /** A tactical note's mastery band: 1 low, 2 middle, 3 high. */
  masteryTier?: 1 | 2 | 3;
}

const LOOKS: Record<string, ItemLook> = {
  energyDrinkSmall: { icon: CupSoda, scope: "player" },
  energyDrinkLarge: { icon: Zap, scope: "player" },
  teamRecoveryPack: { icon: HeartPulse, scope: "eleven" },
  medkitBandage: { icon: Bandage, scope: "injured" },
  medkitAdvanced: { icon: BriefcaseMedical, scope: "injured" },
  tacticalNoteBasic: { icon: BookOpen, scope: "style", masteryTier: 1 },
  tacticalNoteAdvanced: { icon: BookOpen, scope: "style", masteryTier: 2 },
  tacticalNoteMaster: { icon: BookOpen, scope: "style", masteryTier: 3 },
  xpBoosterX2: { icon: Sparkles, gold: true, scope: "coach" },
  playerRename: { icon: UserPen, scope: "player" },
  clubRename: { icon: Shield, scope: "club" },
  scoutExpedition: { icon: Telescope, scope: "trip" },
  scoutExpeditionElite: { icon: Telescope, gold: true, scope: "trip" },
  timeSkip: { icon: Hourglass, scope: "trip" },
};

const UNKNOWN: ItemLook = { icon: Package };

/** An item code's look; a code this build does not know gets a plain box. */
export function lookOf(code: string): ItemLook {
  return LOOKS[code] ?? UNKNOWN;
}

/** The icon square of an item, green or gold. */
export function ItemIcon({ code, size }: { code: string; size: "md" | "lg" }) {
  const look = lookOf(code);
  const Icon = look.icon;
  const box = size === "lg" ? "h-14 w-14 rounded-xl" : "h-11 w-11 rounded-lg";
  const glyph = size === "lg" ? "h-7 w-7" : "h-5.5 w-5.5";
  const tone = look.gold
    ? "bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300"
    : "bg-gray-100 text-primary-600 dark:bg-navy-600 dark:text-primary-400";
  return (
    <span className={`flex shrink-0 items-center justify-center ${box} ${tone}`}>
      <Icon className={glyph} aria-hidden="true" />
    </span>
  );
}
