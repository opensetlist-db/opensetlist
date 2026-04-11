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

// Slug → DB ID maps built during import
type SlugMap = Map<string, string | bigint>;

async function importArtists(rows: Record<string, string>[]) {
  const slugMap: SlugMap = new Map();
  const results: string[] = [];

  // First pass: create artists without parentArtistId
  for (const row of rows) {
    const slug = row.slug;
    if (!slug) continue;

    const translations = [];
    if (row.ja_name) translations.push({ locale: "ja", name: row.ja_name });
    if (row.ko_name) translations.push({ locale: "ko", name: row.ko_name });
    if (translations.length === 0) continue;

    const artist = await prisma.artist.create({
      data: {
        type: (row.type as "solo" | "group" | "unit" | "band") || "group",
        hasBoard: true,
        translations: { create: translations },
      },
    });
    slugMap.set(slug, artist.id);
    results.push(`Artist: ${slug} → ${artist.id}`);
  }

  // Second pass: set parentArtistId
  for (const row of rows) {
    if (!row.parentArtist_slug || !row.slug) continue;
    const artistId = slugMap.get(row.slug);
    const parentId = slugMap.get(row.parentArtist_slug);
    if (artistId && parentId) {
      await prisma.artist.update({
        where: { id: artistId as bigint },
        data: { parentArtistId: parentId as bigint },
      });
    }
  }

  return { count: results.length, slugMap: Object.fromEntries(slugMap.entries()), log: results };
}

async function importMembers(rows: Record<string, string>[]) {
  // Need to look up artist IDs by name (from translations)
  const allArtists = await prisma.artist.findMany({
    where: { isDeleted: false },
    include: { translations: true },
  });

  function findArtistId(slug: string): bigint | null {
    // Match by translation name (slug is used as a matching key)
    const a = allArtists.find((a) =>
      a.translations.some(
        (t) => t.name === slug || t.name.toLowerCase().replace(/\s+/g, "_") === slug.toLowerCase()
      )
    );
    return a?.id ?? null;
  }

  const results: string[] = [];

  for (const row of rows) {
    const charSlug = row.character_slug;
    if (!charSlug) continue;

    const translations = [];
    if (row.ja_name) translations.push({ locale: "ja", name: row.ja_name });
    if (row.ko_name) translations.push({ locale: "ko", name: row.ko_name });
    if (translations.length === 0) continue;

    const artistSlugs = (row.artist_slugs || "").split(/\s+/).filter(Boolean);
    const artistIds = artistSlugs.map(findArtistId).filter((id): id is bigint => id !== null);

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
          ? { create: artistIds.map((aid) => ({ artistId: aid })) }
          : undefined,
        voicedBy: realPersonId
          ? {
              create: {
                realPersonId,
                startDate: row.startDate ? new Date(row.startDate) : null,
                endDate: row.endDate ? new Date(row.endDate) : null,
              },
            }
          : undefined,
      },
    });

    results.push(`Member: ${charSlug} → ${si.id}`);
  }

  return { count: results.length, log: results };
}

