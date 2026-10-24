import type { Prisma } from "@/generated/prisma/client";
import { buildObjectKey, type TargetSegment } from "./keys";
import { ACCEPTED_IMAGE_FORMATS } from "./limits";
import { readR2Config } from "./storage";

// "Did this upload attempt commit?" — the read an admin form makes after
// an outcome it could not observe (lost reply, timeout), shared by the
// series-logo, event-logo and album-cover editors.
//
// The ImageAsset row and the target assignment commit together (one
// transaction in service.ts), so a row under the attempt's key proves the
// attempt committed. Whether the target STILL holds that asset is the
// caller's question: answer it from the same transaction client `tx`
// (ideally a REPEATABLE READ one that also reads the target), so an upload
// committing between two separate reads cannot produce a false verdict.
//
// States:
//   committed    — exactly one row under the attempt's keys;
//   not-observed — no row at read time. NOT proof of failure: a request
//                  still in flight may commit later, so a form may offer an
//                  explicit same-attempt retry (the server reconciles it)
//                  but must not claim "not saved";
//   ambiguous    — more than one row (one per extension; should not
//                  happen). Treat as unknown;
//   unavailable  — the storage namespace is absent or misconfigured here,
//                  so the attempt's key cannot be rebuilt. Unknown, not
//                  "never saved": the config may have changed since.

export type AttemptLookup =
  | { state: "committed"; assetId: string; publicUrl: string }
  | { state: "not-observed" }
  | { state: "ambiguous" }
  | { state: "unavailable" };

/** Every key the attempt could have committed under, or null without a namespace. */
export function attemptObjectKeys(
  segment: TargetSegment,
  targetId: bigint,
  attemptId: string,
  env: Record<string, string | undefined> = process.env,
): string[] | null {
  let prefix: string;
  try {
    const cfg = readR2Config(env);
    if (!cfg) return null;
    prefix = cfg.keyPrefix;
  } catch {
    return null;
  }
  // The decoded format decides the extension, so the committed key is one
  // of exactly these. An exact `in` lookup, never a substring match.
  return Object.values(ACCEPTED_IMAGE_FORMATS).map((f) =>
    buildObjectKey({ prefix, segment, targetId, attemptId, ext: f.ext }),
  );
}

/** Looks the attempt up with the caller's transaction client. */
export async function findAttemptAsset(
  tx: Prisma.TransactionClient,
  segment: TargetSegment,
  targetId: bigint,
  attemptId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<AttemptLookup> {
  const keys = attemptObjectKeys(segment, targetId, attemptId, env);
  if (!keys) return { state: "unavailable" };
  const rows = await tx.imageAsset.findMany({
    where: { objectKey: { in: keys } },
    select: { id: true, publicUrl: true },
  });
  if (rows.length === 0) return { state: "not-observed" };
  if (rows.length > 1) return { state: "ambiguous" };
  return {
    state: "committed",
    assetId: rows[0].id,
    publicUrl: rows[0].publicUrl,
  };
}
