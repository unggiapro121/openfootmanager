import { describe, expect, it } from "vitest";
import { pixelOf, sceneOf } from "./toneCurve";

describe("the render's tone curve", () => {
  // Given every grey,
  // when it is taken back to its light and toned again,
  // then it comes back to within half a step.
  it("takes a grey back to its light and toned again unchanged", () => {
    for (let grey = 0; grey <= 255; grey += 1) {
      for (const channel of pixelOf(sceneOf(grey, grey, grey))) {
        expect(Math.abs(channel - grey), `${grey}`).toBeLessThanOrEqual(0.5);
      }
    }
  });

  // Given a spread of colours the renderer can make (light 0–1 per channel, toned and rounded),
  // when such a pixel is taken back to its light and toned again,
  // then it comes back to within 3 steps: a channel the curve clipped at black cannot be undone.
  it("takes a rendered colour back to its light and toned again nearly unchanged", () => {
    const levels = [0, 0.01, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1];
    for (const red of levels)
      for (const green of levels)
        for (const blue of levels) {
          const sample = pixelOf([red, green, blue]).map(Math.round);
          const again = pixelOf(sceneOf(sample[0], sample[1], sample[2]));
          for (const [index, channel] of again.entries())
            expect(Math.abs(channel - sample[index]), `${sample}`).toBeLessThanOrEqual(3);
        }
  });

  // Given three.js r147's ACES filmic curve at exposure 1,
  // when light 0.18 (middle grey) and 1 are toned,
  // then they land where three.js puts them (sRGB ≈ 127 and ≈ 226 by its shader formula).
  it("tones light as three.js r147 does", () => {
    const grey = pixelOf([0.18, 0.18, 0.18]);
    const white = pixelOf([1, 1, 1]);
    expect(grey[0]).toBeCloseTo(grey[1], 3);
    expect(Math.round(grey[0])).toBe(127);
    expect(Math.round(white[0])).toBe(226);
  });

  // Given more light than the curve can show,
  // when it is toned,
  // then it is white, never past 255.
  it("holds bright light at white", () => {
    expect(pixelOf([50, 50, 50]).map(Math.round)).toEqual([255, 255, 255]);
  });
});
