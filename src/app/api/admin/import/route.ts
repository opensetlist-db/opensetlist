import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (values[i] ?? "").trim();
    });
    return row;
  });
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

async function importArtists(rows: Record<string, string>[]) {
  const results: string[] = [];

  // First pass: upsert artists without parentArtistId
  for (const row of rows) {
    const slug = row.slug;
    if (!slug) continue;

    const jaTranslation = row.ja_name ? { locale: "ja", name: row.ja_name, shortName: row.ja_shortName || null } : null;
    const koTranslation = row.ko_name ? { locale: "ko", name: row.ko_name, shortName: row.ko_shortName || null } : null;
    const translations = [jaTranslation, koTranslation].filter(Boolean) as { locale: string; name: string; shortName: string | null }[];
    if (translations.length === 0) continue;

    const existing = await prisma.artist.findUnique({ where: { slug } });

    if (existing) {
      await prisma.artist.update({
        where: { slug },
        data: {
          type: (row.type as "solo" | "group" | "unit") || undefined,
        },
      });
      // Upsert translations
      for (const t of translations) {
        await prisma.artistTranslation.upsert({
          where: { artistId_locale: { artistId: existing.id, locale: t.locale } },
          create: { artistId: existing.id, ...t },
          update: { name: t.name, shortName: t.shortName },
        });
      }
      results.push(`UPDATED: ${slug} → ${existing.id}`);
    } else {
      const artist = await prisma.artist.create({
        data: {
          slug,
          type: (row.type as "solo" | "group" | "unit") || "group",
          hasBoard: true,
          translations: { create: translations },
        },
      });
      results.push(`CREATED: ${slug} → ${artist.id}`);
    }
  }

  // Second pass: set parentArtistId by slug
  for (const row of rows) {
    if (!row.parentArtist_slug || !row.slug) continue;
    const artist = await prisma.artist.findUnique({ where: { slug: row.slug } });
    const parent = await prisma.artist.findUnique({ where: { slug: row.parentArtist_slug } });
    if (artist && parent) {
      await prisma.artist.update({
        where: { id: artist.id },
        data: { parentArtistId: parent.id },
      });
    }
  }

  return { count: results.length, log: results };
}

async function importMembers(rows: Record<string, string>[]) {
  const results: string[] = [];

  for (const row of rows) {
    const charSlug = row.character_slug;
    if (!charSlug) continue;

    const translations = [];
    if (row.ja_name) translations.push({ locale: "ja", name: row.ja_name, shortName: row.ja_shortName || null });
    if (row.ko_name) translations.push({ locale: "ko", name: row.ko_name, shortName: row.ko_shortName || null });
    if (translations.length === 0) continue;

    // Look up artists by slug
    const artistSlugs = (row.artist_slugs || "").split(/\s+/).filter(Boolean);
    const artistIds: bigint[] = [];
    for (const s of artistSlugs) {
      const a = await prisma.artist.findUnique({ where: { slug: s } });
      if (a) artistIds.push(a.id);
    }

    // Create RealPerson if VA info provided
    let realPersonId: string | undefined;
    if (row.va_ja_name || row.va_ko_name) {
      const vaTranslations = [];
      if (row.va_ja_name) vaTranslations.push({ locale: "ja", name: row.va_ja_name, stageName: null as string | null });
      if (row.va_ko_name) vaTranslations.push({ locale: "ko", name: row.va_ko_name, stageName: null as string | null });

      const rp = await prisma.realPerson.create({
        data: { translations: { create: vaTranslations } },
      });
      realPersonId = rp.id;
    }

    // Create StageIdentity
    const si = await prisma.stageIdentity.create({
      data: {
        type: (row.character_type as "character" | "persona") || "character",
        color: row.color || null,
        translations: { create: translations },
        artistLinks: artistIds.length
          ? {
              create: artistIds.map((aid) => ({
                artistId: aid,
                startDate: row.startDate ? new Date(row.startDate) : null,
                endDate: row.endDate ? new Date(row.endDate) : null,
                note: row.note || null,
              })),
            }
          : undefined,
        voicedBy: realPersonId
          ? { create: { realPersonId } }
          : undefined,
      },
    });

    results.push(`Member: ${charSlug} → ${si.id}`);
  }

  return { count: results.length, log: results };
}

