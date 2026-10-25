import { prisma } from "../prisma";
import { CARD_LOCALES, type CardMode } from "./content";
import { publicationOrigin, sharePath, INCLUDE, result, invalid, type CardDb, type FrozenCard, type PublicationDeps } from "./contracts";

export async function lookupPublication(input: { eventId: string; mode: string; revision: string; locale: string }, deps: Pick<PublicationDeps, "db" | "origin"> = {}) {
  const { eventId, mode, revision, locale } = input;
  try { sharePath(eventId, mode, revision, locale); } catch { return null; }
  const db = deps.db ?? prisma;
  const row = await db.eventCardPublication.findFirst({ where: { id: revision, eventId: BigInt(eventId), mode: mode as CardMode,
    event: { isDeleted: false } }, include: { ...INCLUDE, event: { select: { slug: true } } } });
  if (!row || row.annotation?.status !== "active" || row.renditions.length !== 3
    || !CARD_LOCALES.every((l) => row.renditions.some((r) => r.locale === l))) return null;
  const rendition = row.renditions.find((r) => r.locale === locale);
  if (!rendition) return null;
  return { publicationId: row.id, eventId, mode, locale, slug: row.event.slug,
    shareUrl: publicationOrigin(deps.origin) + sharePath(eventId, mode, revision, locale),
    content: rendition.content as FrozenCard,
    image: { url: rendition.asset.publicUrl, width: rendition.asset.width, height: rendition.asset.height, mimeType: rendition.asset.mimeType, sha256: rendition.sha256 } };
}

export async function listPublications(eventId: string, db: CardDb = prisma) {
  if (!/^[1-9]\d*$/.test(eventId) || BigInt(eventId) > BigInt("9223372036854775807")) throw invalid("잘못된 공연 ID입니다.");
  const rows = await db.eventCardPublication.findMany({ where: { eventId: BigInt(eventId) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: INCLUDE });
  return rows.map((row) => result(row, publicationOrigin(), "reconciled"));
}