async function importSongs(rows: Record<string, string>[]) {
  const allArtists = await prisma.artist.findMany({
    where: { isDeleted: false },
    include: { translations: true },
  });

  function findArtistId(slug: string): bigint | null {
    const a = allArtists.find((a) =>
      a.translations.some(
        (t) => t.name === slug || t.name.toLowerCase().replace(/\s+/g, "_") === slug.toLowerCase()
      )
    );
    return a?.id ?? null;
  }

  // First pass: create songs, track slug → id
  const slugMap: SlugMap = new Map();
  const results: string[] = [];

  for (const row of rows) {
    const slug = row.slug;
    if (!slug || !row.originalTitle) continue;

    const translations = [];
    if (row.ja_title) translations.push({ locale: "ja", title: row.ja_title });
    if (row.ko_title) translations.push({ locale: "ko", title: row.ko_title });

    const artistId = row.artist_slug ? findArtistId(row.artist_slug) : null;

    const song = await prisma.song.create({
      data: {
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
    slugMap.set(slug, song.id);
    results.push(`Song: ${slug} → ${song.id}`);
  }

  // Second pass: set baseVersionId
  for (const row of rows) {
    if (!row.baseVersion_slug || !row.slug) continue;
    const songId = slugMap.get(row.slug);
    const baseId = slugMap.get(row.baseVersion_slug);
    if (songId && baseId) {
      await prisma.song.update({
        where: { id: songId as bigint },
        data: { baseVersionId: baseId as bigint },
      });
    }
  }

  return { count: results.length, slugMap: Object.fromEntries(slugMap.entries()), log: results };
}

async function importEvents(rows: Record<string, string>[]) {
  // Track series and event slugs
  const seriesSlugMap: SlugMap = new Map();
  const eventSlugMap: SlugMap = new Map();

  const allArtists = await prisma.artist.findMany({
    where: { isDeleted: false },
    include: { translations: true },
  });

  function findArtistId(slug: string): bigint | null {
    const a = allArtists.find((a) =>
      a.translations.some(
        (t) => t.name === slug || t.name.toLowerCase().replace(/\s+/g, "_") === slug.toLowerCase()
      )
    );
    return a?.id ?? null;
  }

  const results: string[] = [];

  // Create series first (dedup by series_slug)
  const seriesSlugs = new Set(rows.map((r) => r.series_slug).filter(Boolean));
  for (const slug of seriesSlugs) {
    const row = rows.find((r) => r.series_slug === slug)!;
    const translations = [];
    if (row.series_ja_name) translations.push({ locale: "ja", name: row.series_ja_name });
    if (row.series_ko_name) translations.push({ locale: "ko", name: row.series_ko_name });

    const artistId = row.artist_slug ? findArtistId(row.artist_slug) : null;

    const series = await prisma.eventSeries.create({
      data: {
        type: (row.series_type as "concert_tour" | "festival" | "fan_meeting" | "one_time") || "concert_tour",
        artistId: artistId,
        hasBoard: true,
        translations: translations.length ? { create: translations } : undefined,
      },
    });
    seriesSlugMap.set(slug, series.id);
    results.push(`Series: ${slug} → ${series.id}`);
  }

  // First pass: create events without parentEventId
  for (const row of rows) {
    const slug = row.event_slug;
    if (!slug) continue;

    const translations = [];
    if (row.ja_name) translations.push({ locale: "ja", name: row.ja_name });
    if (row.ko_name) translations.push({ locale: "ko", name: row.ko_name });

    const seriesId = row.series_slug ? seriesSlugMap.get(row.series_slug) : null;

    const event = await prisma.event.create({
      data: {
        type: (row.event_type as "concert" | "festival" | "fan_meeting" | "showcase" | "virtual_live") || "concert",
        status: "upcoming",
        eventSeriesId: seriesId ? (seriesId as bigint) : null,
        date: row.date ? new Date(row.date) : null,
        venue: row.venue || null,
        city: row.city || null,
        country: row.country || null,
        translations: translations.length ? { create: translations } : undefined,
      },
    });
    eventSlugMap.set(slug, event.id);
    results.push(`Event: ${slug} → ${event.id}`);
  }

  // Second pass: set parentEventId
  for (const row of rows) {
    if (!row.parentEvent_slug || !row.event_slug) continue;
    const eventId = eventSlugMap.get(row.event_slug);
    const parentId = eventSlugMap.get(row.parentEvent_slug);
    if (eventId && parentId) {
      await prisma.event.update({
        where: { id: eventId as bigint },
        data: { parentEventId: parentId as bigint },
      });
    }
  }

  return { count: results.length, log: results };
}

async function importSetlistItems(rows: Record<string, string>[]) {
  // Look up events and songs by slug (matching translations)
  const allEvents = await prisma.event.findMany({
    where: { isDeleted: false },
    include: { translations: true },
  });
  const allSongs = await prisma.song.findMany({
    where: { isDeleted: false },
    include: { translations: true },
  });
  const allSIs = await prisma.stageIdentity.findMany({
    include: { translations: true },
  });

  function findEventId(slug: string): bigint | null {
    const e = allEvents.find((e) =>
      e.translations.some(
        (t) => t.name === slug || t.name.toLowerCase().replace(/\s+/g, "_") === slug.toLowerCase()
      )
    );
    return e?.id ?? null;
  }

  function findSongId(slug: string): bigint | null {
    const s = allSongs.find((s) =>
      s.originalTitle === slug ||
      s.originalTitle.toLowerCase().replace(/\s+/g, "_") === slug.toLowerCase() ||
      s.translations.some(
        (t) => t.title === slug || t.title.toLowerCase().replace(/\s+/g, "_") === slug.toLowerCase()
      )
    );
    return s?.id ?? null;
  }

  function findSIId(slug: string): string | null {
    const si = allSIs.find((si) =>
      si.translations.some(
        (t) => t.name === slug || t.name.toLowerCase().replace(/\s+/g, "_") === slug.toLowerCase()
      )
    );
    return si?.id ?? null;
  }

  const results: string[] = [];

  for (const row of rows) {
    const eventId = row.event_slug ? findEventId(row.event_slug) : null;
    if (!eventId) {
      results.push(`SKIP: event not found for "${row.event_slug}"`);
      continue;
    }

    const position = parseInt(row.position);
    if (isNaN(position)) continue;

    const songSlug = row.song_slug;
    const songId = songSlug ? findSongId(songSlug) : null;

    const performerSlugs = (row.performers || "").split(/\s+/).filter(Boolean);
    const performerIds = performerSlugs.map(findSIId).filter((id): id is string => id !== null);

    const item = await prisma.setlistItem.create({
      data: {
        eventId,
        position,
        isEncore: row.isEncore === "true" || row.isEncore === "1",
        type: (row.itemType as "song" | "mc" | "video" | "interval") || "song",
        performanceType: (row.performanceType as "live_performance" | "virtual_live" | "video_playback") || "live_performance",
        stageType: (row.stageType as "full_group" | "unit" | "solo" | "special") || "full_group",
        unitName: row.unitName || null,
        note: row.note || null,
        status: (row.status as "confirmed" | "live" | "rumoured") || "confirmed",
        songs: songId ? { create: { songId, order: 0 } } : undefined,
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
