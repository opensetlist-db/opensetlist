import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import type { CardEvent } from "./content";

type Reader = Pick<PrismaClient | Prisma.TransactionClient, "event">;
// Select only card facts. Status, engagement, metrics and the clock never
// authorize publication or invalidate an otherwise identical reviewed card.
export async function readCardEvents(db: Reader, ids: string[]): Promise<CardEvent[]> {
  const named = { originalName: true, originalLanguage: true, translations: { select: { locale: true, name: true }, orderBy: { locale: "asc" as const } } };
  const rows = await db.event.findMany({
    where: { id: { in: ids.map(BigInt) }, isDeleted: false }, orderBy: { id: "asc" },
    select: { id: true, slug: true, date: true, originalName: true, originalLanguage: true, originalVenue: true,
      translations: { select: { locale: true, name: true, venue: true }, orderBy: { locale: "asc" } },
      eventSeries: { select: { ...named, isDeleted: true } }, artist: { select: { ...named, isDeleted: true } } },
  });
  return rows.map((r) => ({ ...r, id: String(r.id), date: r.date?.toISOString().slice(0, 10) ?? null,
    eventSeries: r.eventSeries?.isDeleted ? null : r.eventSeries,
    artist: r.artist?.isDeleted ? null : r.artist }));
}

export function cardSourceFacts(event: CardEvent) {
  const named = (e: CardEvent["eventSeries"]) => e && ({ originalName: e.originalName, originalLanguage: e.originalLanguage,
    translations: e.translations.filter((t) => ["ja", "ko", "en"].includes(t.locale))
      .map((t) => ({ locale: t.locale, name: t.name })).sort((a, b) => a.locale.localeCompare(b.locale)) });
  return { id: event.id, originalName: event.originalName, originalLanguage: event.originalLanguage,
    date: event.date, originalVenue: event.originalVenue,
    translations: event.translations.filter((t) => ["ja", "ko", "en"].includes(t.locale))
      .map((t) => ({ locale: t.locale, name: t.name, venue: t.venue ?? null })).sort((a, b) => a.locale.localeCompare(b.locale)),
    eventSeries: named(event.eventSeries), artist: named(event.artist) };
}
