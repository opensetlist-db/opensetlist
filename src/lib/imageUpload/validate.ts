import { createHash } from "node:crypto";
import sharp from "sharp";
import { UploadError } from "./errors";
import {
  ACCEPTED_IMAGE_FORMATS,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_SIDE,
  MIN_IMAGE_SIDE,
  type AcceptedImageFormat,
  type AcceptedMimeType,
} from "./limits";

// Server-side decode and validation of an uploaded logo / cover.
//
// Nothing the client says about the file is trusted: not its name, not
// its `type`, not the size or dimensions a form might have measured for
// the preview. The bytes are sniffed, decoded in full by libvips (sharp,
// already a dependency for next/image), and measured here.
//
// The ORIGINAL bytes are what gets stored — never a re-encode. A logo's
// transparency, colour profile and exact aspect ratio therefore survive
// untouched; decoding is only the proof that the bytes are a single,
// complete, bounded raster image of an accepted type. (Re-encoding would
// also silently change quality and could strip alpha from a JPEG-saved
// "transparent" logo the operator expected to look the same.)

export type ValidatedImage = {
  bytes: Uint8Array;
  format: AcceptedImageFormat;
  mimeType: AcceptedMimeType;
  ext: string;
  byteSize: number;
  /** Display dimensions (EXIF orientation applied). */
  width: number;
  height: number;
  hasAlpha: boolean;
  /** Lower-case hex SHA-256 of `bytes`; pins an attempt to its content. */
  sha256: string;
};

/** Magic-byte sniff. Returns null for anything that is not PNG/JPEG/WebP. */
export function sniffImageFormat(bytes: Uint8Array): AcceptedImageFormat | null {
  const b = bytes;
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "jpeg";
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return "webp";
  }
  return null;
}

const UNSUPPORTED_MESSAGE =
  "PNG, JPEG, WebP 이미지만 올릴 수 있습니다. SVG·GIF·HEIC 등은 PNG나 WebP로 변환해 주세요.";

export async function validateImage(input: Uint8Array): Promise<ValidatedImage> {
  if (input.byteLength === 0) {
    throw new UploadError("invalid_image", "빈 파일입니다.");
  }
  if (input.byteLength > MAX_IMAGE_BYTES) {
    throw new UploadError(
      "image_too_large",
      `이미지는 ${MAX_IMAGE_BYTES / (1024 * 1024)}MB 이하여야 합니다.`,
      { detail: { maxBytes: MAX_IMAGE_BYTES, byteSize: input.byteLength } },
    );
  }

  const sniffed = sniffImageFormat(input);
  if (!sniffed) {
    throw new UploadError("unsupported_image_type", UNSUPPORTED_MESSAGE);
  }

  // `limitInputPixels` makes libvips refuse to allocate past the budget
  // before decoding (decompression-bomb guard). failOn "error" rejects
  // corrupt and truncated data rather than decoding what it can.
  const options = { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" as const };
  const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);

  let meta: sharp.Metadata;
  try {
    // `animated: true` makes `pages` report every frame of an animated
    // WebP, so it can be rejected instead of silently keeping frame 1.
    meta = await sharp(buffer, { ...options, animated: true }).metadata();
  } catch (cause) {
    throw decodeFailure(cause);
  }

  // The container must agree with the magic bytes (a PNG header glued
  // onto other data, or a format libvips would route elsewhere).
  if (meta.format !== sniffed) {
    throw new UploadError("unsupported_image_type", UNSUPPORTED_MESSAGE);
  }
  if ((meta.pages ?? 1) > 1) {
    throw new UploadError(
      "unsupported_image_type",
      "움직이는 이미지는 올릴 수 없습니다. 정지 이미지로 저장해 주세요.",
    );
  }

  const rawWidth = meta.width ?? 0;
  const rawHeight = meta.height ?? 0;
  // EXIF orientations 5–8 rotate by 90°: what the browser shows is the
  // transposed size, and that is what layout reservation needs.
  const swap = (meta.orientation ?? 1) >= 5;
  const width = swap ? rawHeight : rawWidth;
  const height = swap ? rawWidth : rawHeight;

  if (
    width < MIN_IMAGE_SIDE ||
    height < MIN_IMAGE_SIDE ||
    width > MAX_IMAGE_SIDE ||
    height > MAX_IMAGE_SIDE ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new UploadError(
      "image_dimensions",
      `이미지 크기는 가로·세로 ${MIN_IMAGE_SIDE}~${MAX_IMAGE_SIDE}px, 전체 ${MAX_IMAGE_PIXELS.toLocaleString("en-US")}픽셀 이하여야 합니다.`,
      { detail: { width, height } },
    );
  }

  // Full decode: metadata() reads only the header, so a file truncated
  // after it would otherwise pass. stats() walks every pixel.
  try {
    await sharp(buffer, options).stats();
  } catch (cause) {
    throw decodeFailure(cause);
  }

  const { mimeType, ext } = ACCEPTED_IMAGE_FORMATS[sniffed];
  return {
    bytes: input,
    format: sniffed,
    mimeType,
    ext,
    byteSize: input.byteLength,
    width,
    height,
    hasAlpha: meta.hasAlpha ?? false,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

function decodeFailure(cause: unknown): UploadError {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/pixel limit/i.test(message)) {
    return new UploadError(
      "image_dimensions",
      `이미지 픽셀 수가 너무 많습니다(최대 ${MAX_IMAGE_PIXELS.toLocaleString("en-US")}픽셀).`,
      { cause },
    );
  }
  return new UploadError(
    "invalid_image",
    "이미지를 읽을 수 없습니다. 파일이 손상되었거나 잘렸을 수 있습니다.",
    { cause },
  );
}
