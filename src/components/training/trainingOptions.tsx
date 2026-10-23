import type { ReactNode } from "react";
import {
  BedDouble,
  Brain,
  Crosshair,
  Feather,
  Flame,
  HeartPulse,
  Scale,
  Shield,
  Zap,
} from "lucide-react";

/**
 * The choices of a club's training and how the training screens show them: the game's Training
 * tab and the online mode's (C-2) offer the same focus, intensity and schedule.
 */

export const TRAINING_FOCUS_IDS = [
  "Physical",
  "Technical",
  "Tactical",
  "Defending",
  "Attacking",
  "Recovery",
] as const;

export const TRAINING_FOCUS_ICONS: Record<string, ReactNode> = {
  Physical: <HeartPulse className="w-6 h-6" />,
  Technical: <Crosshair className="w-6 h-6" />,
  Tactical: <Brain className="w-6 h-6" />,
  Defending: <Shield className="w-6 h-6" />,
  Attacking: <Zap className="w-6 h-6" />,
  Recovery: <BedDouble className="w-6 h-6" />,
};

export const TRAINING_FOCUS_ATTRS: Record<string, string[]> = {
  Physical: ["pace", "stamina", "strength", "agility"],
  Technical: [
    "passing",
    "long_passing",
    "crossing",
    "curve",
    "free_kick",
    "shooting",
    "long_shots",
    "dribbling",
    "first_touch",
  ],
  Tactical: ["positioning", "vision", "decisions", "composure"],
  Defending: ["tackling", "defending", "strength", "positioning", "heading"],
  Attacking: ["shooting", "long_shots", "dribbling", "first_touch", "heading", "pace"],
  Recovery: [],
};

export const INTENSITY_IDS = ["Low", "Medium", "High"] as const;

export const INTENSITY_COLORS: Record<string, string> = {
  Low: "text-blue-500",
  Medium: "text-accent-500",
  High: "text-red-500",
};

export const SCHEDULE_IDS = ["Intense", "Balanced", "Light"] as const;

export const SCHEDULE_ICONS: Record<string, ReactNode> = {
  Intense: <Flame className="w-5 h-5" />,
  Balanced: <Scale className="w-5 h-5" />,
  Light: <Feather className="w-5 h-5" />,
};

export const SCHEDULE_COLORS: Record<string, string> = {
  Intense: "text-red-500",
  Balanced: "text-primary-500",
  Light: "text-blue-500",
};

export const SCHEDULE_TRAINING_DAYS: Record<string, number[]> = {
  Intense: [0, 1, 2, 3, 4, 5],
  Balanced: [0, 1, 3, 4],
  Light: [1, 3],
};

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export function getWeekdayFromDate(dateStr: string): number {
  const date = new Date(dateStr);
  return (date.getUTCDay() + 6) % 7;
}
