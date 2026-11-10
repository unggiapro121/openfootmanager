/**
 * The ten stadium styles of the facilities art, in the order the stands reach them (c-27 §4.4,
 * C27-7). A style is looks only: seats, money and matches come from the server by stands level.
 */
export const STADIUM_STYLES = [
  "tinh",
  "gian",
  "anh",
  "hop",
  "mang",
  "buom",
  "chao",
  "so",
  "mo",
  "luoi",
] as const;

export type StadiumStyle = (typeof STADIUM_STYLES)[number];

/** The stands level each style starts at, as the approved design draws them. */
export const STADIUM_STYLE_FROM = [1, 2, 4, 6, 8, 10, 12, 14, 15, 16] as const;

/** The style of a stadium at stands `level`; a level outside 1–16 is held to the nearest end. */
export function stadiumStyleOf(level: number): StadiumStyle {
  let style: StadiumStyle = STADIUM_STYLES[0];
  STADIUM_STYLE_FROM.forEach((from, index) => {
    if (level >= from) style = STADIUM_STYLES[index];
  });
  return style;
}
