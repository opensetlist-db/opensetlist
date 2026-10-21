import type { Prisma } from "@/generated/prisma/client";
import { LogoDisplayMode } from "@/generated/prisma/enums";
import { UploadError } from "./errors";
import type { TargetSegment } from "./keys";

// Target adapters: the only three things an admin upload may be assigned
// to, and the compare-and-set writes that every in-scope writer of those
// fields must use (upload, existing-URL edit, mode change, unlink).
//
// Stale-assignment protection is ONE conditional UPDATE: the expected
// value is part of the WHERE clause, so Postgres compares and writes
// atomically (under READ COMMITTED a concurrent writer's row lock makes
// this statement wait and then re-check the WHERE against the committed
// row). "Read in a transaction, then write unconditionally" would let two
// admins both pass the read; it is not used anywhere here.
//
// Zero rows updated is then disambiguated by one read: no live row →
// 404, otherwise 409 with the current value so the form can refresh.
// Value comparison is not history detection (A→B→A passes) — accepted by
// the spec; no revision column was added.
//
// Soft-deleted Event / EventSeries rows count as absent. Album has no
// soft delete.

/** Local logo assignment of an Event or EventSeries row. */
export type LogoAssignment = {
  mode: LogoDisplayMode;
  assetId: string | null;
};

/** Album.imageUrl — the album's only current cover source. */
export type AlbumCoverAssignment = { imageUrl: string | null };

export type AssetRef = { id: string; publicUrl: string };

type Tx = Prisma.TransactionClient;

export interface TargetAdapter<E> {
  readonly segment: TargetSegment;
  readonly id: bigint;
  /** Current assignment, or null when the target is absent/deleted. */
  read(tx: Tx): Promise<E | null>;
  /** CAS: assign `asset` only if the row still holds `expected`. */
  assignAsset(tx: Tx, expected: E, asset: AssetRef): Promise<boolean>;
  /** Whether `current` is exactly this asset's assignment. */
  holdsAsset(current: E, asset: AssetRef): boolean;
  /** JSON-safe current value for a 409 body. */
  describe(current: E): Record<string, unknown>;
}

// ── Logo targets (Event / EventSeries) ───────────────────────────────

export type LogoNext =
  | { mode: "inherit" }
  | { mode: "typography" }
  | { mode: "custom"; assetId: string };

type LogoDelegate = {
  findFirst(args: {
    where: { id: bigint; isDeleted: false };
    select: { logoMode: true; logoAssetId: true };
  }): Promise<{ logoMode: LogoDisplayMode; logoAssetId: string | null } | null>;
  updateMany(args: {
    where: { id: bigint; isDeleted: false; logoMode: LogoDisplayMode; logoAssetId: string | null };
    data: { logoMode: LogoDisplayMode; logoAssetId: string | null };
  }): Promise<{ count: number }>;
};

function logoDelegate(tx: Tx, segment: "event-logo" | "series-logo"): LogoDelegate {
  // Both models have the same logo fields; the cast only unifies the two
  // generated delegate types for this narrow use.
  return (segment === "event-logo" ? tx.event : tx.eventSeries) as unknown as LogoDelegate;
}

/**
 * Compare-and-set of a logo assignment. Writes the DB's pairing rule
 * (custom ⇔ asset, CHECK in post-deploy.sql) in the same statement:
 * inherit/typography always clear the asset.
 */
export async function writeLogoAssignment(
  tx: Tx,
  segment: "event-logo" | "series-logo",
  id: bigint,
  expected: LogoAssignment,
  next: LogoNext,
): Promise<boolean> {
  const { count } = await logoDelegate(tx, segment).updateMany({
    where: { id, isDeleted: false, logoMode: expected.mode, logoAssetId: expected.assetId },
    data:
      next.mode === "custom"
        ? { logoMode: LogoDisplayMode.custom, logoAssetId: next.assetId }
        : { logoMode: next.mode, logoAssetId: null },
  });
  return count === 1;
}

export async function readLogoAssignment(
  tx: Tx,
  segment: "event-logo" | "series-logo",
  id: bigint,
): Promise<LogoAssignment | null> {
  const row = await logoDelegate(tx, segment).findFirst({
    where: { id, isDeleted: false },
    select: { logoMode: true, logoAssetId: true },
  });
  return row ? { mode: row.logoMode, assetId: row.logoAssetId } : null;
}

