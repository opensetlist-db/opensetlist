import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { validateEncoreOrder } from "@/lib/validation";
import {
  buildOriginals,
  ensureOriginalName,
  ImportValidationError,
  parseArtistSlugs,
  resolveOriginalLanguage,
  resolveSongTranslations,
} from "@/lib/csv-parse";
import { GroupCategory, GroupType } from "@/generated/prisma/enums";

// Derive the valid sets from the generated enum objects so a future
// schema change auto-propagates here. The legacy `anime`/`game`
// strings are explicitly rejected with a migration hint so a CSV
// authored against the old enum fails loudly instead of silently
// landing rows with NULL category.
const VALID_GROUP_CATEGORIES = new Set<GroupCategory>(
  Object.values(GroupCategory),
);
const LEGACY_GROUP_CATEGORIES = new Set(["anime", "game"]);
const VALID_GROUP_TYPES = new Set<GroupType>(Object.values(GroupType));

function parseGroupCategory(
  raw: string | undefined,
  rowSlug: string,
): GroupCategory | null {
  const v = (raw ?? "").trim();
  if (v === "") return null;
  if (LEGACY_GROUP_CATEGORIES.has(v)) {
    throw new ImportValidationError(
      `Row "${rowSlug}": legacy category "${v}" is no longer supported. Use "animegame" instead.`,
    );
  }
  if (!VALID_GROUP_CATEGORIES.has(v as GroupCategory)) {
    throw new ImportValidationError(
      `Row "${rowSlug}": unknown category "${v}". Valid: animegame, kpop, jpop, cpop, others.`,
    );
  }
  return v as GroupCategory;
}

function parseGroupType(
  raw: string | undefined,
  rowSlug: string,
): GroupType | null {
  const v = (raw ?? "").trim();
  if (v === "") return null;
  if (!VALID_GROUP_TYPES.has(v as GroupType)) {
    throw new ImportValidationError(
      `Row "${rowSlug}": unknown type "${v}". Valid: franchise, label, agency, series.`,
    );
  }
  return v as GroupType;
}

