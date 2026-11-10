import { type ArtUrls, artUrls } from "./artFiles";
import { linearOf, pixelOf, sceneOf } from "./toneCurve";

/**
 * Club colours on the pre-rendered facilities art (c-27 §4.2, C27-4). Each piece ships as a
 * `base` with the club's colours rendered white, and an alpha mask per colour. Painting is a
 * multiply of the base's light, before the render's tone curve (`toneCurve.ts`):
 * `tone(light × Π(1 − m + m × colour))`, so the base's light and shadow stay on the colour.
 * The masks come from two render passes, which is why stands, glass, LEDs and glow all take it.
 */

export type Rgb = readonly [number, number, number];

/** An image's pixels as `ImageData` holds them: RGBA, 8 bits, not premultiplied. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** A colour's mask (white, alpha = coverage) and the paint it takes (sRGB 0–255). */
export interface PaintLayer {
  mask: Uint8ClampedArray;
  colour: Rgb;
}

/**
 * The darkest paint, in CIELAB L*. A multiply with near-black would turn a stand solid black;
 * held here, it reads as a dark colour with its shading. Only the art is held, never the crest.
 */
export const MIN_PAINT_LIGHTNESS = 18;

/** The base painted with each layer's colour where its mask is; alpha is the base's. */
export function tintPixels(
  base: Uint8ClampedArray,
  layers: readonly PaintLayer[],
): Uint8ClampedArray {
  for (const layer of layers) {
    if (layer.mask.length !== base.length) {
      throw new Error("a mask must be the size of its base");
    }
  }
  const paints = layers.map(({ mask, colour }) => ({
    mask,
    light: [linearOf(colour[0]), linearOf(colour[1]), linearOf(colour[2])],
  }));
  const out = new Uint8ClampedArray(base);
  for (let index = 0; index < base.length; index += 4) {
    const gain = [1, 1, 1];
    let painted = false;
    for (const { mask, light } of paints) {
      const coverage = mask[index + 3] / 255;
      if (coverage === 0) continue;
      painted = true;
      for (let channel = 0; channel < 3; channel += 1) {
        gain[channel] *= 1 - coverage + coverage * light[channel];
      }
    }
    if (!painted) continue;
    const scene = sceneOf(base[index], base[index + 1], base[index + 2]);
    const pixel = pixelOf([scene[0] * gain[0], scene[1] * gain[1], scene[2] * gain[2]]);
    out[index] = Math.round(pixel[0]);
    out[index + 1] = Math.round(pixel[1]);
    out[index + 2] = Math.round(pixel[2]);
  }
  return out;
}

/** `#rrggbb` as 0–255 channels; anything else is white, which leaves the base as rendered. */
function rgbOf(hex: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!match) return [255, 255, 255];
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

const toChannel = (linear: number) => {
  const value = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, value * 255));
};

// CIELAB with the D65 white, the sRGB white.
const WHITE = [0.95047, 1, 1.08883] as const;
const labF = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
const labInverse = (f: number) => (f ** 3 > 216 / 24389 ? f ** 3 : (116 * f - 16) / (24389 / 27));

