// Numeric limits and the transport choice for admin image uploads
// (event/series logos, album covers). Fixed here, before any consumer
// form exists, so the three admin screens share one contract.
//
// Transport: the browser sends the file to our own admin route handler as
// one multipart request; the server decodes and validates the bytes, then
// writes them to R2 with credentials that never leave the server. There is
// no presigned direct-to-bucket upload, hence no outstanding upload grant
// that could later overwrite validated bytes, no bucket CORS rule and no
// private staging prefix to clean up. The price is the hosting body limit:
// a Vercel Function rejects a request body above 4.5 MB (vendor docs, not
// verifiable locally, not in the bundled Next.js docs), so the file cap
// below plus the multipart framing and the small text fields must stay
// under it. Logos and album covers fit comfortably; if a future image type
// needs more, switch to a private staging upload instead of raising these.
//
// Server Actions are not used: their default body cap is 1 MB
// (`serverActions.bodySizeLimit`), and a route handler keeps the existing
// `verifyAdminAPI()`-first convention of `/api/admin/**`.

/** Largest accepted image file, in bytes (4 MiB). */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * Largest accepted request body (file + multipart framing + text fields).
 * Checked against Content-Length before the body is read, and again on
 * the parsed file. Below Vercel's 4.5 MB function payload limit.
 */
export const MAX_UPLOAD_REQUEST_BYTES = 4_400_000;

/** Longest side, in pixels, after EXIF orientation. */
export const MAX_IMAGE_SIDE = 8192;

/**
 * Pixel budget handed to the decoder (sharp `limitInputPixels`) so a
 * small, highly compressed file cannot expand into gigabytes of RAM
 * (a "decompression bomb"). 8192 × 4096.
 */
export const MAX_IMAGE_PIXELS = 33_554_432;

/** Shortest side, in pixels. Anything smaller is not a usable logo/cover. */
export const MIN_IMAGE_SIDE = 16;

/** Admin-only provenance fields stored on ImageAsset. */
export const MAX_SOURCE_URL_LENGTH = 2048;
export const MAX_USAGE_NOTE_LENGTH = 2000;

/** Accepted decoded formats → MIME type and the key's file extension. */
export const ACCEPTED_IMAGE_FORMATS = {
  png: { mimeType: "image/png", ext: "png" },
  jpeg: { mimeType: "image/jpeg", ext: "jpg" },
  webp: { mimeType: "image/webp", ext: "webp" },
} as const;

export type AcceptedImageFormat = keyof typeof ACCEPTED_IMAGE_FORMATS;
export type AcceptedMimeType =
  (typeof ACCEPTED_IMAGE_FORMATS)[AcceptedImageFormat]["mimeType"];

/** `accept` attribute value for the admin file inputs. */
export const IMAGE_INPUT_ACCEPT = "image/png,image/jpeg,image/webp";

/**
 * Client-side bound on automatic resubmissions of the same attempt after
 * an outcome the client could not observe (network failure, 5xx with an
 * unknown outcome). Every resubmission carries the same attempt id and the
 * same expected assignment, so it can only confirm the first commit or
 * report a conflict — never overwrite a newer assignment.
 */
export const MAX_UPLOAD_RESUBMISSIONS = 2;
