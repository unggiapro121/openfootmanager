/** The side, in pixels, of the square picture a coach's own image is shrunk to. */
export const AVATAR_SIDE = 256;

/** What a picture with a transparent background is painted on when it has to become a JPEG. */
const BACKDROP = "#1c2541";
/** A picture longer than this as a data URL is too big for the server's 256 KiB (with base64). */
const MOST_DATA_URL = 330_000;

/** Whether any pixel of the canvas is not fully opaque. */
function hasTransparency(context: CanvasRenderingContext2D): boolean {
  const { data } = context.getImageData(0, 0, AVATAR_SIDE, AVATAR_SIDE);
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 255) return true;
  }
  return false;
}

/**
 * `file` as a square data URL of `AVATAR_SIDE` pixels: cropped from the middle and shrunk, so what
 * the server keeps is small whatever the camera made. A picture with a transparent background (a
 * cut-out) keeps it, as WebP or else PNG, because a JPEG has no transparency and would turn it
 * black; one too big that way is painted on a backdrop and sent as a JPEG. Rejects when the file
 * is no picture.
 */
export async function shrinkToAvatar(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIDE;
    canvas.height = AVATAR_SIDE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("no canvas");
    const side = Math.min(bitmap.width, bitmap.height);
    const crop = [(bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side] as const;
    context.drawImage(bitmap, ...crop, 0, 0, AVATAR_SIDE, AVATAR_SIDE);

    if (hasTransparency(context)) {
      for (const [type, quality] of [
        ["image/webp", 0.85],
        ["image/png", undefined],
      ] as const) {
        const url = canvas.toDataURL(type, quality);
        // A browser that cannot write WebP answers with a PNG: take what it really made.
        if (url.startsWith(`data:${type}`) && url.length <= MOST_DATA_URL) return url;
      }
      context.globalCompositeOperation = "destination-over";
      context.fillStyle = BACKDROP;
      context.fillRect(0, 0, AVATAR_SIDE, AVATAR_SIDE);
    }
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bitmap.close();
  }
}
