import { Prisma } from "@/generated/prisma/client";
import { prisma as defaultDb } from "@/lib/prisma";
import { UploadError, isUploadError } from "./errors";
import { buildObjectKey } from "./keys";
import { MAX_SOURCE_URL_LENGTH, MAX_USAGE_NOTE_LENGTH } from "./limits";
import type { ImageStorage } from "./storage";
import { conflictFor, type AssetRef, type TargetAdapter } from "./targets";
import { validateImage } from "./validate";

// The shared admin image upload: validate → store → finalize.
//
//   1. Decode/validate the bytes (validate.ts). Nothing is stored for an
//      invalid file.
//   2. Derive the immutable key from the validated target + attempt id.
//      If an ImageAsset with that key already exists, this attempt was
//      committed before (asset row and assignment commit together, so the
//      row exists only after a commit) — reconcile, never write twice.
//   3. Write-once PUT to storage. Failure → `storage_failed`, nothing in
//      the DB changed.
//   4. ONE transaction: insert the ImageAsset row and compare-and-set the
//      target. A mismatch rolls the insert back too (409).
//
// Outcome of a DB failure in step 4 depends on WHEN it happened. Prisma's
// interactive transaction sends COMMIT only after the callback resolves,
// so an error raised while the callback runs means no commit was sent →
// known pre-commit failure (`not_saved`, previous assignment intact). An
// error after the callback finished (COMMIT failed or its reply was lost)
// may or may not have committed → `outcome_unknown`; the client resubmits
// the SAME attempt, and step 2 reports what really happened. Successful
// commits are never undone automatically.
//
// A failure after a successful PUT leaves an object no row points to.
// That is the acknowledged cost of not having cross-system atomicity (no
// pending-upload table, no automatic deletion): it is logged with its key
// and a later resubmission of the same attempt reuses it.

export type Provenance = { sourceUrl: string | null; usageNote: string | null };

export type UploadRequest<E> = {
  target: TargetAdapter<E>;
  /** Assignment the admin form loaded; compared atomically on write. */
  expected: E;
  /** Validated attempt id (keys.parseAttemptId). */
  attemptId: string;
  bytes: Uint8Array;
  provenance: Provenance;
};

export type UploadedAsset = {
  id: string;
  publicUrl: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
};

export type UploadResult = {
  /** created: this request committed. reconciled: an earlier submission
   *  of the same attempt had already committed and is still current. */
  status: "created" | "reconciled";
  attemptId: string;
  asset: UploadedAsset;
};

/** Minimal DB surface, so tests can wrap $transaction to inject faults. */
export type UploadDb = Pick<typeof defaultDb, "$transaction" | "imageAsset">;

export type UploadDeps = {
  storage: ImageStorage;
  db?: UploadDb;
  log?: (event: string, fields: Record<string, unknown>) => void;
};

const ASSET_SELECT = {
  id: true,
  publicUrl: true,
  mimeType: true,
  byteSize: true,
  width: true,
  height: true,
} as const;

/** Raised inside the transaction to roll it back on a CAS mismatch. */
class CasMismatch extends Error {}

function defaultLog(event: string, fields: Record<string, unknown>) {
  // Operational correlation only: attempt id, target, key, error code.
  // Never credentials, provenance or notes.
  console.warn(`[image-upload] ${event}`, fields);
}

