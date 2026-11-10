import meta from "../../../assets/facilities/meta.json";
import type { ArtKey } from "./artKeys";

/**
 * The facilities art in `online/assets/facilities/`, copied from the render tool by
 * `scripts/sync-facility-art.sh` (c-27 §4.3). Each file is its own lazy import, so a screen loads
 * only the art it shows.
 */
const FILES = import.meta.glob<string>("../../../assets/facilities/*.webp", {
  query: "?url",
  import: "default",
});

/** Where an art piece sits around its own origin, in map units (1 unit = 1 m on the ground). */
export interface ArtMeta {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Whether it carries club colour, and so has `c1` / `c2` masks. */
  layers: boolean;
}

const META = meta as Record<ArtKey, ArtMeta>;

export function artMetaOf(key: ArtKey): ArtMeta {
  return META[key];
}

/** The files of one art piece: its base, and its two colour masks when it carries club colour. */
export interface ArtUrls {
  base: string;
  masks: [string | null, string | null];
}

async function urlOf(file: string): Promise<string> {
  const load = FILES[`../../../assets/facilities/${file}`];
  if (!load) throw new Error(`no facilities art ${file}`);
  return load();
}

export async function artUrls(key: string): Promise<ArtUrls> {
  const art = META[key as ArtKey];
  if (!art) throw new Error(`no facilities art ${key}`);
  const base = await urlOf(`${key}.base.webp`);
  if (!art.layers) return { base, masks: [null, null] };
  return { base, masks: [await urlOf(`${key}.c1.webp`), await urlOf(`${key}.c2.webp`)] };
}
