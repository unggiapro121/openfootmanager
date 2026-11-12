import type { TFunction } from "i18next";
import type { FacilityItemView } from "../../api";
import type { ArtKey } from "./art/artKeys";
import { type StadiumStyle, stadiumStyleOf } from "./art/stadiumStyle";

/** The facilities a season builds over time, in the screen's order (c-27 §5.3). */
export const STADIUM_FACILITIES = ["stands"] as const;
export const COMMERCE_FACILITIES = ["shop", "food", "park"] as const;
export const SPORTS_FACILITIES = ["training", "medical", "academy"] as const;

const NAME_KEY: Record<string, string> = {
  stands: "online.facilities.name.stands",
  shop: "online.facilities.name.shop",
  food: "online.facilities.name.food",
  park: "online.facilities.name.park",
  training: "online.facilities.name.training",
  medical: "online.facilities.name.medical",
  academy: "online.facilities.name.academy",
};

/** A facility's name; one this build does not know, as the server spells it. */
export function facilityName(t: TFunction, facility: string): string {
  const key = NAME_KEY[facility];
  return key ? t(key) : facility;
}

const STYLE_KEY: Record<StadiumStyle, string> = {
  tinh: "online.facilities.stadiumStyle.tinh",
  gian: "online.facilities.stadiumStyle.gian",
  anh: "online.facilities.stadiumStyle.anh",
  hop: "online.facilities.stadiumStyle.hop",
  mang: "online.facilities.stadiumStyle.mang",
  buom: "online.facilities.stadiumStyle.buom",
  chao: "online.facilities.stadiumStyle.chao",
  so: "online.facilities.stadiumStyle.so",
  mo: "online.facilities.stadiumStyle.mo",
  luoi: "online.facilities.stadiumStyle.luoi",
};

/** The name of the stadium's style at stands `level` (c-27 §4.4). */
export function styleName(t: TFunction, level: number): string {
  return t(STYLE_KEY[stadiumStyleOf(level)]);
}

/** The art a card shows: the stadium's style, the building, or the empty plot not built yet. */
export function cardArt(item: Pick<FacilityItemView, "facility" | "level">): ArtKey | null {
  if (item.facility === "stands") return stadiumStyleOf(item.level);
  if (item.level === 0) return "empty";
  const known: readonly string[] = [...COMMERCE_FACILITIES, ...SPORTS_FACILITIES];
  return known.includes(item.facility) ? (item.facility as ArtKey) : null;
}

/** A commerce building: it earns from every spectator at home matches. */
export function isCommerce(facility: string): boolean {
  return (COMMERCE_FACILITIES as readonly string[]).includes(facility);
}

/**
 * A stretch of real time, roughly, for a build's days on a world whose day is shorter than a
 * real one (c-27 §5.5: "6 days (≈ 6 hours)"): whole hours, or minutes under one.
 */
export function realTime(t: TFunction, seconds: number): string {
  if (seconds >= 3600)
    return t("online.facilities.realHours", { hours: Math.round(seconds / 3600) });
  return t("online.facilities.realMinutes", { minutes: Math.max(1, Math.round(seconds / 60)) });
}

/** Time left as the online countdowns write it: days, then the clock. */
export function timeLeft(t: TFunction, seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const days = Math.floor(whole / 86_400);
  const rest = whole % 86_400;
  const pad = (value: number) => String(value).padStart(2, "0");
  const clock = `${pad(Math.floor(rest / 3600))}:${pad(Math.floor((rest % 3600) / 60))}:${pad(rest % 60)}`;
  return days > 0 ? t("online.countdown.withDays", { days, clock }) : clock;
}
