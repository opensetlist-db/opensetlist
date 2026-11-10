import { prisma } from "../prisma";
import { CARD_LOCALES, type CardMode } from "./content";
import { publicationOrigin, sharePath, INCLUDE, result, invalid, CardPublicationError, type CardDb, type FrozenCard, type PublicationDeps } from "./contracts";

export async function lookupPublication(input: { eventId: string; mode: string; revision: string; locale: string }, deps: Pick<PublicationDeps, "db" | "origin"> = {}) {
  const { eventId, mode, revision, locale } = input;
  try { sharePath(eventId, mode, revision, locale); } catch { return null; }
  const db = deps.db ?? prisma;
  const row = await db.eventCardPublication.findFirst({ where: { id: revision, eventId: BigInt(eventId), mode: mode as CardMode,
    event: { isDeleted: false } }, include: { ...INCLUDE, event: { select: { slug: true } } } });
  if (!row || !row.annotation) return null;
  const common = { publicationId: row.id, eventId, mode, locale, slug: row.event.slug,
    shareUrl: publicationOrigin(deps.origin) + sharePath(eventId, mode, revision, locale) };
  // Project NO frozen content/image/reason into a suspended public response.
  // It takes priority even over a saved correction pointer or incomplete assets.
  if (row.annotation.status === "suspended") return { ...common, suspended: true, content: null, image: null, correction: null };
  if (row.renditions.length !== 3
    || !CARD_LOCALES.every((l) => row.renditions.some((r) => r.locale === l))) return null;
  const rendition = row.renditions.find((r) => r.locale === locale);
  if (!rendition) return null;
  let correction: { replacementUrl: string | null } | null = null;
  if (row.annotation.status === "corrected") {
    // Read mutable pointers on every request. One compact graph read avoids
    // per-hop queries and follows A→B→C to the current safe locale version.
    // Never reveal reasons/history or link to missing/suspended/mismatched data.
    correction = { replacementUrl: null };
    const graph = await db.eventCardPublication.findMany({ where: { eventId: row.eventId, mode: row.mode, namespace: row.namespace },
      orderBy: { id: "asc" }, select: { id: true, annotation: { select: { status: true, replacementId: true } }, renditions: { select: { locale: true } } } });
    const byId = new Map(graph.map((node) => [node.id, node])); const visited = new Set([revision]);
    let next = byId.get(revision)?.annotation?.replacementId ?? null;
    while (next && !visited.has(next)) {
      visited.add(next); const node = byId.get(next);
      if (!node?.annotation || node.annotation.status === "suspended" || node.renditions.length !== 3
        || !CARD_LOCALES.every((l) => node.renditions.some((r) => r.locale === l))) break;
      if (node.annotation.status === "active") {
        correction.replacementUrl = publicationOrigin(deps.origin) + sharePath(eventId, mode, next, locale); break;
      }
      next = node.annotation.replacementId;
    }
  }
  return { ...common, suspended: false,
    content: rendition.content as FrozenCard, correction,
    image: { url: rendition.asset.publicUrl, width: rendition.asset.width, height: rendition.asset.height, mimeType: rendition.asset.mimeType, sha256: rendition.sha256 } };
}

export async function listPublications(eventId: string, db: CardDb = prisma) {
  if (!/^[1-9]\d*$/.test(eventId) || BigInt(eventId) > BigInt("9223372036854775807")) throw invalid("잘못된 공연 ID입니다.");
  const rows = await db.eventCardPublication.findMany({ where: { eventId: BigInt(eventId) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { ...INCLUDE, correctionsMade: { orderBy: { toVersion: "asc" } },
      suspension: { include: { attempts: { orderBy: [{ startedAt: "asc" }, { id: "asc" }] } } } } });
  return rows.map((row) => ({ ...result(row, publicationOrigin(), "reconciled"), annotation: row.annotation,
    corrections: row.correctionsMade, suspension: row.suspension }));
}

/** Read-only recovery independent of the current renderer, preview or main
 * SHA. Absence is a point-in-time observation, never permission to race an
 * original workflow/writer that may still be running. No object PUT occurs. */
export async function inspectPublication(input: { eventId: string; mode: CardMode; revision: string; namespace: string }, db: CardDb = prisma) {
  const { eventId, mode, revision, namespace } = input;
  sharePath(eventId, mode, revision, "ja");
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(namespace)) throw invalid("잘못된 namespace입니다.");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const lock = `event-card-annotation:${eventId}:${mode}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
    const row = await tx.eventCardPublication.findUnique({ where: { id: revision }, include: INCLUDE });
    const writers = await tx.eventCardWriteAttempt.findMany({ where: { publicationId: revision, settledAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, eventId: true, namespace: true } });
    if ((row && (String(row.eventId) !== eventId || row.mode !== mode || row.namespace !== namespace))
      || writers.some((w) => String(w.eventId) !== eventId || w.namespace !== namespace)) throw new CardPublicationError("publication_conflict", "복구할 발행 식별자의 범위가 다릅니다.");
    const common = { publicationId: revision, eventId, mode, unsettledWriters: writers.map((w) => w.id) };
    if (!row) return { ...common, outcome: writers.length ? "uncertain" as const : "absent" as const };
    if (!row.annotation || row.renditions.length !== 3 || !CARD_LOCALES.every((l) => row.renditions.some((r) => r.locale === l))) {
      throw new CardPublicationError("outcome_unknown", "완전한 발행 묶음을 확인하지 못했습니다.");
    }
    return { ...common, outcome: "committed" as const, previewId: row.previewId, approvalSha256: row.approvalSha256,
      outputs: Object.fromEntries(row.renditions.map((r) => [r.locale, r.sha256])),
      annotation: { status: row.annotation.status, version: row.annotation.version } };
  }, { isolationLevel: "ReadCommitted", maxWait: 30000, timeout: 90000 });
}
