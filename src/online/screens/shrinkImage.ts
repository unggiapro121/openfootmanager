/** The side, in pixels, of the square picture a coach's own image is shrunk to. */
export const AVATAR_SIDE = 256;

/**
 * `file` as a square JPEG data URL of `AVATAR_SIDE` pixels: cropped from the middle and shrunk, so
 * what the server keeps is small whatever the camera made. Rejects when the file is no picture.
 */
export async function shrinkToAvatar(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIDE;
    canvas.height = AVATAR_SIDE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_SIDE,
      AVATAR_SIDE,
    );
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bitmap.close();
  }
}