function logoTarget(segment: "event-logo" | "series-logo", id: bigint): TargetAdapter<LogoAssignment> {
  return {
    segment,
    id,
    read: (tx) => readLogoAssignment(tx, segment, id),
    assignAsset: (tx, expected, asset) =>
      writeLogoAssignment(tx, segment, id, expected, { mode: "custom", assetId: asset.id }),
    holdsAsset: (current, asset) => current.mode === "custom" && current.assetId === asset.id,
    describe: (current) => ({ logoMode: current.mode, logoAssetId: current.assetId }),
  };
}

export const eventLogoTarget = (eventId: bigint) => logoTarget("event-logo", eventId);
export const seriesLogoTarget = (seriesId: bigint) => logoTarget("series-logo", seriesId);

// ── Album cover target ───────────────────────────────────────────────

/**
 * Compare-and-set of Album.imageUrl (upload → managed URL, external URL
 * edit → that URL, unlink → null). Never falls back to an older URL.
 */
export async function writeAlbumImageUrl(
  tx: Tx,
  albumId: bigint,
  expected: AlbumCoverAssignment,
  nextImageUrl: string | null,
): Promise<boolean> {
  const { count } = await tx.album.updateMany({
    where: { id: albumId, imageUrl: expected.imageUrl },
    data: { imageUrl: nextImageUrl },
  });
  return count === 1;
}

export async function readAlbumImageUrl(tx: Tx, albumId: bigint): Promise<AlbumCoverAssignment | null> {
  const row = await tx.album.findUnique({ where: { id: albumId }, select: { imageUrl: true } });
  return row ? { imageUrl: row.imageUrl } : null;
}

export function albumCoverTarget(albumId: bigint): TargetAdapter<AlbumCoverAssignment> {
  return {
    segment: "album-cover",
    id: albumId,
    read: (tx) => readAlbumImageUrl(tx, albumId),
    assignAsset: (tx, expected, asset) => writeAlbumImageUrl(tx, albumId, expected, asset.publicUrl),
    holdsAsset: (current, asset) => current.imageUrl === asset.publicUrl,
    describe: (current) => ({ imageUrl: current.imageUrl }),
  };
}

// ── Conflict helper for consumers' non-upload writers ─────────────────

/**
 * After a CAS returned false: 404 when the target is gone, otherwise 409
 * carrying the current value. For the upload path the service does this
 * itself; 09/10/11 call it from their mode-change / URL-edit / unlink
 * handlers.
 */
export async function conflictFor<E>(tx: Tx, target: TargetAdapter<E>): Promise<UploadError> {
  const current = await target.read(tx);
  if (!current) {
    return new UploadError("target_not_found", "대상을 찾을 수 없습니다. 삭제되었을 수 있습니다.");
  }
  return new UploadError(
    "assignment_conflict",
    "다른 곳에서 이미지 설정이 먼저 바뀌었습니다. 새로고침해 현재 상태를 확인한 뒤 다시 시도해 주세요.",
    { detail: { current: target.describe(current) } },
  );
}

// ── Parsing the expected value a form submits ─────────────────────────

const LOGO_MODES = new Set<string>(Object.values(LogoDisplayMode));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Expected logo assignment as the form loaded it. `assetId` must be
 * present as a field; an empty string means "no asset".
 */
export function parseExpectedLogo(mode: unknown, assetId: unknown): LogoAssignment {
  if (typeof mode !== "string" || !LOGO_MODES.has(mode) || typeof assetId !== "string") {
    throw new UploadError("invalid_request", "현재 로고 상태 값이 없습니다. 페이지를 새로고침해 주세요.");
  }
  const id = assetId.trim().toLowerCase();
  if (id !== "" && !UUID_RE.test(id)) {
    throw new UploadError("invalid_request", "현재 로고 asset ID가 올바르지 않습니다.");
  }
  return { mode: mode as LogoDisplayMode, assetId: id === "" ? null : id };
}

/**
 * Expected album cover as the form loaded it. The field must be present;
 * an empty string means "no cover". Compared verbatim — no trimming, the
 * stored value is what the form was given.
 */
export function parseExpectedAlbumCover(imageUrl: unknown): AlbumCoverAssignment {
  if (typeof imageUrl !== "string") {
    throw new UploadError("invalid_request", "현재 표지 값이 없습니다. 페이지를 새로고침해 주세요.");
  }
  return { imageUrl: imageUrl === "" ? null : imageUrl };
}