function labOf([red, green, blue]: Rgb): [number, number, number] {
  const [r, g, b] = [linearOf(red), linearOf(green), linearOf(blue)];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / WHITE[0];
  const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / WHITE[1];
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / WHITE[2];
  const [fx, fy, fz] = [labF(x), labF(y), labF(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** A colour's CIELAB lightness L*, 0–100. */
export function lightnessOf(colour: Rgb): number {
  return labOf(colour)[0];
}

/** The sRGB colour of a CIELAB colour, each channel rounded up (never darker than asked). */
function rgbOfLab([lightness, a, b]: [number, number, number]): Rgb {
  const fy = (lightness + 16) / 116;
  const x = labInverse(fy + a / 500) * WHITE[0];
  const y = labInverse(fy) * WHITE[1];
  const z = labInverse(fy - b / 200) * WHITE[2];
  const linear = [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ];
  const [red, green, blue] = linear.map((channel) => Math.ceil(toChannel(channel)));
  return [red, green, blue];
}

/** The paint a club colour gives the art: the colour itself, lifted to L* 18 when darker. */
export function paintColour(hex: string): Rgb {
  const colour = rgbOf(hex);
  const lab = labOf(colour);
  if (lab[0] >= MIN_PAINT_LIGHTNESS) return colour;
  return rgbOfLab([MIN_PAINT_LIGHTNESS, lab[1], lab[2]]);
}

/** What the cache needs from the browser, so a test can stand in for it. */
export interface TintDeps {
  artUrls(key: string): Promise<ArtUrls>;
  decode(url: string): Promise<Pixels>;
  /** The painted pixels as an object URL. */
  encode(pixels: Pixels): Promise<string>;
  revoke(url: string): void;
}

interface Painted {
  url: string;
  /** Whether the URL was made here, and so is ours to revoke. */
  owned: boolean;
}

/**
 * Painted art by (key, colour 1, colour 2), kept for the last `capacity` asked for. A dropped
 * entry's object URL is revoked; the base of art without colour is handed back as it is.
 */
export function createTintCache(deps: TintDeps, capacity: number) {
  const entries = new Map<string, Promise<Painted>>();

  /** Revokes a dropped entry's URL once it is made; one that failed holds none. */
  function release(dropped: Promise<Painted>) {
    dropped.then(
      ({ url, owned }) => {
        if (owned) deps.revoke(url);
      },
      () => undefined,
    );
  }

  async function paint(key: string, c1: string, c2: string): Promise<Painted> {
    const urls = await deps.artUrls(key);
    const [mask1, mask2] = urls.masks;
    if (!mask1 && !mask2) return { url: urls.base, owned: false };
    const base = await deps.decode(urls.base);
    const layers: PaintLayer[] = [];
    for (const [mask, colour] of [
      [mask1, c1],
      [mask2, c2],
    ] as const) {
      if (mask) layers.push({ mask: (await deps.decode(mask)).data, colour: paintColour(colour) });
    }
    const data = tintPixels(base.data, layers);
    return {
      url: await deps.encode({ width: base.width, height: base.height, data }),
      owned: true,
    };
  }

  return function tinted(key: string, c1: string, c2: string): Promise<string> {
    const id = `${key}|${c1.toLowerCase()}|${c2.toLowerCase()}`;
    const found = entries.get(id);
    if (found) {
      entries.delete(id);
      entries.set(id, found);
      return found.then((painted) => painted.url);
    }
    const painted = paint(key, c1, c2);
    entries.set(id, painted);
    // A failure is the caller's to show; the cache only forgets it, so the next call tries again.
    painted.then(undefined, () => {
      if (entries.get(id) === painted) entries.delete(id);
    });
    while (entries.size > capacity) {
      const [oldest, dropped] = entries.entries().next().value as [string, Promise<Painted>];
      entries.delete(oldest);
      release(dropped);
    }
    return painted.then((result) => result.url);
  };
}

/** An image file's pixels, unpremultiplied and without colour conversion. */
async function decodeInBrowser(url: string): Promise<Pixels> {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob, {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  const { width, height } = bitmap;
  const canvas = canvasOf(width, height);
  const context = canvas.getContext("2d") as CanvasContext | null;
  if (!context) throw new Error("no 2D canvas");
  context.drawImage(bitmap, 0, 0);
  // A closed bitmap reads 0 × 0, so its size is taken first.
  bitmap.close();
  const image = context.getImageData(0, 0, width, height);
  return { width: image.width, height: image.height, data: image.data };
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type CanvasContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function canvasOf(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * The painted art as an image the screen can show. PNG, lossless: the shipped base already went
 * through WebP q 0.8 once, and a second lossy encode here (WebP q 0.92) took a painted stand
 * ΔE76 11–18 off the render (PO, C-27b acceptance). PNG is also what every webview encodes;
 * WebKit has no WebP encoder.
 */
export async function encodeTinted({ width, height, data }: Pixels): Promise<string> {
  const canvas = canvasOf(width, height);
  const context = canvas.getContext("2d") as CanvasContext | null;
  if (!context) throw new Error("no 2D canvas");
  context.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  const blob =
    "convertToBlob" in canvas
      ? await canvas.convertToBlob({ type: LOSSLESS })
      : await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((made) => (made ? resolve(made) : reject(new Error("no image"))), LOSSLESS),
        );
  return URL.createObjectURL(blob);
}

const LOSSLESS = "image/png";

/** The cache's size: a screen shows one stadium and seven buildings, twice for before / after. */
const TINT_CACHE_SIZE = 24;

/**
 * Art `key` in a club's two colours, as an image URL. The first call paints it (a few
 * milliseconds); later calls with the same key and colours return the same URL.
 */
export const tintedArt = createTintCache(
  {
    artUrls,
    decode: decodeInBrowser,
    encode: encodeTinted,
    revoke: (url) => URL.revokeObjectURL(url),
  },
  TINT_CACHE_SIZE,
);
