// @vitest-environment node
//
// Server-side image validation of the shared admin upload (ticket 08):
// real libvips decodes of generated images — no mocks, so a sharp upgrade
// that changes metadata/format reporting shows up here.
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { validateImage, sniffImageFormat } from "@/lib/imageUpload/validate";
import { UploadError } from "@/lib/imageUpload/errors";
import { MAX_IMAGE_BYTES } from "@/lib/imageUpload/limits";

const u8 = (b: Buffer) => new Uint8Array(b);

function solid(width: number, height: number, alpha = false) {
  return sharp({
    create: {
      width,
      height,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: 200, g: 30, b: 90, alpha: 0.4 } : { r: 200, g: 30, b: 90 },
    },
  });
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(UploadError);
    return (e as UploadError).code;
  }
  return "resolved";
}

describe("validateImage — accepted formats", () => {
  it("accepts a transparent PNG and keeps the original bytes", async () => {
    const png = await solid(640, 160, true).png().toBuffer();
    const v = await validateImage(u8(png));
    expect(v).toMatchObject({
      format: "png",
      mimeType: "image/png",
      ext: "png",
      width: 640,
      height: 160,
      hasAlpha: true,
      byteSize: png.byteLength,
    });
    // Stored bytes are the upload itself: no re-encode, alpha untouched.
    expect(Buffer.from(v.bytes).equals(png)).toBe(true);
    expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts JPEG and WebP with their decoded MIME, not a claimed one", async () => {
    const jpg = await validateImage(u8(await solid(300, 300).jpeg().toBuffer()));
    expect(jpg).toMatchObject({ format: "jpeg", mimeType: "image/jpeg", ext: "jpg", hasAlpha: false });
    const webp = await validateImage(u8(await solid(300, 120, true).webp().toBuffer()));
    expect(webp).toMatchObject({ format: "webp", mimeType: "image/webp", ext: "webp", width: 300, height: 120 });
  });

  it("reports display dimensions after EXIF orientation (90° rotation swaps them)", async () => {
    const rotated = await solid(400, 100).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const v = await validateImage(u8(rotated));
    expect([v.width, v.height]).toEqual([100, 400]);
  });
});

describe("validateImage — rejections", () => {
  it("rejects SVG, GIF and arbitrary bytes as unsupported", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    expect(await codeOf(validateImage(u8(svg)))).toBe("unsupported_image_type");
    const gif = await solid(32, 32).gif().toBuffer();
    expect(await codeOf(validateImage(u8(gif)))).toBe("unsupported_image_type");
    expect(await codeOf(validateImage(u8(Buffer.from("hello world, not an image"))))).toBe(
      "unsupported_image_type",
    );
  });

  it("rejects an empty file", async () => {
    expect(await codeOf(validateImage(new Uint8Array(0)))).toBe("invalid_image");
  });

  it("rejects a file over the byte cap before decoding", async () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await codeOf(validateImage(big))).toBe("image_too_large");
  });

  it("rejects a truncated image whose header is intact", async () => {
    const png = await solid(512, 512, true).png({ compressionLevel: 0 }).toBuffer();
    const cut = png.subarray(0, Math.floor(png.length / 2));
    expect(await codeOf(validateImage(u8(cut)))).toBe("invalid_image");
  });

  it("rejects magic bytes that disagree with the container", async () => {
    const jpg = await solid(64, 64).jpeg().toBuffer();
    const forged = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), jpg]);
    const code = await codeOf(validateImage(u8(forged)));
    expect(["unsupported_image_type", "invalid_image"]).toContain(code);
  });

  it("rejects too-small and too-large dimensions", async () => {
    expect(await codeOf(validateImage(u8(await solid(8, 200).png().toBuffer())))).toBe("image_dimensions");
    expect(await codeOf(validateImage(u8(await solid(9000, 20).png().toBuffer())))).toBe("image_dimensions");
  });

  it("refuses a decompression bomb by pixel budget, not by file size", async () => {
    // 8192 × 8192 single-colour PNG: tiny file, 67 MP decoded.
    const bomb = await solid(8192, 8192).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.byteLength).toBeLessThan(MAX_IMAGE_BYTES);
    expect(await codeOf(validateImage(u8(bomb)))).toBe("image_dimensions");
  });

  it("rejects an animated WebP instead of keeping its first frame", async () => {
    const frame = (background: string) =>
      sharp({ create: { width: 32, height: 32, channels: 3, background } }).png().toBuffer();
    const twoFrames = await sharp([await frame("#123456"), await frame("#654321")], {
      join: { animated: true },
    })
      .webp({ loop: 0 })
      .toBuffer();
    const meta = await sharp(twoFrames, { animated: true }).metadata();
    expect(meta.pages).toBe(2);
    expect(await codeOf(validateImage(u8(twoFrames)))).toBe("unsupported_image_type");
  });
});

describe("sniffImageFormat", () => {
  it("recognises only PNG/JPEG/WebP signatures", () => {
    expect(sniffImageFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(sniffImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffImageFormat(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(sniffImageFormat(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(sniffImageFormat(new TextEncoder().encode("<svg"))).toBeNull();
  });
});
