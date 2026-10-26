import { afterEach, describe, expect, it, vi } from "vitest";
import { AVATAR_SIDE, shrinkToAvatar } from "./shrinkImage";

/** A canvas that holds `alpha` for every pixel and writes only the kinds in `writes`. */
function stubCanvas(alpha: number, writes: string[]) {
  const asked: string[] = [];
  const context = {
    drawImage: vi.fn(),
    getImageData: () => ({
      data: new Uint8ClampedArray(AVATAR_SIDE * AVATAR_SIDE * 4).fill(alpha),
    }),
    fillRect: vi.fn(),
    globalCompositeOperation: "source-over",
    fillStyle: "",
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation((type = "image/png") => {
    asked.push(type);
    // A browser that cannot write a kind answers with a PNG.
    return writes.includes(type) ? `data:${type};base64,AAAA` : "data:image/png;base64,BBBB";
  });
  vi.stubGlobal("createImageBitmap", async () => ({ width: 400, height: 300, close: vi.fn() }));
  return { asked, context };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const FILE = new File([new Uint8Array([1])], "me.png", { type: "image/png" });

describe("shrinking a picture for an avatar", () => {
  // Given a picture with a transparent background and a browser that writes WebP,
  // when it is shrunk,
  // then it stays WebP, so the background is not turned black.
  it("keeps a transparent background as WebP", async () => {
    const { asked } = stubCanvas(0, ["image/webp"]);

    expect(await shrinkToAvatar(FILE)).toBe("data:image/webp;base64,AAAA");
    expect(asked).toEqual(["image/webp"]);
  });

  // Given a transparent picture and a browser that cannot write WebP,
  // when it is shrunk,
  // then it is a PNG, which keeps transparency too.
  it("falls back to PNG when WebP cannot be written", async () => {
    stubCanvas(0, []);

    expect(await shrinkToAvatar(FILE)).toBe("data:image/png;base64,BBBB");
  });

  // Given an opaque picture,
  // when it is shrunk,
  // then it is a JPEG, the smallest.
  it("sends an opaque picture as a JPEG", async () => {
    const { asked } = stubCanvas(255, ["image/jpeg"]);

    expect(await shrinkToAvatar(FILE)).toBe("data:image/jpeg;base64,AAAA");
    expect(asked).toEqual(["image/jpeg"]);
  });
});