function parseBooleanFlag(raw: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/**
 * Pick the translation whose locale matches `originalLanguage` — that row is
 * the source of truth for the parent's `original*` fields. Returns null when
 * the matching row is absent so callers fall through to explicit override
 * columns (or, on update, preserve existing values rather than stomp them).
 */
function pickOriginalSource<T extends { locale: string }>(
  translations: readonly T[],
  originalLanguage: string
): T | null {
  return translations.find((t) => t.locale === originalLanguage) ?? null;
}

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

    const originalLanguage = resolveOriginalLanguage(row.originalLanguage);
    const source = pickOriginalSource(translations, originalLanguage);
    const originals = buildOriginals(row, source, originalLanguage, [
      { override: "originalName", sourceKey: "name", out: "originalName" },
      { override: "originalShortName", sourceKey: "shortName", out: "originalShortName" },
      { override: "originalBio", sourceKey: null, out: "originalBio" },
    ]);

    const category = parseGroupCategory(row.category, slug);
    // isMainUnit only takes effect for type=unit rows; for solo/group
    // the chip filter never inspects this field. We still persist
    // whatever the CSV said so a later type flip doesn't drop state.
    const isMainUnit = parseBooleanFlag(row.isMainUnit);
    const artistType = (row.type as "solo" | "group" | "unit") || undefined;

    const existing = await prisma.artist.findUnique({ where: { slug } });

    if (existing) {
      await prisma.artist.update({
        where: { slug },
        data: {
          type: artistType,
          category,
          isMainUnit,
          ...originals,
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
      const originalName = ensureOriginalName(originals, slug, "Artist", originalLanguage);
      const artist = await prisma.artist.create({
        data: {
          slug,
          type: artistType ?? "group",
          hasBoard: true,
          category,
          isMainUnit,
          ...originals,
          originalName,
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

  // Third pass: replace ArtistGroup links from `group_slugs`. Empty /
  // missing column → no-op (preserves existing links untouched). Any
  // non-empty value triggers a full replace: deleteMany existing, then
  // recreate from the resolved Group ids. This makes re-imports
  // idempotent and lets the operator move an artist between Groups by
  // editing the CSV.
  //
  // Batch-fetch all referenced Group slugs once at the top so the
  // per-row loop is O(rows + linkages) round trips instead of
  // O(rows × group_slugs). Same applies to the per-row Artist lookup.
  const allGroupSlugs = new Set<string>();
  const allArtistSlugs = new Set<string>();
  for (const row of rows) {
    if (!row.slug || row.group_slugs === undefined) continue;
    allArtistSlugs.add(row.slug);
    for (const slug of parseArtistSlugs(row.group_slugs)) {
      allGroupSlugs.add(slug);
    }
  }
  if (allArtistSlugs.size > 0) {
    const [artistRows, groupRows] = await Promise.all([
      prisma.artist.findMany({
        where: { slug: { in: [...allArtistSlugs] } },
        select: { id: true, slug: true },
      }),
      allGroupSlugs.size > 0
        ? prisma.group.findMany({
            where: { slug: { in: [...allGroupSlugs] } },
            select: { id: true, slug: true },
          })
        : Promise.resolve([] as Array<{ id: string; slug: string | null }>),
    ]);
    const artistBySlug = new Map(artistRows.map((a) => [a.slug, a.id]));
    const groupBySlug = new Map(
      groupRows
        .filter((g): g is { id: string; slug: string } => g.slug != null)
        .map((g) => [g.slug, g.id]),
    );

    // Collect every (artist, group) pair we plan to create, then issue
    // ONE deleteMany + ONE createMany at the end. Per-row deleteMany +
    // per-link create would be O(rows + rows×links) round trips; the
    // batched form is 2 round trips total.
    const artistIdsToReplace: bigint[] = [];
    const linksToCreate: Array<{ artistId: bigint; groupId: string }> = [];
    for (const row of rows) {
      if (!row.slug) continue;
      if (row.group_slugs === undefined) continue;
      const artistId = artistBySlug.get(row.slug);
      if (artistId == null) continue;
      artistIdsToReplace.push(artistId);
      const groupSlugs = parseArtistSlugs(row.group_slugs);
      for (const groupSlug of groupSlugs) {
        const groupId = groupBySlug.get(groupSlug);
        if (groupId == null) {
          results.push(`WARN: artists.csv group_slug "${groupSlug}" not found (artist ${row.slug})`);
          continue;
        }
        linksToCreate.push({ artistId, groupId });
      }
    }
    if (artistIdsToReplace.length > 0) {
      await prisma.artistGroup.deleteMany({
        where: { artistId: { in: artistIdsToReplace } },
      });
    }
    if (linksToCreate.length > 0) {
      await prisma.artistGroup.createMany({ data: linksToCreate });
    }
  }

  return { count: results.length, log: results };
}

async function importGroups(rows: Record<string, string>[]) {
  const results: string[] = [];

  // Pre-shape every row so the per-row mutation below has no parsing
  // left to do. Skip rows missing a slug — they have no upsert key
  // and would be silently dropped.
  type Prepared = {
    slug: string;
    type: GroupType | null;
    category: GroupCategory | null;
    hasBoard: boolean;
    originals: Record<string, string | null>;
    translations: Array<{
      locale: string;
      name: string;
      shortName: string | null;
      description: string | null;
    }>;
    originalLanguage: string;
  };
  const prepared: Prepared[] = [];
  for (const row of rows) {
    const slug = row.slug;
    if (!slug) continue;

    const jaTranslation = row.ja_name
      ? { locale: "ja", name: row.ja_name, shortName: row.ja_shortName || null, description: row.ja_description || null }
      : null;
    const koTranslation = row.ko_name
      ? { locale: "ko", name: row.ko_name, shortName: row.ko_shortName || null, description: row.ko_description || null }
      : null;
    const enTranslation = row.en_name
      ? { locale: "en", name: row.en_name, shortName: row.en_shortName || null, description: row.en_description || null }
      : null;
    const translations = [jaTranslation, koTranslation, enTranslation].filter(
      Boolean,
    ) as Prepared["translations"];

    const originalLanguage = resolveOriginalLanguage(row.originalLanguage);
    const source = pickOriginalSource(translations, originalLanguage);
    const originals = buildOriginals(row, source, originalLanguage, [
      { override: "originalName", sourceKey: "name", out: "originalName" },
      { override: "originalShortName", sourceKey: "shortName", out: "originalShortName" },
      { override: "originalDescription", sourceKey: "description", out: "originalDescription" },
    ]);

    prepared.push({
      slug,
      type: parseGroupType(row.type, slug),
      category: parseGroupCategory(row.category, slug),
      hasBoard: parseBooleanFlag(row.hasBoard),
      originals,
      translations,
      originalLanguage,
    });
  }
  if (prepared.length === 0) return { count: 0, log: results };

  // Single round trip to learn which slugs already exist; everything
  // else fans out on top of the result. Mirrors the pattern in
  // `importArtists`'s third pass.
  const existingRows = await prisma.group.findMany({
    where: { slug: { in: prepared.map((p) => p.slug) } },
    select: { id: true, slug: true },
  });
  const existingByslug = new Map(
    existingRows
      .filter((g): g is { id: string; slug: string } => g.slug != null)
      .map((g) => [g.slug, g.id]),
  );

  // Updates run in parallel: per-row update + translation upserts in
  // a single Promise.all. Each row is independent so contention
  // between them on the connection pool is fine. No transaction —
  // CSV import is tolerant of partial failures (operator re-runs).
  const toUpdate = prepared.filter((p) => existingByslug.has(p.slug));
  await Promise.all(
    toUpdate.map(async (p) => {
      const id = existingByslug.get(p.slug)!;
      await prisma.group.update({
        where: { id },
        data: {
          type: p.type,
          category: p.category,
          hasBoard: p.hasBoard,
          ...p.originals,
        },
      });
      await Promise.all(
        p.translations.map((t) =>
          prisma.groupTranslation.upsert({
            where: { groupId_locale: { groupId: id, locale: t.locale } },
            create: { groupId: id, ...t },
            update: { name: t.name, shortName: t.shortName, description: t.description },
          }),
        ),
      );
      results.push(`UPDATED: ${p.slug} → ${id}`);
    }),
  );

  // Creates: emit the nested-create form (translations created in
  // the same statement as the Group), Promise.all in parallel.
  const toCreate = prepared.filter((p) => !existingByslug.has(p.slug));
  await Promise.all(
    toCreate.map(async (p) => {
      const originalName = ensureOriginalName(
        p.originals,
        p.slug,
        "Group",
        p.originalLanguage,
      );
      const group = await prisma.group.create({
        data: {
          slug: p.slug,
          type: p.type,
          category: p.category,
          hasBoard: p.hasBoard,
          ...p.originals,
          originalName,
          translations: { create: p.translations },
        },
      });
      results.push(`CREATED: ${p.slug} → ${group.id}`);
    }),
  );

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

    const siOriginalLanguage = resolveOriginalLanguage(row.originalLanguage);
    const siSource = pickOriginalSource(translations, siOriginalLanguage);
    const siOriginals = buildOriginals(row, siSource, siOriginalLanguage, [
      { override: "originalName", sourceKey: "name", out: "originalName" },
      { override: "originalShortName", sourceKey: "shortName", out: "originalShortName" },
    ]);

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
      if (row.va_ja_name) vaTranslations.push({ locale: "ja", name: row.va_ja_name, shortName: row.va_ja_shortName || null, stageName: null as string | null });
      if (row.va_ko_name) vaTranslations.push({ locale: "ko", name: row.va_ko_name, shortName: row.va_ko_shortName || null, stageName: null as string | null });
      if (row.va_en_name) vaTranslations.push({ locale: "en", name: row.va_en_name, shortName: row.va_en_shortName || null, stageName: null as string | null });

      const vaOriginalLanguage = resolveOriginalLanguage(row.va_originalLanguage || row.originalLanguage);
      const vaSource = pickOriginalSource(vaTranslations, vaOriginalLanguage);
      const vaOriginals = buildOriginals(row, vaSource, vaOriginalLanguage, [
        { override: "va_originalName", sourceKey: "name", out: "originalName" },
        { override: "va_originalShortName", sourceKey: "shortName", out: "originalShortName" },
        { override: "va_originalStageName", sourceKey: "stageName", out: "originalStageName" },
      ]);

      const existingRp = await prisma.realPerson.findUnique({ where: { slug: vaSlug } });
      if (existingRp) {
        await prisma.realPerson.update({
          where: { id: existingRp.id },
          data: vaOriginals,
        });
        for (const t of vaTranslations) {
          await prisma.realPersonTranslation.upsert({
            where: { realPersonId_locale: { realPersonId: existingRp.id, locale: t.locale } },
            create: { realPersonId: existingRp.id, ...t },
            update: { name: t.name, shortName: t.shortName, stageName: t.stageName },
          });
        }
        realPersonId = existingRp.id;
      } else {
        const originalName = ensureOriginalName(vaOriginals, vaSlug, "RealPerson", vaOriginalLanguage);
        const rp = await prisma.realPerson.create({
          data: {
            slug: vaSlug,
            ...vaOriginals,
            originalName,
            translations: { create: vaTranslations },
          },
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
          ...siOriginals,
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
      const originalName = ensureOriginalName(siOriginals, charSlug, "StageIdentity", siOriginalLanguage);
      const si = await prisma.stageIdentity.create({
        data: {
          slug: charSlug,
          type: (row.character_type as "character" | "persona") || "character",
          color: row.color || null,
          ...siOriginals,
          originalName,
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

const VALID_SERIES_TYPES = ["concert_tour", "standalone", "festival", "fan_meeting"] as const;
type EventSeriesTypeImport = (typeof VALID_SERIES_TYPES)[number];

function normalizeSeriesType(raw: string | undefined): EventSeriesTypeImport | undefined {
  if (!raw) return undefined;
  if (raw === "one_time") return "standalone";
  if (VALID_SERIES_TYPES.includes(raw as EventSeriesTypeImport)) return raw as EventSeriesTypeImport;
  throw new ImportValidationError(`Invalid series_type: ${raw}`);
}

async function importEvents(rows: Record<string, string>[]) {
  const results: string[] = [];

  // Upsert series first (dedup by series_slug)
  const seriesSlugs = new Set(rows.map((r) => r.series_slug).filter(Boolean));
  for (const slug of seriesSlugs) {
    const row = rows.find((r) => r.series_slug === slug)!;

    const jaTranslation = row.series_ja_name ? { locale: "ja", name: row.series_ja_name, shortName: row.series_ja_shortName || null } : null;
    const koTranslation = row.series_ko_name ? { locale: "ko", name: row.series_ko_name, shortName: row.series_ko_shortName || null } : null;
    const enTranslation = row.series_en_name ? { locale: "en", name: row.series_en_name, shortName: row.series_en_shortName || null } : null;
    const translations = [jaTranslation, koTranslation, enTranslation].filter(Boolean) as { locale: string; name: string; shortName: string | null }[];

    const artistId = row.artist_slug
      ? (await prisma.artist.findUnique({ where: { slug: row.artist_slug } }))?.id ?? null
      : null;

    const seriesOriginalLanguage = resolveOriginalLanguage(row.series_originalLanguage || row.originalLanguage);
    const seriesSource = pickOriginalSource(translations, seriesOriginalLanguage);
    const seriesOriginals = buildOriginals(row, seriesSource, seriesOriginalLanguage, [
      { override: "series_originalName", sourceKey: "name", out: "originalName" },
      { override: "series_originalShortName", sourceKey: "shortName", out: "originalShortName" },
      { override: "series_originalDescription", sourceKey: null, out: "originalDescription" },
    ]);

    const existing = await prisma.eventSeries.findUnique({ where: { slug } });

    if (existing) {
      await prisma.eventSeries.update({
        where: { slug },
        data: {
          type: normalizeSeriesType(row.series_type),
          artistId,
          ...seriesOriginals,
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
      const originalName = ensureOriginalName(seriesOriginals, slug, "EventSeries", seriesOriginalLanguage);
      const series = await prisma.eventSeries.create({
        data: {
          slug,
          type: normalizeSeriesType(row.series_type) ?? "concert_tour",
          artistId,
          hasBoard: true,
          ...seriesOriginals,
          originalName,
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
    const enTranslation = row.en_name ? { locale: "en", name: row.en_name, shortName: row.en_shortName || null, city: row.en_city || null, venue: row.en_venue || null } : null;
    const translations = [jaTranslation, koTranslation, enTranslation].filter(Boolean) as { locale: string; name: string; shortName: string | null; city: string | null; venue: string | null }[];

    const seriesId = row.series_slug
      ? (await prisma.eventSeries.findUnique({ where: { slug: row.series_slug } }))?.id ?? null
      : null;

    const eventOriginalLanguage = resolveOriginalLanguage(row.originalLanguage);
    const eventSource = pickOriginalSource(translations, eventOriginalLanguage);
    const eventOriginals = buildOriginals(row, eventSource, eventOriginalLanguage, [
      { override: "originalName", sourceKey: "name", out: "originalName" },
      { override: "originalShortName", sourceKey: "shortName", out: "originalShortName" },
      { override: "originalCity", sourceKey: "city", out: "originalCity" },
      { override: "originalVenue", sourceKey: "venue", out: "originalVenue" },
    ]);

    const existing = await prisma.event.findUnique({ where: { slug } });

    if (existing) {
      await prisma.event.update({
        where: { slug },
        data: {
          type: (row.event_type as "concert" | "festival" | "fan_meeting" | "showcase" | "virtual_live") || undefined,
          eventSeriesId: seriesId,
          date: row.date ? new Date(row.date) : null,
          // startTime is NOT NULL in the schema, so only overwrite when
          // the CSV row actually carries a value — missing/blank means
          // "keep the existing value", not "clear it".
          ...(row.startTime ? { startTime: new Date(row.startTime) } : {}),
          country: row.country || null,
          ...eventOriginals,
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
      if (!row.startTime) {
        results.push(`SKIPPED: ${slug} (startTime required for new events)`);
        continue;
      }
      const originalName = ensureOriginalName(eventOriginals, slug, "Event", eventOriginalLanguage);
      const event = await prisma.event.create({
        data: {
          slug,
          type: (row.event_type as "concert" | "festival" | "fan_meeting" | "showcase" | "virtual_live") || "concert",
          status: "scheduled",
          eventSeriesId: seriesId,
          date: row.date ? new Date(row.date) : null,
          startTime: new Date(row.startTime),
          country: row.country || null,
          ...eventOriginals,
          originalName,
          translations: translations.length ? { create: translations } : undefined,
        },
      });
      results.push(`CREATED: ${slug} → ${event.id}`);
    }
  }

  // Second pass: create EventPerformer rows
  const allSIs = await prisma.stageIdentity.findMany({
    include: { translations: true },
  });

  // Two-pass lookup. The CSV columns (event_performer_slugs /
  // event_guest_slugs) carry slug values by documented convention, so we
  // resolve those first. The translation-name fallback exists only for
  // legacy pre-launch CSV rows that still passed names. Without splitting
  // the passes, Array.find can return the first SI whose translation
  // name fuzzy-matches the input even when a LATER SI has the exact
  // slug — wrong stageIdentityId on the EventPerformer row.
  //
  // Without ANY slug match (the bug this hotfix replaces) every imported
  // event ended up with zero performers and zero guests on prod.
  function findSIIdBySlug(slug: string): string | null {
    const bySlug = allSIs.find((si) => si.slug === slug);
    if (bySlug) return bySlug.id;

    const normalizedSlug = slug.toLowerCase();
    const byLegacyName = allSIs.find((si) =>
      si.translations.some(
        (t) =>
          t.name === slug ||
          t.name.toLowerCase().replace(/\s+/g, "-") === normalizedSlug
      )
    );
    return byLegacyName?.id ?? null;
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

  // Two-pass lookup, matching the helper in importEvents above. Splitting
  // exact slug from legacy name fallback prevents an earlier SI's
  // translation-name fuzzy match from shadowing a later SI's exact slug.
  function findSIId(slug: string): string | null {
    const bySlug = allSIs.find((si) => si.slug === slug);
    if (bySlug) return bySlug.id;

    const normalizedSlug = slug.toLowerCase();
    const byLegacyName = allSIs.find((si) =>
      si.translations.some(
        (t) =>
          t.name === slug ||
          t.name.toLowerCase().replace(/\s+/g, "-") === normalizedSlug
      )
    );
    return byLegacyName?.id ?? null;
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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body: expected an object" }, { status: 400 });
  }

  const { type, csv } = body as { type?: unknown; csv?: unknown };
  if (typeof type !== "string" || typeof csv !== "string") {
    return NextResponse.json({ error: "Invalid request body: type and csv are required strings" }, { status: 400 });
  }

  const rows = parseCSV(csv);
  if (rows.length === 0) {
    return NextResponse.json({ error: "CSV is empty or invalid" }, { status: 400 });
  }

  try {
    let result;
    switch (type) {
      case "groups":
        result = await importGroups(rows);
        break;
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
  } catch (err) {
    console.error("Import error:", err);
    if (err instanceof ImportValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    // resolveOriginalLanguage in src/lib/csv-parse.ts throws a plain Error
    // for unsupported language codes — surface that as a 400 too, since a
    // single bad CSV cell shouldn't look like a server fault.
    if (err instanceof Error && err.message.startsWith("Unknown originalLanguage:")) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}
