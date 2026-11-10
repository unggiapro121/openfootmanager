import { describe, expect, it, vi } from "vitest";
import {
  createTintCache,
  lightnessOf,
  MIN_PAINT_LIGHTNESS,
  paintColour,
  type Pixels,
  type Rgb,
  type TintDeps,
  encodeTinted,
  tintedArt,
  tintPixels,
} from "./tint";
import { linearOf, pixelOf, sceneOf } from "./toneCurve";

/** A 4×4 image: every pixel `rgba`. */
function flat(rgba: [number, number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (let pixel = 0; pixel < 16; pixel += 1) data.set(rgba, pixel * 4);
  return data;
}

/** A 4×4 mask: white, alpha `alphaAt(pixel)`. */
function mask(alphaAt: (pixel: number) => number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (let pixel = 0; pixel < 16; pixel += 1) data.set([255, 255, 255, alphaAt(pixel)], pixel * 4);
  return data;
}

function pixelAt(data: Uint8ClampedArray, pixel: number): number[] {
  return Array.from(data.slice(pixel * 4, pixel * 4 + 4));
}

describe("tintPixels", () => {
  /** What the renderer makes of `base`'s light times `paint` (linear 0–1 per channel). */
  function relit(base: [number, number, number], paint: [number, number, number]): number[] {
    const scene = sceneOf(...base);
    return pixelOf([scene[0] * paint[0], scene[1] * paint[1], scene[2] * paint[2]]);
  }
  const colour: Rgb = [128, 64, 255];
  const linear = colour.map(linearOf) as [number, number, number];

  // Given a 4×4 base whose colour-1 mask covers pixel 0 fully, pixel 1 by half and nothing else,
  // when it is tinted with a colour,
  // then pixels outside the mask keep every byte, the full pixel is the base's light × colour,
  // and the half pixel the base's light × (½ + ½ colour), both through the render's tone curve.
  it("multiplies the base's light by the colour where the mask is", () => {
    const base = flat([200, 180, 160, 255]);
    base.set([90, 60, 30, 128], 3 * 4);
    const coverage = [255, 128, 0, 0];
    const out = tintPixels(base, [{ mask: mask((pixel) => coverage[pixel] ?? 0), colour }]);

    for (let pixel = 2; pixel < 16; pixel += 1) {
      expect(pixelAt(out, pixel)).toEqual(pixelAt(base, pixel));
    }
    const full = relit([200, 180, 160], linear);
    for (const [index, channel] of pixelAt(out, 0).slice(0, 3).entries()) {
      expect(Math.abs(channel - full[index])).toBeLessThanOrEqual(1);
    }
    expect(pixelAt(out, 0)[3]).toBe(255);
    const half = 128 / 255;
    const halfPaint = linear.map((value) => 1 - half + half * value) as [number, number, number];
    const halfway = relit([200, 180, 160], halfPaint);
    for (const [index, channel] of pixelAt(out, 1).slice(0, 3).entries()) {
      expect(Math.abs(channel - halfway[index])).toBeLessThanOrEqual(2);
    }
  });

  // Given a stand pixel of the shop rendered with white club colour (236, 235, 233), and the same
  // pixel rendered straight in red #dc2626 (≈ 250, 67, 54) and blue #1d4ed8 (≈ 51, 97, 222),
  // when the white pixel is tinted fully with each colour,
  // then it comes out as the renderer drew it, to within the stand's own white highlight (a
  // full mask leaves no room for it; the real mask there is a little under 255), and far from
  // the darker plain multiply of the pixel (203, 35, 35).
  it("paints a stand as the renderer draws it in that colour", () => {
    const base = flat([236, 235, 233, 255]);
    const full = mask(() => 255);
    const red = pixelAt(tintPixels(base, [{ mask: full, colour: [220, 38, 38] }]), 0);
    const blue = pixelAt(tintPixels(base, [{ mask: full, colour: [29, 78, 216] }]), 0);
    for (const [index, channel] of [250, 67, 54].entries())
      expect(Math.abs(red[index] - channel)).toBeLessThanOrEqual(14);
    for (const [index, channel] of [51, 97, 222].entries())
      expect(Math.abs(blue[index] - channel)).toBeLessThanOrEqual(14);
    expect(red[0]).toBeGreaterThan(203 + 30);
  });

  // Given white paint over the whole base,
  // when it is tinted,
  // then the base comes back as it was, to within rounding.
  it("leaves the base as it is under white paint", () => {
    const base = flat([200, 120, 40, 255]);
    const out = tintPixels(base, [{ mask: mask(() => 255), colour: [255, 255, 255] }]);
    for (const [index, channel] of pixelAt(out, 0).entries())
      expect(Math.abs(channel - pixelAt(base, 0)[index])).toBeLessThanOrEqual(1);
  });

  // Given two masks over different pixels,
  // when the base is tinted with two colours,
  // then each pixel takes its own mask's colour and the rest is untouched.
  it("tints each colour's own region", () => {
    const base = flat([236, 235, 233, 255]);
    const red: Rgb = [220, 38, 38];
    const yellow: Rgb = [250, 204, 21];
    const out = tintPixels(base, [
      { mask: mask((pixel) => (pixel === 0 ? 255 : 0)), colour: red },
      { mask: mask((pixel) => (pixel === 1 ? 255 : 0)), colour: yellow },
    ]);
    expect(pixelAt(out, 0)[0]).toBeGreaterThan(pixelAt(out, 0)[1] + 100);
    expect(pixelAt(out, 1)[1]).toBeGreaterThan(pixelAt(out, 1)[2] + 100);
    expect(pixelAt(out, 2)).toEqual([236, 235, 233, 255]);
  });

  // Given masks of another size than the base,
  // when it is tinted,
  // then it refuses rather than read past an image.
  it("refuses masks of another size", () => {
    expect(() =>
      tintPixels(flat([1, 2, 3, 255]), [{ mask: new Uint8ClampedArray(8), colour: [0, 0, 0] }]),
    ).toThrow();
  });
});

describe("paintColour", () => {
  // Given black, which would multiply a stand to solid black,
  // when it becomes a paint colour,
  // then its lightness is held at L* 18.
  it("holds black to L* 18", () => {
    const paint = paintColour("#000000");
    expect(lightnessOf(paint)).toBeGreaterThanOrEqual(MIN_PAINT_LIGHTNESS);
    expect(lightnessOf(paint)).toBeLessThan(MIN_PAINT_LIGHTNESS + 1);
    expect(paint[0]).toBe(paint[1]);
    expect(paint[1]).toBe(paint[2]);
  });

  // Given a dark colour with a hue,
  // when it becomes a paint colour,
  // then it is lifted to L* 18 and keeps its hue's lead channel.
  it("lifts a dark colour and keeps its hue", () => {
    const paint = paintColour("#1a0000");
    expect(lightnessOf(paint)).toBeGreaterThanOrEqual(MIN_PAINT_LIGHTNESS);
    expect(paint[0]).toBeGreaterThan(paint[1]);
  });

  // Given colours at or above L* 18,
  // when they become paint colours,
  // then they are unchanged.
  it("leaves lighter colours alone", () => {
    expect(paintColour("#dc2626")).toEqual([220, 38, 38]);
    expect(paintColour("#ffffff")).toEqual([255, 255, 255]);
    expect(paintColour("#facc15")).toEqual([250, 204, 21]);
  });
});

describe("createTintCache", () => {
  const pixels = (): Pixels => ({ width: 4, height: 4, data: flat([255, 255, 255, 255]) });

  function deps(layered = true) {
    let made = 0;
    const fake = {
      artUrls: vi.fn(async (key: string) => ({
        base: `/art/${key}.base.webp`,
        masks: layered
          ? ([`/art/${key}.c1.webp`, `/art/${key}.c2.webp`] as [string, string])
          : ([null, null] as [null, null]),
      })),
      decode: vi.fn(async (url: string): Promise<Pixels> => {
        const image = pixels();
        if (url.includes(".c")) image.data = mask(() => 255);
        return image;
      }),
      encode: vi.fn(async () => {
        made += 1;
        return `blob:tinted-${made}`;
      }),
      revoke: vi.fn(),
    } satisfies TintDeps;
    return fake;
  }

  // Given a key and two colours tinted once,
  // when the same key and colours are asked for again,
  // then the art is not tinted again and the same URL comes back.
  it("does not tint the same key and colours twice", async () => {
    const fake = deps();
    const tinted = createTintCache(fake, 24);
    const first = await tinted("tinh", "#dc2626", "#facc15");
    const second = await tinted("tinh", "#DC2626", "#facc15");
    expect(second).toBe(first);
    expect(fake.encode).toHaveBeenCalledTimes(1);
  });

  // Given a cache of two,
  // when a third pair of colours is tinted,
  // then the oldest is dropped and its object URL revoked.
  it("revokes the URL of an entry it drops", async () => {
    const fake = deps();
    const tinted = createTintCache(fake, 2);
    const oldest = await tinted("tinh", "#000000", "#ffffff");
    await tinted("tinh", "#111111", "#ffffff");
    await tinted("tinh", "#222222", "#ffffff");
    expect(fake.revoke).toHaveBeenCalledTimes(1);
    expect(fake.revoke).toHaveBeenCalledWith(oldest);
  });

  // Given an entry used again,
  // when the cache is full and another is added,
  // then the entry used last is kept and the one used longest ago dropped.
  it("drops the entry used longest ago", async () => {
    const fake = deps();
    const tinted = createTintCache(fake, 2);
    const kept = await tinted("tinh", "#000000", "#ffffff");
    const dropped = await tinted("gian", "#000000", "#ffffff");
    await tinted("tinh", "#000000", "#ffffff");
    await tinted("anh", "#000000", "#ffffff");
    expect(fake.revoke).toHaveBeenCalledWith(dropped);
    expect(fake.revoke).not.toHaveBeenCalledWith(kept);
  });

  // Given art without club colour (the crane),
  // when it is asked for,
  // then its base comes back untouched and is never revoked.
  it("hands back the base of art without colour", async () => {
    const fake = deps(false);
    const tinted = createTintCache(fake, 1);
    expect(await tinted("crane", "#000000", "#ffffff")).toBe("/art/crane.base.webp");
    await tinted("crane", "#111111", "#ffffff");
    expect(fake.encode).not.toHaveBeenCalled();
    expect(fake.revoke).not.toHaveBeenCalled();
  });
  // Given art whose files fail to load once,
  // when it is asked for again,
  // then the failure is not kept: the second call loads and paints it.
  it("tries again after a failure", async () => {
    const fake = deps();
    fake.artUrls.mockRejectedValueOnce(new Error("offline"));
    const tinted = createTintCache(fake, 24);
    await expect(tinted("tinh", "#dc2626", "#facc15")).rejects.toThrow("offline");
    await expect(tinted("tinh", "#dc2626", "#facc15")).resolves.toBe("blob:tinted-1");
  });
});

describe("tintedArt", () => {
  // Given the shipped crane, which carries no club colour,
  // when the screen asks for it in a club's colours,
  // then it gets the crane's own shipped file, with nothing painted.
  it("hands back the shipped base of art without club colour", async () => {
    const url = await tintedArt("crane", "#dc2626", "#facc15");
    expect(url).toMatch(/crane\.base.*\.webp/);
  });

  // Given a key the art does not have,
  // when it is asked for,
  // then it fails instead of showing nothing in silence.
  it("refuses art it does not have", async () => {
    await expect(tintedArt("castle", "#dc2626", "#facc15")).rejects.toThrow();
  });
});

describe("encodeTinted", () => {
  // Given painted pixels, on a webview with OffscreenCanvas,
  // when they are turned into an image,
  // then the image is PNG, lossless: a lossy re-encode (WebP q 0.92) puts the painted stands
  // ΔE76 11–18 off the render (PO, C-27b acceptance), on top of the shipped files' own loss.
  it("encodes the painted art losslessly, as PNG", async () => {
    const asked: unknown[] = [];
    const putImageData = vi.fn();
    class FakeOffscreenCanvas {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
      getContext() {
        return { putImageData };
      }
      convertToBlob(options: unknown) {
        asked.push(options);
        return Promise.resolve(new Blob(["png"], { type: "image/png" }));
      }
    }
    class FakeImageData {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    }
    vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
    vi.stubGlobal("ImageData", FakeImageData);
    const createObjectURL = vi.fn(() => "blob:painted");
    vi.stubGlobal("URL", Object.assign(Object.create(URL), { createObjectURL }));
    try {
      const url = await encodeTinted({ width: 4, height: 4, data: flat([1, 2, 3, 255]) });
      expect(url).toBe("blob:painted");
      expect(asked).toEqual([{ type: "image/png" }]);
      expect(putImageData).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
