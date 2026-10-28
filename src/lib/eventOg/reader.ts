import { prisma } from "../prisma";
import { CARD_LOCALES, type CardMode } from "./content";
import { publicationOrigin, sharePath, INCLUDE, result, invalid, type CardDb, type FrozenCard, type PublicationDeps } from "./contracts";

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