export async function uploadAndAssign<E>(req: UploadRequest<E>, deps: UploadDeps): Promise<UploadResult> {
  const db = deps.db ?? defaultDb;
  const log = deps.log ?? defaultLog;
  const { target, expected, attemptId, provenance } = req;

  const image = await validateImage(req.bytes);
  const objectKey = buildObjectKey({
    prefix: deps.storage.keyPrefix,
    segment: target.segment,
    targetId: target.id,
    attemptId,
    ext: image.ext,
  });
  const publicUrl = deps.storage.publicUrlFor(objectKey);
  const correlation = { attemptId, target: `${target.segment}/${target.id}`, objectKey };

  // Step 2 — an earlier submission of this attempt already committed?
  const committed = await db.imageAsset.findUnique({ where: { objectKey }, select: ASSET_SELECT });
  if (committed) {
    return reconcile(db, target, committed, image, attemptId, correlation, log);
  }

  // Early check, so an absent target or an already-stale form does not
  // leave an unassigned object behind. Only an optimisation: the CAS in
  // step 4 is what actually decides.
  const before = await db.$transaction((tx) => target.read(tx));
  if (!before) {
    throw new UploadError("target_not_found", "대상을 찾을 수 없습니다. 삭제되었을 수 있습니다.");
  }
  if (JSON.stringify(target.describe(before)) !== JSON.stringify(target.describe(expected))) {
    log("conflict-before-store", correlation);
    throw await db.$transaction((tx) => conflictFor(tx, target));
  }

  // Step 3 — write-once storage.
  await deps.storage.putImmutable({
    key: objectKey,
    bytes: image.bytes,
    contentType: image.mimeType,
    sha256: image.sha256,
  });

  // Step 4 — metadata + assignment in one transaction.
  let callbackFinished = false;
  try {
    const asset = await db.$transaction(async (tx) => {
      const row = await tx.imageAsset.create({
        data: {
          objectKey,
          publicUrl,
          mimeType: image.mimeType,
          byteSize: image.byteSize,
          width: image.width,
          height: image.height,
          sourceUrl: provenance.sourceUrl,
          usageNote: provenance.usageNote,
        },
        select: ASSET_SELECT,
      });
      if (!(await target.assignAsset(tx, expected, row))) throw new CasMismatch();
      callbackFinished = true;
      return row;
    });
    log("committed", correlation);
    return { status: "created", attemptId, asset };
  } catch (err) {
    if (err instanceof CasMismatch) {
      log("conflict", correlation);
      // Read outside the rolled-back transaction: the current value.
      throw await db.$transaction((tx) => conflictFor(tx, target));
    }
    if (!callbackFinished && isUniqueViolation(err)) {
      // A concurrent submission of the same attempt inserted the same
      // key first (its insert holds the unique slot until it commits or
      // rolls back). Ours did nothing; report what that one did.
      const winner = await db.imageAsset.findUnique({ where: { objectKey }, select: ASSET_SELECT });
      if (winner) return reconcile(db, target, winner, image, attemptId, correlation, log);
    }
    if (callbackFinished) {
      log("outcome-unknown", { ...correlation, error: errorName(err) });
      throw new UploadError(
        "outcome_unknown",
        "저장 결과를 확인하지 못했습니다. 같은 파일로 다시 저장하면 실제 결과를 확인합니다(중복 저장되지 않습니다).",
        { cause: err, detail: { attemptId } },
      );
    }
    log("not-saved-unassigned-object", { ...correlation, error: errorName(err) });
    throw new UploadError(
      "not_saved",
      "데이터베이스 저장에 실패했습니다. 기존 이미지는 그대로입니다. 잠시 후 다시 시도해 주세요.",
      { cause: err, detail: { attemptId } },
    );
  }
}

async function reconcile<E>(
  db: UploadDb,
  target: TargetAdapter<E>,
  asset: UploadedAsset,
  image: { byteSize: number; mimeType: string },
  attemptId: string,
  correlation: Record<string, unknown>,
  log: NonNullable<UploadDeps["log"]>,
): Promise<UploadResult> {
  // Same attempt id, different file → refuse (the key is the old file's).
  if (asset.byteSize !== image.byteSize || asset.mimeType !== image.mimeType) {
    throw new UploadError(
      "attempt_conflict",
      "같은 업로드 시도 ID로 다른 파일이 이미 저장되어 있습니다. 파일을 다시 선택해 주세요.",
    );
  }
  const ref: AssetRef = asset;
  const current = await db.$transaction((tx) => target.read(tx));
  if (current && target.holdsAsset(current, ref)) {
    log("reconciled", correlation);
    return { status: "reconciled", attemptId, asset };
  }
  // It committed earlier, but the target has moved on since (or is gone).
  // A retry must not take the assignment back.
  log("reconciled-superseded", correlation);
  if (!current) {
    throw new UploadError("target_not_found", "대상을 찾을 수 없습니다. 삭제되었을 수 있습니다.");
  }
  throw new UploadError(
    "assignment_conflict",
    "이 업로드는 이전에 저장되었지만, 그 뒤 다른 곳에서 이미지 설정이 바뀌었습니다. 새로고침해 현재 상태를 확인해 주세요.",
    { detail: { current: target.describe(current), attemptCommitted: true } },
  );
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function errorName(err: unknown): string {
  if (isUploadError(err)) return err.code;
  if (err instanceof Prisma.PrismaClientKnownRequestError) return `prisma:${err.code}`;
  return err instanceof Error ? err.name : typeof err;
}

/**
 * Admin-only provenance from form fields. Empty → null. The source URL
 * must be http(s); it is stored, never fetched.
 */
export function parseProvenance(sourceUrl: unknown, usageNote: unknown): Provenance {
  const src = typeof sourceUrl === "string" ? sourceUrl.trim() : "";
  const note = typeof usageNote === "string" ? usageNote.trim() : "";
  if (src.length > MAX_SOURCE_URL_LENGTH) {
    throw new UploadError("invalid_request", `출처 URL은 ${MAX_SOURCE_URL_LENGTH}자 이하여야 합니다.`);
  }
  if (note.length > MAX_USAGE_NOTE_LENGTH) {
    throw new UploadError("invalid_request", `사용 메모는 ${MAX_USAGE_NOTE_LENGTH}자 이하여야 합니다.`);
  }
  if (src) {
    let url: URL | null = null;
    try {
      url = new URL(src);
    } catch {
      url = null;
    }
    if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
      throw new UploadError("invalid_request", "출처 URL은 http(s) 주소여야 합니다.");
    }
  }
  return { sourceUrl: src || null, usageNote: note || null };
}
