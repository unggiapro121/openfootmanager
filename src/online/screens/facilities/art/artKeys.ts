import { STADIUM_STYLES } from "./stadiumStyle";

/** The buildings of the campus art, the empty plot, the crane, and the campus ground. */
const OTHER_ART = [
  "shop",
  "food",
  "park",
  "training",
  "medical",
  "academy",
  "trophy",
  "empty",
  "crane",
  "ground",
] as const;

/** Every piece of facilities art the render tool makes (`3d-src/render.js --layers`). */
export const ART_KEYS = [...STADIUM_STYLES, ...OTHER_ART] as const;

export type ArtKey = (typeof ART_KEYS)[number];
