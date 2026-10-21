import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ACCEPTED_IMAGE_FORMATS,
  UploadError,
  buildObjectKey,
  readR2Config,
} from "@/lib/imageUpload";
import { MAX_SOURCE_URL_LENGTH } from "@/lib/imageUpload/limits";

// Server side of the admin album-cover editor.
//
// Album.imageUrl is the album's ONLY current cover source. An upload sets
// it to the managed R2 URL, an external-URL save replaces it, unlink sets
// it to null. There is no hidden previous-cover field and no fallback, so
// an old URL can never come back on its own. Provenance of an uploaded
// cover is found by EXACT equality with ImageAsset.publicUrl (unique) —
// never by host or prefix, so an external URL never inherits metadata.

/** Admin-only provenance of the current cover (exact publicUrl match). */
export type CoverProvenance = {
  sourceUrl: string | null;
  usageNote: string | null;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  createdAt: string;
};

/**
 * What a re-read found out about one upload attempt:
 *   committed — its ImageAsset row exists (asset and assignment commit
 *               together, so the row proves the commit);
 *   absent    — no row at read time. NOT proof of failure: a request
 *               still in flight may commit later;
 *   ambiguous — more than one row for the attempt (should not happen;
 *               the form keeps the outcome unknown);
 *   unavailable — the storage namespace is not configured here, so the
 *               attempt's key cannot be rebuilt.
 */
export type AttemptState =
  | { state: "committed"; publicUrl: string }
  | { state: "absent" }
  | { state: "ambiguous" }
  | { state: "unavailable" };

export type CoverState = {
  imageUrl: string | null;
  provenance: CoverProvenance | null;
  attempt?: AttemptState;
};

const PROVENANCE_SELECT = {
  sourceUrl: true,
  usageNote: true,
  mimeType: true,
  width: true,
  height: true,
  byteSize: true,
  createdAt: true,
} as const;

/** Next cover URL from a request: trimmed, "" → null, http(s) only. */
export function parseCoverUrl(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new UploadError(
      "invalid_request",
      "표지 URL 형식이 올바르지 않습니다.",
    );
  }
  const url = value.trim();
  if (url === "") return null;
  if (url.length > MAX_SOURCE_URL_LENGTH) {
    throw new UploadError(
      "invalid_request",
      `표지 URL은 ${MAX_SOURCE_URL_LENGTH}자 이하여야 합니다.`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UploadError(
      "invalid_request",
      "표지 URL이 올바른 주소가 아닙니다.",
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new UploadError(
      "invalid_request",
      "표지 URL은 http(s) 주소여야 합니다.",
    );
  }
  return url;
}

/**
 * Expected cover in a JSON body. The field must be present (a form that
 * does not know the current value must not write blindly); `null` or ""
 * means "no cover". Compared verbatim — never trimmed.
 */
export function parseExpectedCoverJson(body: Record<string, unknown>): {
  imageUrl: string | null;
} {
  if (!("expectedImageUrl" in body)) {
    throw new UploadError(
      "invalid_request",
      "현재 표지 값이 함께 전송되지 않았습니다. 페이지를 새로고침한 뒤 다시 저장해 주세요.",
    );
  }
  const v = body.expectedImageUrl;
  if (v === null || v === "") return { imageUrl: null };
  if (typeof v !== "string") {
    throw new UploadError(
      "invalid_request",
      "현재 표지 값 형식이 올바르지 않습니다.",
    );
  }
  return { imageUrl: v };
}

/**
 * Host of the managed-upload public URL, for the admin source badge.
 * R2_PUBLIC_BASE_URL is what uploads build their URLs from; the older
 * server-only R2_PUBLIC_HOST stays as a fallback. (The client-side
 * NEXT_PUBLIC_R2_PUBLIC_HOST fallback lives in classifyImageSource,
 * which falls back to it when this returns null.)
 */
export function r2PublicHost(
  env: Record<string, string | undefined> = process.env,
): string | null {
  for (const raw of [env.R2_PUBLIC_BASE_URL, env.R2_PUBLIC_HOST]) {
    const value = raw?.trim();
    if (!value) continue;
    try {
      return new URL(value).host.toLowerCase();
    } catch {
      return value.replace(/\/+$/, "").toLowerCase();
    }
  }
  return null;
}

/** Whether uploads can work here at all (for the editor's upload tab). */
export function isUploadStorageConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  try {
    return readR2Config(env) !== null;
  } catch {
    return false;
  }
}

function attemptKeys(albumId: bigint, attemptId: string): string[] | null {
  let prefix: string;
  try {
    const cfg = readR2Config();
    if (!cfg) return null;
    prefix = cfg.keyPrefix;
  } catch {
    return null;
  }
  // The decoded format decides the extension, so the committed key is one
  // of exactly these. An exact `in` lookup, never a substring match.
  return Object.values(ACCEPTED_IMAGE_FORMATS).map((f) =>
    buildObjectKey({
      prefix,
      segment: "album-cover",
      targetId: albumId,
      attemptId,
      ext: f.ext,
    }),
  );
}

function toProvenance(
  row: Prisma.ImageAssetGetPayload<{ select: typeof PROVENANCE_SELECT }>,
): CoverProvenance {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/**
 * Current cover (+ provenance, + the attempt's state when asked) read in
 * ONE repeatable-read snapshot, so an upload committing between two
 * separate reads cannot produce a false "absent but changed" verdict.
 * Returns null when the album does not exist.
 */
export async function readCoverState(
  albumId: bigint,
  attemptId?: string,
): Promise<CoverState | null> {
  const keys = attemptId ? attemptKeys(albumId, attemptId) : null;
  return prisma.$transaction(
    async (tx) => {
      const album = await tx.album.findUnique({
        where: { id: albumId },
        select: { imageUrl: true },
      });
      if (!album) return null;
      const asset = album.imageUrl
        ? await tx.imageAsset.findUnique({
            where: { publicUrl: album.imageUrl },
            select: PROVENANCE_SELECT,
          })
        : null;
      const state: CoverState = {
        imageUrl: album.imageUrl,
        provenance: asset ? toProvenance(asset) : null,
      };
      if (attemptId) {
        if (!keys) {
          state.attempt = { state: "unavailable" };
        } else {
          const rows = await tx.imageAsset.findMany({
            where: { objectKey: { in: keys } },
            select: { publicUrl: true },
          });
          state.attempt =
            rows.length === 0
              ? { state: "absent" }
              : rows.length === 1
                ? { state: "committed", publicUrl: rows[0].publicUrl }
                : { state: "ambiguous" };
        }
      }
      return state;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
