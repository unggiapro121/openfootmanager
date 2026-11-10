/**
 * The light the facilities art was rendered with, so club colour can be painted where the
 * renderer would have put it (C-27b). The art comes from three.js r147 with
 * `ACESFilmicToneMapping`, exposure 1 and sRGB output (`3d-src/render.html`): a pixel is
 * `sRGB(ACES(albedo × light))`. A paint multiplies the albedo, so it multiplies the light before
 * the tone curve, not the pixel after it; done on the pixel, a red stand comes out ΔE ≈ 17 off
 * the straight render instead of ≈ 4.
 */

type Rgb = [number, number, number];
type Matrix = [Rgb, Rgb, Rgb];

/** three.js r147 `ACESFilmicToneMapping`'s input matrix (sRGB → ACES AP1, with the RRT's sat). */
const ACES_IN: Matrix = [
  [0.59719, 0.35458, 0.04823],
  [0.076, 0.90834, 0.01566],
  [0.0284, 0.13383, 0.83777],
];
/** …and its output matrix (back to linear sRGB). */
const ACES_OUT: Matrix = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602],
];
/** `color *= toneMappingExposure / 0.6` in three.js, exposure 1. */
const EXPOSURE = 1 / 0.6;

function apply(matrix: Matrix, [r, g, b]: Rgb): Rgb {
  return [
    matrix[0][0] * r + matrix[0][1] * g + matrix[0][2] * b,
    matrix[1][0] * r + matrix[1][1] * g + matrix[1][2] * b,
    matrix[2][0] * r + matrix[2][1] * g + matrix[2][2] * b,
  ];
}

function inverse(matrix: Matrix): Matrix {
  const [[a, b, c], [d, e, f], [g, h, i]] = matrix;
  const cofactor = [e * i - f * h, -(d * i - f * g), d * h - e * g];
  const det = a * cofactor[0] + b * cofactor[1] + c * cofactor[2];
  return [
    [cofactor[0] / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [cofactor[1] / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [cofactor[2] / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

const ACES_IN_INVERSE = inverse(ACES_IN);
const ACES_OUT_INVERSE = inverse(ACES_OUT);

/** The RRT + ODT fit of three.js (Stephen Hill's). */
function fit(value: number): number {
  return (
    (value * (value + 0.0245786) - 0.000090537) / (value * (0.983729 * value + 0.432951) + 0.238081)
  );
}

/** `fit`'s inverse on its rising branch; the fit tends to 1 / 0.983729, so higher is held under it. */
function unfit(fitted: number): number {
  const y = Math.min(fitted, 1.0165);
  const a = 0.983729 * y - 1;
  const b = 0.432951 * y - 0.0245786;
  const c = 0.238081 * y + 0.000090537;
  return Math.max(0, (-b - Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a));
}

/** sRGB 0–255 → linear light, by table: every art pixel goes through it. */
const LINEAR = Array.from({ length: 256 }, (_, channel) => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
});

export function linearOf(channel: number): number {
  return LINEAR[Math.max(0, Math.min(255, Math.round(channel)))];
}

function channelOf(linear: number): number {
  const value = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, value * 255));
}

/** The light (before the tone curve) that the renderer turned into this 0–255 sRGB pixel. */
export function sceneOf(red: number, green: number, blue: number): Rgb {
  const toned = apply(ACES_OUT_INVERSE, [linearOf(red), linearOf(green), linearOf(blue)]);
  const scene = apply(ACES_IN_INVERSE, [unfit(toned[0]), unfit(toned[1]), unfit(toned[2])]);
  return [
    Math.max(0, scene[0] / EXPOSURE),
    Math.max(0, scene[1] / EXPOSURE),
    Math.max(0, scene[2] / EXPOSURE),
  ];
}

/** The 0–255 sRGB pixel the renderer makes of this light (unrounded). */
export function pixelOf(scene: Rgb): Rgb {
  const fitted = apply(ACES_IN, [scene[0] * EXPOSURE, scene[1] * EXPOSURE, scene[2] * EXPOSURE]);
  const toned = apply(ACES_OUT, [fit(fitted[0]), fit(fitted[1]), fit(fitted[2])]);
  return [
    channelOf(Math.min(1, Math.max(0, toned[0]))),
    channelOf(Math.min(1, Math.max(0, toned[1]))),
    channelOf(Math.min(1, Math.max(0, toned[2]))),
  ];
}