async function importSongs(rows: Record<string, string>[]) {
  const results: string[] = [];

  // First pass: upsert songs
  for (const row of rows) {
    const slug = row.slug;
    if (!slug || !row.originalTitle) continue;

    const jaTranslation = row.ja_title ? { locale: "ja", title: row.ja_title } : null;
    const koTranslation = row.ko_title ? { locale: "ko", title: row.ko_title } : null;
    const translations = [jaTranslation, koTranslation].filter(Boolean) as { locale: string; title: string }[];

    // Look up artist by slug
    const artistId = row.artist_slug
      ? (await prisma.artist.findUnique({ where: { slug: row.artist_slug } }))?.id ?? null
      : null;

    const existing = await prisma.song.findUnique({ where: { slug } });

    if (existing) {
      await prisma.song.update({
        where: { slug },
        data: {
          originalTitle: row.originalTitle,
          variantLabel: row.variantLabel || null,
          releaseDate: row.releaseDate ? new Date(row.releaseDate) : null,
          sourceNote: row.sourceNote || null,
        },
      });
      for (const t of translations) {
        await prisma.songTranslation.upsert({
          where: { songId_locale: { songId: existing.id, locale: t.locale } },
          create: { songId: existing.id, ...t },
          update: { title: t.title },
        });
      }
      results.push(`UPDATED: ${slug} → ${existing.id}`);
    } else {
      const song = await prisma.song.create({
        data: {
          slug,
          originalTitle: row.originalTitle,
          variantLabel: row.variantLabel || null,
          releaseDate: row.releaseDate ? new Date(row.releaseDate) : null,
          sourceNote: row.sourceNote || null,
          translations: translations.length ? { create: translations } : undefined,
          artists: artistId
            ? { create: { artistId, role: "primary" } }
            : undefined,
        },
      });
      results.push(`CREATED: ${slug} → ${song.id}`);
    }
  }

  // Second pass: set baseVersionId by slug
  for (const row of rows) {
    if (!row.baseVersion_slug || !row.slug) continue;
    const song = await prisma.song.findUnique({ where: { slug: row.slug } });
    const base = await prisma.song.findUnique({ where: { slug: row.baseVersion_slug } });
    if (song && base) {
      await prisma.song.update({
        where: { id: song.id },
        data: { baseVersionId: base.id },
      });
    }
  }

  return { count: results.length, log: results };
}

async function importEvents(rows: Record<string, string>[]) {
  const results: string[] = [];

  // Upsert series first (dedup by series_slug)
  const seriesSlugs = new Set(rows.map((r) => r.series_slug).filter(Boolean));
  for (const slug of seriesSlugs) {
    const row = rows.find((r) => r.series_slug === slug)!;

    const jaTranslation = row.series_ja_name ? { locale: "ja", name: row.series_ja_name, shortName: row.series_ja_shortName || null } : null;
    const koTranslation = row.series_ko_name ? { locale: "ko", name: row.series_ko_name, shortName: row.series_ko_shortName || null } : null;
    const translations = [jaTranslation, koTranslation].filter(Boolean) as { locale: string; name: string; shortName: string | null }[];

    const artistId = row.artist_slug
      ? (await prisma.artist.findUnique({ where: { slug: row.artist_slug } }))?.id ?? null
      : null;

    const existing = await prisma.eventSeries.findUnique({ where: { slug } });

    if (existing) {
      await prisma.eventSeries.update({
        where: { slug },
        data: {
          type: (row.series_type as "concert_tour" | "festival" | "fan_meeting" | "one_time") || undefined,
          artistId,
        },
      });
      for (const t of translations) {
        await prisma.eventSeriesTranslation.upsert({
          where: { eventSeriesId_locale: { eventSeriesId: existing.id, locale: t.locale } },
          create: { eventSeriesId: existing.id, ...t },
          update: { name: t.name, shortName: t.shortName },
        });
      }
      results.push(`UPDATED Series: ${slug} → ${existing.id}`);
    } else {
      const series = await prisma.eventSeries.create({
        data: {
          slug,
          type: (row.series_type as "concert_tour" | "festival" | "fan_meeting" | "one_time") || "concert_tour",
          artistId,
          hasBoard: true,
          translations: translations.length ? { create: translations } : undefined,
        },
      });
      results.push(`CREATED Series: ${slug} → ${series.id}`);
    }
  }

  // Upsert events
  for (const row of rows) {
    const slug = row.event_slug;
    if (!slug) continue;

    const jaTranslation = row.ja_name ? { locale: "ja", name: row.ja_name, shortName: row.ja_shortName || null, city: row.ja_city || null, venue: row.ja_venue || null } : null;
    const koTranslation = row.ko_name ? { locale: "ko", name: row.ko_name, shortName: row.ko_shortName || null, city: row.ko_city || null, venue: row.ko_venue || null } : null;
    const translations = [jaTranslation, koTranslation].filter(Boolean) as { locale: string; name: string; shortName: string | null; city: string | null; venue: string | null }[];

    const seriesId = row.series_slug
      ? (await prisma.eventSeries.findUnique({ where: { slug: row.series_slug } }))?.id ?? null
      : null;

    const existing = await prisma.event.findUnique({ where: { slug } });

    if (existing) {
      await prisma.event.update({
        where: { slug },
        data: {
          type: (row.event_type as "concert" | "festival" | "fan_meeting" | "showcase" | "virtual_live") || undefined,
          eventSeriesId: seriesId,
          date: row.date ? new Date(row.date) : null,
          country: row.country || null,
        },
      });
      for (const t of translations) {
        await prisma.eventTranslation.upsert({
          where: { eventId_locale: { eventId: existing.id, locale: t.locale } },
          create: { eventId: existing.id, ...t },
          update: { name: t.name, shortName: t.shortName, city: t.city, venue: t.venue },
        });
      }
      results.push(`UPDATED: ${slug} → ${existing.id}`);
    } else {
      const event = await prisma.event.create({
        data: {
          slug,
          type: (row.event_type as "concert" | "festival" | "fan_meeting" | "showcase" | "virtual_live") || "concert",
          status: "upcoming",
          eventSeriesId: seriesId,
          date: row.date ? new Date(row.date) : null,
          country: row.country || null,
          translations: translations.length ? { create: translations } : undefined,
        },
      });
      results.push(`CREATED: ${slug} → ${event.id}`);
    }
  }

  // Second pass: set parentEventId by slug
  for (const row of rows) {
    if (!row.parentEvent_slug || !row.event_slug) continue;
    const event = await prisma.event.findUnique({ where: { slug: row.event_slug } });
    const parent = await prisma.event.findUnique({ where: { slug: row.parentEvent_slug } });
    if (event && parent) {
      await prisma.event.update({
        where: { id: event.id },
        data: { parentEventId: parent.id },
      });
    }
  }

  return { count: results.length, log: results };
}

