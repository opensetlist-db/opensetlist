import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { validateEncoreOrder } from "@/lib/validation";
import { parseArtistSlugs, resolveOriginalLanguage, resolveSongTranslations } from "@/lib/csv-parse";

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
    const enTranslation = row.en_name ? { locale: "en", name: row.en_name, shortName: row.en_shortName || null } : null;
    const translations = [jaTranslation, koTranslation, enTranslation].filter(Boolean) as { locale: string; name: string; shortName: string | null }[];
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
    if (row.en_name) translations.push({ locale: "en", name: row.en_name, shortName: row.en_shortName || null });
    if (translations.length === 0) continue;

    // Look up artists by slug
    const artistSlugs = (row.artist_slugs || "").split(/\s+/).filter(Boolean);
    const artistIds: bigint[] = [];
    for (const s of artistSlugs) {
      const a = await prisma.artist.findUnique({ where: { slug: s } });
      if (a) artistIds.push(a.id);
    }

    // Upsert RealPerson if VA info provided
    let realPersonId: string | undefined;
    const vaSlug = `va-${charSlug}`;
    if (row.va_ja_name || row.va_ko_name || row.va_en_name) {
      const vaTranslations = [];
      if (row.va_ja_name) vaTranslations.push({ locale: "ja", name: row.va_ja_name, stageName: null as string | null });
      if (row.va_ko_name) vaTranslations.push({ locale: "ko", name: row.va_ko_name, stageName: null as string | null });
      if (row.va_en_name) vaTranslations.push({ locale: "en", name: row.va_en_name, stageName: null as string | null });

      const existingRp = await prisma.realPerson.findUnique({ where: { slug: vaSlug } });
      if (existingRp) {
        for (const t of vaTranslations) {
          await prisma.realPersonTranslation.upsert({
            where: { realPersonId_locale: { realPersonId: existingRp.id, locale: t.locale } },
            create: { realPersonId: existingRp.id, ...t },
            update: { name: t.name, stageName: t.stageName },
          });
        }
        realPersonId = existingRp.id;
      } else {
        const rp = await prisma.realPerson.create({
          data: { slug: vaSlug, translations: { create: vaTranslations } },
        });
        realPersonId = rp.id;
      }
    }

    // Upsert StageIdentity
    const existingSi = await prisma.stageIdentity.findUnique({ where: { slug: charSlug } });

    let siId: string;
    if (existingSi) {
      await prisma.stageIdentity.update({
        where: { slug: charSlug },
        data: {
          type: (row.character_type as "character" | "persona") || "character",
          color: row.color || null,
        },
      });
      // Upsert translations
      for (const t of translations) {
        await prisma.stageIdentityTranslation.upsert({
          where: { stageIdentityId_locale: { stageIdentityId: existingSi.id, locale: t.locale } },
          create: { stageIdentityId: existingSi.id, ...t },
          update: { name: t.name, shortName: t.shortName },
        });
      }
      // Upsert artist links
      for (const aid of artistIds) {
        await prisma.stageIdentityArtist.upsert({
          where: { stageIdentityId_artistId: { stageIdentityId: existingSi.id, artistId: aid } },
          create: {
            stageIdentityId: existingSi.id,
            artistId: aid,
            startDate: row.startDate ? new Date(row.startDate) : null,
            endDate: row.endDate ? new Date(row.endDate) : null,
            note: row.note || null,
          },
          update: {
            startDate: row.startDate ? new Date(row.startDate) : null,
            endDate: row.endDate ? new Date(row.endDate) : null,
            note: row.note || null,
          },
        });
      }
      // Upsert voicedBy link
      if (realPersonId) {
        const existingVb = await prisma.realPersonStageIdentity.findFirst({
          where: { stageIdentityId: existingSi.id, realPersonId },
        });
        if (!existingVb) {
          await prisma.realPersonStageIdentity.create({
            data: { stageIdentityId: existingSi.id, realPersonId },
          });
        }
      }
      siId = existingSi.id;
      results.push(`UPDATED: ${charSlug} → ${siId}`);
    } else {
      const si = await prisma.stageIdentity.create({
        data: {
          slug: charSlug,
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
      siId = si.id;
      results.push(`CREATED: ${charSlug} → ${siId}`);
    }
  }

  return { count: results.length, log: results };
}

async function importAlbums(rows: Record<string, string>[]) {
  const results: string[] = [];

  for (const row of rows) {
    const slug = row.slug;
    if (!slug) continue;

    const jaTranslation = row.ja_title ? { locale: "ja", title: row.ja_title } : null;
    const koTranslation = row.ko_title ? { locale: "ko", title: row.ko_title } : null;
    const enTranslation = row.en_title ? { locale: "en", title: row.en_title } : null;
    const translations = [jaTranslation, koTranslation, enTranslation].filter(Boolean) as { locale: string; title: string }[];

    const originalTitle = row.originalTitle || "";
    const originalLanguage = resolveOriginalLanguage(row.originalLanguage);

    const existing = await prisma.album.findUnique({ where: { slug } });

    let albumId: string;
    if (existing) {
      await prisma.album.update({
        where: { slug },
        data: {
          type: (row.type as "single" | "album" | "ep" | "live_album" | "soundtrack") || undefined,
          originalTitle,
          originalLanguage,
          releaseDate: row.releaseDate ? new Date(row.releaseDate) : null,
          labelName: row.labelName || null,
        },
      });
      for (const t of translations) {
        await prisma.albumTranslation.upsert({
          where: { albumId_locale: { albumId: existing.id, locale: t.locale } },
          create: { albumId: existing.id, ...t },
          update: { title: t.title },
        });
      }
      albumId = existing.id;
      results.push(`UPDATED: ${slug} → ${albumId}`);
    } else {
      const album = await prisma.album.create({
        data: {
          slug,
          type: (row.type as "single" | "album" | "ep" | "live_album" | "soundtrack") || "ep",
          originalTitle,
          originalLanguage,
          releaseDate: row.releaseDate ? new Date(row.releaseDate) : null,
          labelName: row.labelName || null,
          translations: translations.length ? { create: translations } : undefined,
        },
      });
      albumId = album.id;
      results.push(`CREATED: ${slug} → ${albumId}`);
    }

    // Upsert AlbumArtist rows from space-separated artist_slugs
    const artistSlugsForAlbum = parseArtistSlugs(row.artist_slugs);
    if (artistSlugsForAlbum.length > 0) {
      const slugs = artistSlugsForAlbum;
      for (const artistSlug of slugs) {
        const artist = await prisma.artist.findUnique({ where: { slug: artistSlug } });
        if (!artist) {
          results.push(`WARN: artist not found: ${artistSlug}`);
          continue;
        }
        await prisma.albumArtist.upsert({
          where: { albumId_artistId: { albumId, artistId: artist.id } },
          create: { albumId, artistId: artist.id },
          update: {},
        });
      }
    }
  }

  return { count: results.length, log: results };
}

async function importSongs(rows: Record<string, string>[]) {
  const results: string[] = [];
  const seenSlugs = new Set<string>();

  // First pass: upsert songs, translations, artists, album tracks
  for (const row of rows) {
    const slug = row.slug;
    if (!slug || !row.originalTitle) continue;

    const { translations: allTranslations, removedLocales } = resolveSongTranslations(row);

    // Upsert Song
    const song = await prisma.song.upsert({
      where: { slug },
      create: {
        slug,
        originalTitle: row.originalTitle,
        originalLanguage: resolveOriginalLanguage(row.originalLanguage),
        variantLabel: row.variantLabel || null,
        releaseDate: row.releaseDate ? new Date(row.releaseDate) : null,
        sourceNote: row.sourceNote || null,
      },
      update: {
        originalTitle: row.originalTitle,
        originalLanguage: row.originalLanguage ? resolveOriginalLanguage(row.originalLanguage) : undefined,
        variantLabel: row.variantLabel || null,
        releaseDate: row.releaseDate ? new Date(row.releaseDate) : null,
        sourceNote: row.sourceNote || null,
      },
    });

    if (!seenSlugs.has(slug)) {
      seenSlugs.add(slug);
      results.push(`UPSERT: ${slug} → ${song.id}`);
    }

    // Delete translations for locales no longer in CSV
    if (removedLocales.length > 0) {
      await prisma.songTranslation.deleteMany({
        where: { songId: song.id, locale: { in: removedLocales } },
      });
    }

    for (const t of allTranslations) {
      await prisma.songTranslation.upsert({
        where: { songId_locale: { songId: song.id, locale: t.locale } },
        create: { songId: song.id, locale: t.locale, title: t.title, variantLabel: t.variantLabel || null },
        update: { title: t.title, variantLabel: t.variantLabel || null },
      });
    }

    // Upsert SongArtist links
    if (row.artist_slugs) {
      const artistSlugs = parseArtistSlugs(row.artist_slugs);
      for (const artistSlug of artistSlugs) {
        const artist = await prisma.artist.findUnique({ where: { slug: artistSlug } });
        if (!artist) {
          results.push(`WARN: artist not found: ${artistSlug}`);
          continue;
        }
        await prisma.songArtist.upsert({
          where: { songId_artistId: { songId: song.id, artistId: artist.id } },
          create: { songId: song.id, artistId: artist.id, role: "primary" },
          update: {},
        });
      }
    }

    // Upsert AlbumTrack — each row can link song to a different album
    if (row.album_slug && row.track_number) {
      const album = await prisma.album.findUnique({ where: { slug: row.album_slug } });
      if (!album) {
        results.push(`WARN: album not found: ${row.album_slug}`);
      } else {
        const discNumber = row.disc_number ? parseInt(row.disc_number) : 1;
        const trackNumber = parseInt(row.track_number);
        if (!isNaN(trackNumber) && !isNaN(discNumber)) {
          await prisma.albumTrack.upsert({
            where: { albumId_discNumber_trackNumber: { albumId: album.id, discNumber, trackNumber } },
            create: { albumId: album.id, songId: song.id, discNumber, trackNumber },
            update: { songId: song.id },
          });
        }
      }
    }
  }

  // Second pass: set baseVersionId by slug (needs all songs created first)
  for (const row of rows) {
    if (!row.baseVersion_slug || !row.slug) continue;
    const song = await prisma.song.findUnique({ where: { slug: row.slug } });
    const base = await prisma.song.findUnique({ where: { slug: row.baseVersion_slug } });
    if (!song) {
      results.push(`WARN: song not found: ${row.slug}`);
      continue;
    }
    if (!base) {
      results.push(`WARN: baseVersion not found: ${row.baseVersion_slug} (for ${row.slug})`);
      continue;
    }
    await prisma.song.update({
      where: { id: song.id },
      data: { baseVersionId: base.id },
    });
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
          startTime: row.startTime ? new Date(row.startTime) : null,
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
          startTime: row.startTime ? new Date(row.startTime) : null,
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

  // Third pass: create EventPerformer rows
  const allSIs = await prisma.stageIdentity.findMany({
    include: { translations: true },
  });

  function findSIIdBySlug(slug: string): string | null {
    const si = allSIs.find((si) =>
      si.translations.some(
        (t) => t.name === slug || t.name.toLowerCase().replace(/\s+/g, "-") === slug.toLowerCase()
      )
    );
    return si?.id ?? null;
  }

  for (const row of rows) {
    if (!row.event_slug) continue;
    const performerSlugs = (row.event_performer_slugs || "").split(/\s+/).filter(Boolean);
    const guestSlugs = (row.event_guest_slugs || "").split(/\s+/).filter(Boolean);
    if (performerSlugs.length === 0 && guestSlugs.length === 0) continue;

    const event = await prisma.event.findUnique({ where: { slug: row.event_slug } });
    if (!event) continue;

    // Delete existing EventPerformers for this event (re-import)
    await prisma.eventPerformer.deleteMany({ where: { eventId: event.id } });

    for (const slug of performerSlugs) {
      const siId = findSIIdBySlug(slug);
      if (siId) {
        await prisma.eventPerformer.create({
          data: { eventId: event.id, stageIdentityId: siId, isGuest: false },
        });
      }
    }

    for (const slug of guestSlugs) {
      const siId = findSIIdBySlug(slug);
      if (siId) {
        await prisma.eventPerformer.create({
          data: { eventId: event.id, stageIdentityId: siId, isGuest: true },
        });
      }
    }

    results.push(`EventPerformers: ${row.event_slug} → ${performerSlugs.length} regular + ${guestSlugs.length} guests`);
  }

  return { count: results.length, log: results };
}

async function importSetlistItems(rows: Record<string, string>[]) {
  const results: string[] = [];

  // Look up SIs by slug
  const allSIs = await prisma.stageIdentity.findMany({
    include: { translations: true },
  });

  function findSIId(slug: string): string | null {
    const si = allSIs.find((si) =>
      si.slug === slug ||
      si.translations.some(
        (t) => t.name === slug || t.name.toLowerCase().replace(/\s+/g, "-") === slug.toLowerCase()
      )
    );
    return si?.id ?? null;
  }

  // Pre-pass: delete existing setlist items for events being imported (re-import support)
  const eventSlugs = new Set(rows.map((r) => r.event_slug).filter(Boolean));
  for (const slug of eventSlugs) {
    const event = await prisma.event.findUnique({ where: { slug } });
    if (event) {
      // Delete related junction rows first, then setlist items
      const existingItems = await prisma.setlistItem.findMany({
        where: { eventId: event.id },
        select: { id: true },
      });
      const itemIds = existingItems.map((i) => i.id);
      if (itemIds.length > 0) {
        await prisma.setlistItemSong.deleteMany({ where: { setlistItemId: { in: itemIds } } });
        await prisma.setlistItemMember.deleteMany({ where: { setlistItemId: { in: itemIds } } });
        await prisma.setlistItemArtist.deleteMany({ where: { setlistItemId: { in: itemIds } } });
        await prisma.setlistItem.deleteMany({ where: { id: { in: itemIds } } });
        results.push(`CLEARED: ${slug} — ${itemIds.length} existing items deleted`);
      }
    }
  }

  // Validate encore ordering per event
  const rowsByEvent = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    const slug = row.event_slug;
    if (!slug) continue;
    if (!rowsByEvent.has(slug)) rowsByEvent.set(slug, []);
    rowsByEvent.get(slug)!.push(row);
  }
  const skippedEvents = new Set<string>();
  for (const [slug, eventRows] of rowsByEvent) {
    const items = eventRows
      .map((r) => ({
        position: parseInt(r.position),
        isEncore: r.isEncore?.toLowerCase() === "true" || r.isEncore === "1",
      }))
      .filter((i) => !isNaN(i.position));
    const encoreError = validateEncoreOrder(items);
    if (encoreError) {
      results.push(`ERROR: ${slug} — ${encoreError} 이 이벤트를 건너뜁니다.`);
      skippedEvents.add(slug);
    }
  }

  for (const row of rows) {
    if (skippedEvents.has(row.event_slug)) continue;

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
        isEncore: row.isEncore?.toLowerCase() === "true" || row.isEncore === "1",
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
    case "albums":
      result = await importAlbums(rows);
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