async function importSetlistItems(rows: Record<string, string>[]) {
  const results: string[] = [];

  // Look up SIs by translation name (no slug on StageIdentity)
  const allSIs = await prisma.stageIdentity.findMany({
    include: { translations: true },
  });

  function findSIId(name: string): string | null {
    const si = allSIs.find((si) =>
      si.translations.some(
        (t) => t.name === name || t.name.toLowerCase().replace(/\s+/g, "-") === name.toLowerCase()
      )
    );
    return si?.id ?? null;
  }

  for (const row of rows) {
    // Look up event by slug
    const event = row.event_slug
      ? await prisma.event.findUnique({ where: { slug: row.event_slug } })
      : null;
    if (!event) {
      results.push(`SKIP: event not found for "${row.event_slug}"`);
      continue;
    }

    const position = parseInt(row.position);
    if (isNaN(position)) continue;

    // Look up song by slug
    const song = row.song_slug
      ? await prisma.song.findUnique({ where: { slug: row.song_slug } })
      : null;

    // Look up artists by slug
    const artistSlugs = (row.artist_slugs || "").split(/\s+/).filter(Boolean);
    const artistIds: bigint[] = [];
    for (const s of artistSlugs) {
      const a = await prisma.artist.findUnique({ where: { slug: s } });
      if (a) artistIds.push(a.id);
    }

    const performerSlugs = (row.performer_slugs || "").split(/\s+/).filter(Boolean);
    const performerIds = performerSlugs.map(findSIId).filter((id): id is string => id !== null);

    const item = await prisma.setlistItem.create({
      data: {
        eventId: event.id,
        position,
        isEncore: row.isEncore === "true" || row.isEncore === "1",
        type: (row.itemType as "song" | "mc" | "video" | "interval") || "song",
        performanceType: (row.performanceType as "live_performance" | "virtual_live" | "video_playback") || "live_performance",
        stageType: (row.stageType as "full_group" | "unit" | "solo" | "special") || "full_group",
        unitName: row.unitName || null,
        note: row.note || null,
        status: (row.status as "confirmed" | "live" | "rumoured") || "confirmed",
        artists: artistIds.length
          ? { create: artistIds.map((aid) => ({ artistId: aid })) }
          : undefined,
        songs: song ? { create: { songId: song.id, order: 0 } } : undefined,
        performers: performerIds.length
          ? { create: performerIds.map((siId) => ({ stageIdentityId: siId })) }
          : undefined,
      },
    });
    results.push(`SetlistItem: ${row.event_slug} #${position} → ${item.id}`);
  }

  return { count: results.length, log: results };
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { type, csv } = body as { type: string; csv: string };

  const rows = parseCSV(csv);
  if (rows.length === 0) {
    return NextResponse.json({ error: "CSV is empty or invalid" }, { status: 400 });
  }

  let result;
  switch (type) {
    case "artists":
      result = await importArtists(rows);
      break;
    case "members":
      result = await importMembers(rows);
      break;
    case "songs":
      result = await importSongs(rows);
      break;
    case "events":
      result = await importEvents(rows);
      break;
    case "setlistitems":
      result = await importSetlistItems(rows);
      break;
    default:
      return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
  }

  return NextResponse.json(serializeBigInt(result));
}
